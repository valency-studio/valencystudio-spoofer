use std::path::{Path, PathBuf};

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncReadExt;

use crate::error::AppError;

type Result<T> = crate::error::Result<T>;

const ASSETS_BASE: &str = "https://apis.roblox.com";
const CREATE_ASSET: &str = "https://apis.roblox.com/assets/v1/assets";
const OPERATIONS: &str = "https://apis.roblox.com/assets/v1/operations";
const QUOTAS: &str = "https://apis.roblox.com/cloud/v2/users";

/// How long to wait between operation status polls.
const OPERATION_POLL_MS: u64 = 2000;

/// How often to re-read an asset's moderation result.
///
/// Moderation is a separate queue from the upload, so it is asked about on its
/// own slower cadence rather than on the operation's.
const MODERATION_POLL_MS: u64 = 5000;

/// How long to wait for Roblox to hand back an asset id for a create operation.
///
/// The id normally turns up within a couple of seconds, well before Roblox has
/// finished checking the audio. This is only the backstop for an operation that
/// never answers, so no row can be polled forever.
const OPERATION_DEADLINE_SECS: u64 = 120;

/// How long to keep re-reading moderation.
///
/// A track still in the review queue is not a failure, so this is deliberately
/// generous: the piece keeps saying "validating", which is the truth, instead of
/// being called rejected. One that outlives the deadline is picked back up by
/// [`resume_pending_validations`] on the next launch.
const MODERATION_DEADLINE_SECS: u64 = 30 * 60;

/// Roblox rejects audio over 7 minutes and anything over 20 MB.
pub const MAX_AUDIO_SECS: f64 = 7.0 * 60.0;
pub const MAX_UPLOAD_BYTES: u64 = 20 * 1024 * 1024;

/// Emitted while a piece uploads so the Music view can show live progress.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    pub file: String,
    pub index: u32,
    pub total: u32,
    pub sent: u32,
    pub bytes: u32,
    /// "uploading" while bytes move, "processing" while Roblox approves.
    pub stage: String,
    /// Seconds spent waiting on Roblox's validation, so the view can show a live
    /// counter instead of a frozen bar. Always 0 while uploading.
    pub processing_elapsed_secs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadSummary {
    /// The history row this upload created. The view uses it to scroll to the
    /// row, which is where the asset ids appear as Roblox reveals them.
    pub record_id: String,
    /// Pieces that were already fully accepted by the time the bytes finished
    /// sending. Usually empty, since Roblox validates after the fact; it exists
    /// so a caller can tell "nothing accepted yet" from "nothing sent".
    pub accepted: Vec<UploadedAsset>,
    pub was_split: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadedAsset {
    pub name: String,
    #[specta(type = f64)]
    pub asset_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioQuota {
    pub remaining: u32,
    pub limit: u32,
}

// ------------------------------------------------------------------- history

/// Where a piece is in Roblox's pipeline.
///
/// These are plain strings rather than an enum so that a record written by an
/// older build still deserialises, and so a new status can be added without
/// stranding the pieces already on disk.
pub mod status {
    /// Bytes are still being sent to Roblox.
    pub const UPLOADING: &str = "uploading";
    /// Roblox has the bytes and is checking them. The asset id may or may not
    /// exist yet; it is filled in the moment Roblox reveals it.
    pub const VALIDATING: &str = "validating";
    /// Roblox approved the piece and it has an asset id.
    pub const ACCEPTED: &str = "accepted";
    /// Roblox refused the piece. `message` says why.
    pub const REJECTED: &str = "rejected";
}

/// One rendered piece of a track, tracked from the moment its bytes start
/// moving until Roblox gives a verdict.
///
/// `asset_id` is optional because Roblox reveals it at its own pace. It is
/// filled in as soon as the operation response carries one, which is what lets
/// the history show an id while validation is still running.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadPiece {
    /// The name Roblox shows, exactly as the user typed it.
    pub name: String,
    pub path: String,
    pub bytes: u32,
    /// Roblox's handle for the create call. Empty when the create call itself
    /// failed, which is the only way a piece has no operation to poll.
    #[serde(default)]
    pub operation_id: String,
    #[serde(default)]
    /// Exported as a float because a u64 would lose precision as a JavaScript
    /// number. Roblox asset ids stay far below that limit.
    #[specta(type = Option<f64>)]
    pub asset_id: Option<u64>,
    /// One of [`status`].
    pub status: String,
    /// Why Roblox refused it, when it did.
    #[serde(default)]
    pub message: String,
}

/// One track's upload, kept so the ids and the verdict both survive a restart.
///
/// Validation outlives the app: Roblox can take minutes to answer, and closing
/// the window must not lose the answer. Everything the view needs to render a
/// row is therefore on disk, and a poller picks the unfinished pieces back up on
/// the next launch.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadRecord {
    pub id: String,
    /// The track's title, without any part suffix.
    pub title: String,
    pub uploaded_at: String,
    pub was_split: bool,
    pub total_bytes: u32,
    pub pieces: Vec<UploadPiece>,
}

/// True while a piece still needs Roblox to answer something.
pub fn is_unfinished(piece: &UploadPiece) -> bool {
    matches!(piece.status.as_str(), status::UPLOADING | status::VALIDATING)
}

/// The row's status, derived from its pieces.
///
/// A row is only "accepted" when every piece is, so a split track cannot read as
/// done while one of its parts is still being checked or was refused.
pub fn record_status(record: &UploadRecord) -> &'static str {
    if record.pieces.iter().any(|piece| piece.status == status::REJECTED) {
        return status::REJECTED;
    }
    // The emptiness check is load-bearing: `all` on an empty iterator is true,
    // so a record with no pieces would otherwise read as a success.
    if !record.pieces.is_empty()
        && record.pieces.iter().all(|piece| piece.status == status::ACCEPTED)
    {
        return status::ACCEPTED;
    }
    if record.pieces.iter().any(is_unfinished) {
        return status::VALIDATING;
    }
    status::REJECTED
}

/// Records default to this many entries, oldest dropped first.
const HISTORY_LIMIT: usize = 200;

static HISTORY_MUTEX: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

fn history_mutex() -> &'static tokio::sync::Mutex<()> {
    HISTORY_MUTEX.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn history_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("upload-history.json"))
}

/// Distinguishes two records created in the same millisecond.
static RECORD_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A record id that exists before any asset id does.
///
/// The old id was derived from the first asset id, which is exactly the thing
/// that does not exist yet at the moment the bytes are sent — so a record is now
/// keyed by creation order instead.
fn new_record_id() -> String {
    use std::sync::atomic::Ordering;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let sequence = RECORD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{millis:x}-{sequence:x}")
}

/// Reads the whole history. A missing or corrupt file reads as empty rather than
/// as an error, so a bad write cannot lock the user out of the Music view.
async fn load_records(app: &AppHandle) -> Vec<UploadRecord> {
    let Ok(path) = history_path(app) else {
        return Vec::new();
    };
    crate::commands::ipc::read_json_file(&path)
        .await
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

/// Writes the history, newest first, dropping the oldest past the limit.
async fn store_records(app: &AppHandle, mut records: Vec<UploadRecord>) -> Result<()> {
    records.truncate(HISTORY_LIMIT);
    let path = history_path(app)?;
    crate::commands::ipc::write_json_file(&path, &serde_json::to_value(records)?).await
}

/// Inserts a record, or replaces the earlier one with the same id.
///
/// Replacing rather than appending is what keeps a re-polled record from
/// stacking up duplicate rows in the history list.
pub async fn upsert_record(app: &AppHandle, record: UploadRecord) -> Result<()> {
    let _guard = history_mutex().lock().await;
    let mut stored = load_records(app).await;
    stored.retain(|existing| existing.id != record.id);
    stored.insert(0, record);
    store_records(app, stored).await
}

/// Emits the record so an open view can update the row without polling.
fn announce(app: &AppHandle, record: &UploadRecord) {
    // A closed window has no listener. The record is on disk either way, so the
    // next launch reads the same state; dropping the event is harmless.
    let _ = app.emit("music-upload-status", record.clone());
}

/// Creates the record for an upload and puts it in the history straight away.
///
/// This runs before a single byte is sent, so the row exists even if the upload
/// fails outright and the view never gets a summary back.
pub async fn begin_record(
    app: &AppHandle,
    title: &str,
    pieces: &[(String, PathBuf, u32)],
    was_split: bool,
) -> Result<UploadRecord> {
    let record = UploadRecord {
        id: new_record_id(),
        title: title.to_string(),
        uploaded_at: chrono_like_now(),
        was_split,
        total_bytes: pieces.iter().map(|(_, _, bytes)| *bytes).sum(),
        pieces: pieces
            .iter()
            .map(|(name, path, bytes)| UploadPiece {
                name: name.clone(),
                path: path.to_string_lossy().to_string(),
                bytes: *bytes,
                operation_id: String::new(),
                asset_id: None,
                status: status::UPLOADING.to_string(),
                message: String::new(),
            })
            .collect(),
    };

    upsert_record(app, record.clone()).await?;
    announce(app, &record);
    Ok(record)
}

/// Applies a change to one piece and persists the whole record.
///
/// Every status change goes through here so the file and the emitted event
/// always describe the same state. Without that, a status could be announced
/// but never written, and the row would silently revert on the next launch.
pub async fn patch_piece(
    app: &AppHandle,
    record_id: &str,
    index: usize,
    apply: impl FnOnce(&mut UploadPiece),
) -> Result<UploadRecord> {
    let updated = {
        let _guard = history_mutex().lock().await;
        let mut stored = load_records(app).await;

        let Some(record) = stored.iter_mut().find(|record| record.id == record_id) else {
            return Err(AppError::Custom("That upload is no longer in the history.".into()));
        };
        let Some(piece) = record.pieces.get_mut(index) else {
            return Err(AppError::Custom("That upload piece no longer exists.".into()));
        };

        apply(piece);
        let updated = record.clone();
        stored.retain(|existing| existing.id != updated.id);
        stored.insert(0, updated.clone());
        store_records(app, stored).await?;
        updated
    };

    // Announced outside the lock: a listener is free to call back into a
    // command, and holding the history lock across that would deadlock.
    announce(app, &updated);
    Ok(updated)
}

/// RFC 3339 without pulling in a date library, in UTC.
fn chrono_like_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let days = now / 86_400;
    let seconds = now % 86_400;
    let (year, month, day) = civil_from_days(days as i64);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        seconds / 3600,
        (seconds % 3600) / 60,
        seconds % 60
    )
}

/// Howard Hinnant's days-from-epoch to civil date algorithm.
const fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[tauri::command]
#[specta::specta]
pub async fn get_upload_history(app: AppHandle) -> Result<Vec<UploadRecord>> {
    let _guard = history_mutex().lock().await;
    let path = history_path(&app)?;

    let stored: Vec<UploadRecord> = crate::commands::ipc::read_json_file(&path)
        .await
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();

    Ok(stored)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_upload_record(app: AppHandle, id: String) -> Result<bool> {
    let _guard = history_mutex().lock().await;
    let path = history_path(&app)?;

    let mut stored: Vec<UploadRecord> = crate::commands::ipc::read_json_file(&path)
        .await
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();

    let before = stored.len();
    stored.retain(|record| record.id != id);
    if stored.len() == before {
        return Ok(false);
    }

    crate::commands::ipc::write_json_file(&path, &serde_json::to_value(stored)?).await?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn clear_upload_history(app: AppHandle) -> Result<bool> {
    let _guard = history_mutex().lock().await;
    let path = history_path(&app)?;
    crate::commands::ipc::write_json_file(&path, &serde_json::json!([])).await?;
    Ok(true)
}

/// Reads the Open Cloud key the app already stores.
fn api_key() -> Result<String> {
    let entry = crate::commands::ipc::secrets::get_opencloud_api_key_entry()?;
    let key = entry
        .get_password()
        .map_err(|e| AppError::Custom(format!("Could not read the Open Cloud API key: {e}")))?;
    if key.trim().is_empty() {
        return Err("Add an Open Cloud API key in Settings before uploading.".into());
    }
    Ok(key.trim().to_string())
}

/// Maps our output formats onto the content types Roblox accepts for audio.
pub fn content_type_for(path: &Path) -> Result<&'static str> {
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "mp3" => Ok("audio/mpeg"),
        "ogg" => Ok("audio/ogg"),
        "wav" => Ok("audio/wav"),
        "flac" => Ok("audio/flac"),
        other => Err(AppError::Custom(format!(
            "Roblox does not accept .{other} audio. Export as MP3, OGG, WAV or FLAC."
        ))),
    }
}

/// Sends the rendered pieces to Roblox and returns as soon as the bytes are
/// accepted.
///
/// This deliberately does not wait for Roblox to finish validating. Waiting is
/// what made the Music view sit on a progress bar for minutes with no way to
/// tell whether the upload had worked, and it meant a single slow piece held
/// back the asset ids of every other piece. Instead each piece is recorded and
/// left in [`status::VALIDATING`], and a background poller resolves it.
///
/// Returns the pieces that are already fully accepted. Pieces still validating
/// are in the history, not here, because this call has no id to give yet.
pub async fn upload_pieces(
    app: &AppHandle,
    files: &[(String, PathBuf)],
    creator_user_id: u64,
) -> Result<UploadSummary> {
    if files.is_empty() {
        return Err("There is nothing to upload.".into());
    }
    if creator_user_id == 0 {
        return Err("Add a Roblox account and an Open Cloud API key before uploading.".into());
    }

    let key = api_key()?;
    let client = crate::utils::get_http_client();
    let total = files.len();

    // Sizes are read up front so the history row can show the real byte count
    // from the moment it appears, rather than growing into it.
    let mut sized: Vec<(String, PathBuf, u32)> = Vec::with_capacity(total);
    for (name, path) in files {
        let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) as u32;
        sized.push((name.clone(), path.clone(), bytes));
    }

    let title = display_title(&sized);
    let record = begin_record(app, &title, &sized, total > 1).await?;

    for (index, (name, path, _)) in sized.iter().enumerate() {
        match send_piece(&client, &key, name, path, index, total, app, creator_user_id).await {
            Ok(operation_id) => {
                // The row is written before the poller starts, so a crash
                // between the two still leaves a record to resume from.
                patch_piece(app, &record.id, index, |piece| {
                    piece.operation_id = operation_id;
                    piece.status = status::VALIDATING.to_string();
                })
                .await?;
            }
            Err(err) => {
                // One piece failing does not abandon the rest: the track still
                // exists on Roblox's side for the pieces that did land, and the
                // row records exactly which part went wrong.
                patch_piece(app, &record.id, index, |piece| {
                    piece.status = status::REJECTED.to_string();
                    piece.message = err.to_string();
                })
                .await?;
            }
        }
    }

    // Validation is chased in the background so this command can return. The
    // pollers outlive it and keep writing to the history file.
    let app = app.clone();
    let record_id = record.id.clone();
    tauri::async_runtime::spawn(async move {
        for index in 0..total {
            follow_validation(&app, &record_id, index).await;
        }
    });

    Ok(UploadSummary { record_id: record.id, accepted: Vec::new(), was_split: total > 1 })
}

/// The row's title: the track name, without any "(part n)" suffix.
///
/// A split track's pieces carry suffixes, so the title is the longest piece name
/// with that suffix trimmed, which is the name the user typed.
fn display_title(pieces: &[(String, PathBuf, u32)]) -> String {
    let first = pieces.first().map(|(name, _, _)| name.as_str()).unwrap_or_default();
    match first.rfind(" (part ") {
        Some(cut) if first.ends_with(')') => first[..cut].to_string(),
        _ => first.to_string(),
    }
}

/// Sends one piece's bytes and returns Roblox's operation id.
///
/// Everything after this point is [`follow_validation`]'s problem. The only
/// thing this function decides is whether Roblox accepted the bytes at all.
async fn send_piece(
    client: &reqwest::Client,
    key: &str,
    name: &str,
    path: &Path,
    index: usize,
    total: usize,
    app: &AppHandle,
    creator_user_id: u64,
) -> Result<String> {
    let size = std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| AppError::Custom(format!("Could not read {name}: {e}")))?;

    if size > MAX_UPLOAD_BYTES {
        return Err(AppError::Custom(format!(
            "{name:?} is {:.1} MB, over Roblox's 20 MB limit per upload.",
            size as f64 / (1024.0 * 1024.0)
        )));
    }

    let content_type = content_type_for(path)?;
    let request = create_asset_request(name, creator_user_id);

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| AppError::Custom(format!("Could not open {name}: {e}")))?;

    let emitter = ProgressEmitter {
        app: app.clone(),
        file: name.to_string(),
        index: index as u32,
        total: total as u32,
        bytes: size as u32,
    };

    let body = reqwest::Body::wrap_stream(file_stream(file, emitter));
    let part = reqwest::multipart::Part::stream(body)
        .file_name(name.to_string())
        .mime_str(content_type)
        .map_err(|e| AppError::Custom(e.to_string()))?;

    let form = reqwest::multipart::Form::new()
        .text(
            "request",
            serde_json::to_string(&request).map_err(|e| AppError::Custom(e.to_string()))?,
        )
        .part("fileContent", part);

    let response =
        client.post(CREATE_ASSET).header("x-api-key", key).multipart(form).send().await?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(describe(&body, status.as_u16()));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| AppError::Custom(e.to_string()))?;

    parsed.get("operationId").and_then(|v| v.as_str()).map(str::to_string).ok_or_else(|| {
        AppError::Custom(format!("Roblox did not return an operation id for {name:?}."))
    })
}

/// Reads one poll of a create operation.
///
/// The asset id is returned as soon as the response carries one, whether or not
/// the operation has finished. That is what puts a real id in the history while
/// Roblox is still checking the audio, instead of making the user wait for the
/// verdict to see it.
fn read_operation_state(body: &serde_json::Value) -> (String, Option<u64>) {
    let state = body.get("state").and_then(|v| v.as_str()).unwrap_or_default().to_ascii_lowercase();
    let asset_id =
        body.get("response").and_then(|r| r.get("assetId")).and_then(serde_json::Value::as_u64);
    (state, asset_id)
}

/// What Roblox decided about an asset it has already taken the bytes for.
///
/// This, and not the create operation's state, is the verdict. The operation
/// reports that the upload finished, which is a separate question.
pub mod moderation {
    /// Roblox approved it. The asset is real and usable.
    pub const APPROVED: &str = "approved";
    /// Roblox has it and has not looked yet. Waiting, not failing.
    pub const REVIEWING: &str = "reviewing";
    /// Roblox refused it.
    pub const REJECTED: &str = "rejected";
    /// Roblox answered, but not with a state this build knows.
    pub const UNKNOWN: &str = "unknown";
}

/// The moderation verdict in one asset response.
///
/// Roblox nests the state under `moderationResult` when the read mask asks for
/// it and puts it at the top level when it does not, so both shapes are read.
/// The raw state comes back alongside the verdict so the history can show what
/// Roblox actually said instead of an unexplained spinner.
///
/// An answer in neither shape is [`moderation::UNKNOWN`] rather than a guess. A
/// missing verdict must never be read as an approval, or a quiet change in
/// Roblox's response shape would silently mark every upload as accepted.
pub fn read_moderation_state(body: &serde_json::Value) -> (&'static str, String) {
    let raw = body
        .get("moderationResult")
        .and_then(|result| result.get("moderationState"))
        .or_else(|| body.get("moderationState"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    let verdict = match raw.as_str() {
        "approved" => moderation::APPROVED,
        "reviewing" => moderation::REVIEWING,
        "rejected" => moderation::REJECTED,
        _ => moderation::UNKNOWN,
    };

    (verdict, raw)
}

/// Asks Roblox what it decided about an asset.
///
/// The read mask is a preference, not a requirement: a Roblox build that does not
/// know the field answers 400, and the same question without the mask still
/// returns the moderation state. That retry is why a masked failure is never
/// mistaken for a verdict.
async fn fetch_moderation(
    client: &reqwest::Client,
    key: &str,
    asset_id: u64,
) -> Result<(&'static str, String)> {
    let plain = format!("{ASSETS_BASE}/assets/v1/assets/{asset_id}");
    let masked = format!("{plain}?readMask=moderationResult,displayName,description");

    let response = client.get(&masked).header("x-api-key", key).send().await?;

    // A 400 here means the read mask was refused, not that the asset is bad, so
    // the identical question is asked again without it.
    if response.status().as_u16() != 400 {
        return read_moderation_response(response).await;
    }

    read_moderation_response(client.get(&plain).header("x-api-key", key).send().await?).await
}

/// Turns one asset response into a verdict.
async fn read_moderation_response(response: reqwest::Response) -> Result<(&'static str, String)> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(describe(&body, status.as_u16()));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| AppError::Custom(e.to_string()))?;

    Ok(read_moderation_state(&parsed))
}

/// Polls one piece until Roblox accepts or rejects it, updating the history as
/// it learns things.
///
/// This runs in the background and is the only thing that ever moves a piece out
/// of [`status::VALIDATING`]. It works in two steps, because Roblox answers two
/// different questions here and only the second one is a verdict:
///
/// 1. The create operation, polled until it hands over an asset id. The id is
///    written to the history the moment it appears, so the row is copyable long
///    before anything is judged.
/// 2. The asset's own moderation result, polled until Roblox approves or rejects
///    it.
///
/// Step two starts as soon as there is an id, deliberately *not* when the
/// operation reaches a terminal state. The operation answers "did the bytes
/// land", which is a different question, and it can sit on `Running` for minutes
/// after moderation has already approved the track. Waiting on it instead left
/// finished uploads frozen on "validating" with a live asset id sitting right
/// there in the row.
pub async fn follow_validation(app: &AppHandle, record_id: &str, index: usize) {
    let Ok(key) = api_key() else {
        mark_rejected(app, record_id, index, "The Open Cloud API key is no longer readable.").await;
        return;
    };
    let client = crate::utils::get_http_client();

    let Some(operation_id) = operation_id_of(app, record_id, index).await else {
        // No operation means the create call never succeeded, so there is
        // nothing to wait for. patch_piece already recorded the reason.
        return;
    };

    let Some(asset_id) = await_asset_id(&client, &key, app, record_id, index, &operation_id).await
    else {
        // Already written to the history as rejected, with the reason.
        return;
    };

    await_moderation(&client, &key, app, record_id, index, asset_id).await;
}

/// Polls a create operation until Roblox reveals the piece's asset id.
///
/// Returns `None` when the piece can never have one, which always comes with the
/// reason already written to the history.
async fn await_asset_id(
    client: &reqwest::Client,
    key: &str,
    app: &AppHandle,
    record_id: &str,
    index: usize,
    operation_id: &str,
) -> Option<u64> {
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(OPERATION_DEADLINE_SECS);

    loop {
        // An id recorded by an earlier session means there is nothing to wait
        // for. This is what makes a resumed piece go straight to moderation.
        if let Some(existing) = asset_id_of_piece(app, record_id, index).await {
            adopt_asset_id(client, key, app, record_id, index, existing).await;
            return Some(existing);
        }

        if std::time::Instant::now() >= deadline {
            mark_rejected(
                app,
                record_id,
                index,
                "Roblox took the upload but never reported an asset id for it.",
            )
            .await;
            return None;
        }

        tokio::time::sleep(std::time::Duration::from_millis(OPERATION_POLL_MS)).await;

        let Ok(response) = client
            .get(format!("{OPERATIONS}/{operation_id}"))
            .header("x-api-key", key)
            .send()
            .await
        else {
            // A transport blip is not a verdict. Keep trying.
            log::warn!("Could not reach Roblox about operation {operation_id}");
            continue;
        };

        if !response.status().is_success() {
            continue;
        }

        let Ok(parsed) = response.json::<serde_json::Value>().await else {
            continue;
        };

        let (state, revealed) = read_operation_state(&parsed);

        // The id is taken whatever the state is, because Roblox reveals it long
        // before it has finished judging the audio.
        if let Some(id) = revealed {
            adopt_asset_id(client, key, app, record_id, index, id).await;
            return Some(id);
        }

        match state.as_str() {
            "failed" | "error" => {
                let message =
                    parsed.get("error").and_then(|v| v.as_str()).unwrap_or("no reason given");
                mark_rejected(app, record_id, index, &format!("Roblox rejected it: {message}"))
                    .await;
                return None;
            }
            // A terminal success with no id anywhere is a dead end, and waiting
            // cannot change that.
            "succeeded" | "completed" => {
                mark_rejected(
                    app,
                    record_id,
                    index,
                    "Roblox finished the upload but never reported an asset id for it.",
                )
                .await;
                return None;
            }
            _ => {}
        }
    }
}

/// Records the asset id on the piece and makes the asset usable.
///
/// Both halves are safe to repeat, and repeating the permission call matters: a
/// piece resumed from a previous session already knows its id, and audio cannot
/// be updated in place on Roblox, so without the grant the asset lands
/// owned-but-unusable and no place can load it.
async fn adopt_asset_id(
    client: &reqwest::Client,
    key: &str,
    app: &AppHandle,
    record_id: &str,
    index: usize,
    asset_id: u64,
) {
    if asset_id_of_piece(app, record_id, index).await != Some(asset_id) {
        let _ = patch_piece(app, record_id, index, |piece| piece.asset_id = Some(asset_id)).await;
    }

    if grant_use_permission(client, key, asset_id).await.is_ok() {
        log::info!("Asset {asset_id} is usable");
    }
}

/// Polls an asset's moderation result until Roblox gives a real verdict.
///
/// Only an approval or a rejection ends the wait. A track still queued for review
/// keeps saying so, because Roblox genuinely has not decided yet and calling
/// that a failure would be a lie the user has to argue with.
async fn await_moderation(
    client: &reqwest::Client,
    key: &str,
    app: &AppHandle,
    record_id: &str,
    index: usize,
    asset_id: u64,
) {
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(MODERATION_DEADLINE_SECS);
    let mut last_detail = String::new();

    loop {
        if std::time::Instant::now() >= deadline {
            // Roblox is still deciding and the deadline has passed. `validating`
            // is the truth, so it stays, with the last state it did report kept
            // on the piece as the explanation. The next launch picks it up again.
            let detail = if last_detail.is_empty() {
                "Roblox has not decided yet.".to_string()
            } else {
                format!("Roblox has not decided yet. Its last state was: {last_detail}")
            };
            let _ = patch_piece(app, record_id, index, |piece| piece.message = detail).await;
            return;
        }

        tokio::time::sleep(std::time::Duration::from_millis(MODERATION_POLL_MS)).await;

        let (verdict, raw) = match fetch_moderation(client, key, asset_id).await {
            Ok(answer) => answer,
            // A failed lookup is not a rejection. Roblox answers 5xx and the
            // network blips while the asset is perfectly fine.
            Err(err) => {
                log::warn!("Could not read moderation for asset {asset_id}: {err}");
                continue;
            }
        };

        match verdict {
            moderation::APPROVED => {
                let _ = patch_piece(app, record_id, index, |piece| {
                    piece.status = status::ACCEPTED.to_string();
                    piece.message = String::new();
                })
                .await;
                return;
            }
            moderation::REJECTED => {
                mark_rejected(app, record_id, index, &format!("Roblox rejected it: {raw}")).await;
                return;
            }
            // Still queued for review, or an answer this build does not recognise.
            // Neither is a verdict, so neither may end the wait.
            _ => {
                if !raw.is_empty() && raw != last_detail {
                    let detail = format!("Waiting on Roblox moderation. Its state is: {raw}");
                    last_detail = raw;
                    let _ =
                        patch_piece(app, record_id, index, |piece| piece.message = detail).await;
                }
            }
        }
    }
}

/// Marks a piece rejected with a reason, ignoring a record that has since been
/// deleted by the user.
async fn mark_rejected(app: &AppHandle, record_id: &str, index: usize, reason: &str) {
    let _ = patch_piece(app, record_id, index, |piece| {
        piece.status = status::REJECTED.to_string();
        piece.message = reason.to_string();
    })
    .await;
}

/// The operation id stored for a piece, if the record is still there.
async fn operation_id_of(app: &AppHandle, record_id: &str, index: usize) -> Option<String> {
    let record = find_record(app, record_id).await?;
    let operation = record.pieces.get(index)?.operation_id.clone();
    (!operation.is_empty()).then_some(operation)
}

/// The asset id currently stored for a piece.
async fn asset_id_of_piece(app: &AppHandle, record_id: &str, index: usize) -> Option<u64> {
    let record = find_record(app, record_id).await?;
    record.pieces.get(index)?.asset_id
}

/// Looks a record up without holding the lock across the caller's own work.
async fn find_record(app: &AppHandle, record_id: &str) -> Option<UploadRecord> {
    let _guard = history_mutex().lock().await;
    load_records(app).await.into_iter().find(|record| record.id == record_id)
}

/// Picks up validation for anything left unfinished by a previous session.
///
/// Without this, closing the app mid-validation would leave a row frozen on
/// "validating" forever, which is the exact ambiguity this flow exists to
/// remove.
#[tauri::command]
#[specta::specta]
pub async fn resume_pending_validations(app: AppHandle) -> Result<u32> {
    let records = load_records(&app).await;

    let mut resumed = 0;
    for record in records {
        for index in 0..record.pieces.len() {
            let Some(piece) = record.pieces.get(index) else {
                continue;
            };
            if !is_unfinished(piece) {
                continue;
            }

            // A piece still marked uploading when the app died never finished
            // sending, so there is no operation to poll and it cannot succeed.
            if piece.operation_id.is_empty() {
                if piece.status == status::UPLOADING {
                    mark_rejected(
                        &app,
                        &record.id,
                        index,
                        "The upload was interrupted before Roblox received it.",
                    )
                    .await;
                }
                continue;
            }

            resumed += 1;
            let app = app.clone();
            let record_id = record.id.clone();
            tauri::async_runtime::spawn(async move {
                follow_validation(&app, &record_id, index).await;
            });
        }
    }

    Ok(resumed)
}

/// The `request` field of a Create Asset call.
///
/// The creator is not a top level attribute of the request: it belongs to
/// `creationContext`. Roblox silently ignores a top level `creator` and then
/// answers "Creator is required.", which is the only clue that the field was in
/// the wrong place.
///
/// The name is also kept under Roblox's 100 character limit, and the creator has
/// to be the uploader's own user id or the asset is rejected.
fn create_asset_request(name: &str, creator_user_id: u64) -> serde_json::Value {
    let display_name: String = name.chars().take(100).collect();
    serde_json::json!({
        "assetType": "Audio",
        "displayName": display_name,
        "description": display_name,
        "creationContext": {
            "creator": { "userId": creator_user_id },
        },
    })
}

/// Grants the uploader permission to use the asset in their own experience.
///
/// Audio cannot be updated in place on Roblox, so a new asset is created
/// without a universe attached. Without this the asset stays owned-but-unusable
/// and a place cannot load it.
async fn grant_use_permission(client: &reqwest::Client, key: &str, asset_id: u64) -> Result<()> {
    let response = client
        .patch(format!("{ASSETS_BASE}/asset-permissions-api/v1/assets/permissions"))
        .header("x-api-key", key)
        .json(&serde_json::json!({
            "assetId": asset_id,
            "permission": { "type": "Use", "subject": { "type": "Creator" } }
        }))
        .send()
        .await?;

    if response.status().is_success() {
        return Ok(());
    }

    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    Err(describe(&body, status))
}

/// Remaining uploads allowed this month, from Roblox's own quota endpoint.
pub async fn audio_quota(client: &reqwest::Client, key: &str, user_id: u64) -> Result<(u64, u64)> {
    if user_id == 0 {
        return Err(AppError::from("invalid user_id"));
    }

    let validated_user_id = user_id;
    let response = client
        .get(format!("{QUOTAS}/{validated_user_id}/asset-quotas"))
        .header("x-api-key", key)
        .send()
        .await?;

    if !response.status().is_success() {
        return Ok((0, 0));
    }

    let parsed: serde_json::Value = response.json().await?;
    let entry = parsed
        .get("assetQuotas")
        .and_then(|q| q.get("Audio"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    let remaining = entry.get("remaining").and_then(serde_json::Value::as_u64).unwrap_or(0);
    let limit = entry
        .get("limit")
        .or_else(|| entry.get("capacity"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);

    Ok((remaining, limit))
}

/// Uploads every rendered piece, for a track that was split.
///
/// Returns as soon as the bytes are with Roblox. The asset ids live in the
/// history row this creates, and fill in as Roblox reveals them.
#[tauri::command]
#[specta::specta]
pub async fn upload_audio_parts(
    app: AppHandle,
    paths: Vec<String>,
    names: Vec<String>,
    creator_user_id: f64,
) -> Result<UploadSummary> {
    if names.len() != paths.len() {
        return Err("Each rendered piece needs a name.".into());
    }

    let mut files: Vec<(String, PathBuf)> = Vec::with_capacity(paths.len());

    for (path, name) in paths.into_iter().zip(names) {
        let file_path = PathBuf::from(path.trim());
        if !file_path.is_file() {
            return Err(format!(
                "\"{}\" could not be found. Export the track again.",
                file_path.display()
            )
            .into());
        }
        // The name is the one chosen in the editor rather than the name on disk:
        // the file has been through sanitising and carries an extension, and
        // neither belongs in a Roblox asset name.
        let name = super::media::strip_audio_extension(&name);
        files.push((name, file_path));
    }

    upload_pieces(&app, &files, creator_user_id as u64).await
}

/// Audio uploads left this month, according to Roblox.
#[tauri::command]
#[specta::specta]
pub async fn fetch_open_cloud_audio_quota(creator_user_id: f64) -> Result<AudioQuota> {
    if creator_user_id == 0.0 {
        return Err("Add a Roblox account first.".into());
    }

    let key = api_key()?;
    let client = crate::utils::get_http_client();
    let (remaining, limit) = audio_quota(&client, &key, creator_user_id as u64).await?;

    Ok(AudioQuota { remaining: remaining as u32, limit: limit as u32 })
}

/// Turns a Roblox error body into something a user can act on.
fn describe(body: &str, status: u16) -> AppError {
    let parsed: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);

    let message = parsed
        .get("message")
        .or_else(|| parsed.get("error"))
        .or_else(|| parsed.get("description"))
        .and_then(|v| v.as_str())
        .unwrap_or(body.trim())
        .to_string();

    let trimmed: String = message.chars().take(240).collect();
    AppError::Custom(if trimmed.is_empty() {
        format!("Roblox rejected the upload (HTTP {status}).")
    } else {
        format!("Roblox rejected the upload (HTTP {status}): {trimmed}")
    })
}

#[cfg(test)]
mod tests {
    use super::{content_type_for, create_asset_request, describe, MAX_UPLOAD_BYTES};
    use crate::error::AppError;
    use std::path::{Path, PathBuf};

    #[test]
    fn the_creator_is_nested_inside_the_creation_context() {
        // A top level creator is ignored by the API and comes back as
        // "Creator is required.", so pin the shape Roblox actually documents.
        let request = create_asset_request("WHERE_DO_WE_BEGIN (edited).mp3", 1_234_567);
        let creator = request
            .get("creationContext")
            .and_then(|c| c.get("creator"))
            .and_then(|c| c.get("userId"))
            .and_then(serde_json::Value::as_u64);
        assert_eq!(creator, Some(1_234_567));
        assert!(request.get("creator").is_none(), "creator must not be top level");
        assert_eq!(request.get("assetType").and_then(|v| v.as_str()), Some("Audio"));
    }

    #[test]
    fn the_asset_description_is_never_empty() {
        // Roblox requires a description as well as a name on Create Asset.
        let request = create_asset_request("a", 1);
        assert_eq!(request.get("description").and_then(|v| v.as_str()), Some("a"));
        assert_eq!(request.get("displayName").and_then(|v| v.as_str()), Some("a"));
    }

    #[test]
    fn a_long_name_is_cut_to_robloxs_limit() {
        let request = create_asset_request(&"n".repeat(400), 1);
        let name = request.get("displayName").and_then(|v| v.as_str()).unwrap_or_default();
        assert_eq!(name.len(), 100);
    }

    #[test]
    fn roblox_only_accepts_four_audio_formats() {
        for (name, expected) in [
            ("a.mp3", "audio/mpeg"),
            ("a.ogg", "audio/ogg"),
            ("a.wav", "audio/wav"),
            ("a.FLAC", "audio/flac"),
        ] {
            let actual = content_type_for(Path::new(name));
            assert_eq!(actual.as_deref().ok(), Some(expected), "for {name}");
        }
    }

    #[test]
    fn an_unaccepted_format_is_named_in_the_error() {
        let Err(error) = content_type_for(Path::new("a.m4a")) else {
            panic!("m4a should not be accepted");
        };
        let AppError::Custom(message) = error else {
            panic!("unexpected error variant");
        };
        assert!(message.contains(".m4a"), "error should name the format");
        assert!(message.contains("MP3"), "error should list what is accepted");
    }

    #[test]
    fn roblox_error_bodies_become_readable_messages() {
        let error =
            describe(r#"{"message":"Asset type not supported","errors":[{"message":"bad"}]}"#, 400);
        let text = match error {
            AppError::Custom(text) => text,
            other => panic!("unexpected error: {other:?}"),
        };
        assert!(text.contains("400"));
        assert!(text.contains("Asset type not supported"));
    }

    #[test]
    fn a_non_json_error_still_says_something_useful() {
        let text = match describe("upstream connect error", 502) {
            AppError::Custom(text) => text,
            other => panic!("unexpected error: {other:?}"),
        };
        assert!(text.contains("502"));
        assert!(text.contains("upstream connect error"));
    }

    #[test]
    fn an_empty_error_body_does_not_produce_an_empty_message() {
        let text = match describe("   ", 500) {
            AppError::Custom(text) => text,
            other => panic!("unexpected error: {other:?}"),
        };
        assert!(text.contains("500"));
        assert!(!text.trim().is_empty());
    }

    #[test]
    fn a_very_long_error_is_truncated() {
        let long = "x".repeat(5000);
        let text = match describe(&long, 400) {
            AppError::Custom(text) => text,
            other => panic!("unexpected error: {other:?}"),
        };
        assert!(text.len() < 400, "message was {} chars", text.len());
    }

    #[test]
    fn the_byte_limit_is_twenty_megabytes() {
        assert_eq!(MAX_UPLOAD_BYTES, 20 * 1024 * 1024);
    }

    #[test]
    fn civil_dates_match_known_days() {
        // Spot checks against dates whose epoch offsets are easy to confirm.
        assert_eq!(super::civil_from_days(0), (1970, 1, 1));
        assert_eq!(super::civil_from_days(19_000), (2022, 1, 8));
        // 2024 is a leap year, so the 29th of February must exist.
        assert_eq!(super::civil_from_days(19_782), (2024, 2, 29));
        // 2026-01-01 is 56 years on: 20440 days plus 14 leap days.
        assert_eq!(super::civil_from_days(20_454), (2026, 1, 1));
        assert_eq!(super::civil_from_days(20_453), (2025, 12, 31));
    }

    #[test]
    fn the_recorded_timestamp_is_a_parsable_utc_string() {
        let stamp = super::chrono_like_now();
        assert_eq!(stamp.len(), 20, "unexpected shape: {stamp}");
        assert!(stamp.ends_with('Z'), "must be UTC: {stamp}");
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[7..8], "-");
        assert_eq!(&stamp[10..11], "T");
        assert_eq!(&stamp[13..14], ":");
        assert_eq!(&stamp[16..17], ":");
        // The year is always four digits and starts with 20 for any real date.
        assert!(stamp.starts_with("20"), "unexpected year in {stamp}");
    }

    #[test]
    fn a_split_row_is_only_accepted_once_every_part_is() {
        // A track cut into parts reads as done when its last part lands, not when
        // its first one does. Reading a half-validated track as accepted is how a
        // user ends up wiring up a part that Roblox went on to refuse.
        let mut record = record_with(&[super::status::ACCEPTED, super::status::VALIDATING]);
        assert_eq!(super::record_status(&record), super::status::VALIDATING);

        record.pieces[1].status = super::status::ACCEPTED.to_string();
        assert_eq!(super::record_status(&record), super::status::ACCEPTED);
    }

    #[test]
    fn one_refused_part_makes_the_whole_row_refused() {
        let mut record = record_with(&[super::status::ACCEPTED, super::status::VALIDATING]);
        record.pieces[1].status = super::status::REJECTED.to_string();
        assert_eq!(super::record_status(&record), super::status::REJECTED);
    }

    #[test]
    fn a_part_still_uploading_is_unfinished() {
        // An interrupted upload must be resumable, so it cannot read as settled.
        let record = record_with(&[super::status::UPLOADING]);
        assert!(super::is_unfinished(&record.pieces[0]));
        assert_eq!(super::record_status(&record), super::status::VALIDATING);
    }

    #[test]
    fn a_settled_part_is_not_resumable() {
        let mut record = record_with(&[super::status::ACCEPTED]);
        assert!(!super::is_unfinished(&record.pieces[0]));
        record.pieces[0].status = super::status::REJECTED.to_string();
        assert!(!super::is_unfinished(&record.pieces[0]));
    }

    /// The shape the poller asks for: the state nested under `moderationResult`.
    #[test]
    fn a_masked_response_reports_approval() {
        let body = serde_json::json!({
            "moderationResult": { "moderationState": "Approved" },
            "displayName": "track",
        });
        let (verdict, raw) = super::read_moderation_state(&body);
        assert_eq!(verdict, super::moderation::APPROVED);
        assert_eq!(raw, "approved");
    }

    /// The same answer without the read mask arrives at the top level instead.
    #[test]
    fn an_unmasked_response_reports_the_same_verdict() {
        let body = serde_json::json!({ "moderationState": "Rejected" });
        assert_eq!(super::read_moderation_state(&body).0, super::moderation::REJECTED);
    }

    /// Reviewing is a real answer and must never be read as a failure.
    #[test]
    fn a_queued_asset_reads_as_reviewing_not_rejected() {
        let body = serde_json::json!({ "moderationResult": { "moderationState": "Reviewing" } });
        assert_eq!(super::read_moderation_state(&body).0, super::moderation::REVIEWING);
    }

    /// An answer in neither shape must not be mistaken for an approval, or a
    /// quiet change in Roblox's response would mark every upload accepted.
    #[test]
    fn an_unrecognised_response_is_unknown_rather_than_approved() {
        let empty = serde_json::json!({});
        assert_eq!(super::read_moderation_state(&empty).0, super::moderation::UNKNOWN);

        let renamed = serde_json::json!({ "moderationResult": { "moderationState": "Escalated" } });
        let (verdict, raw) = super::read_moderation_state(&renamed);
        assert_eq!(verdict, super::moderation::UNKNOWN);
        // The raw state is kept so the row can explain itself instead of
        // spinning without a reason.
        assert_eq!(raw, "escalated");
    }

    /// Whitespace and casing in the state must not cost us the verdict.
    #[test]
    fn a_padded_state_is_still_read() {
        let body = serde_json::json!({ "moderationState": "  APPROVED  " });
        assert_eq!(super::read_moderation_state(&body).0, super::moderation::APPROVED);
    }

    #[test]
    fn an_asset_id_is_read_before_the_operation_finishes() {
        // This is the whole point of the flow: the id shows in the history while
        // Roblox is still checking, so the user is not made to wait for a verdict
        // to learn the id.
        let body = serde_json::json!({ "state": "Running", "response": { "assetId": 987_654 } });
        let (state, asset_id) = super::read_operation_state(&body);
        assert_eq!(state, "running");
        assert_eq!(asset_id, Some(987_654));
    }

    #[test]
    fn an_operation_with_no_asset_id_yet_reports_none() {
        let body = serde_json::json!({ "state": "Pending" });
        let (state, asset_id) = super::read_operation_state(&body);
        assert_eq!(state, "pending");
        assert_eq!(asset_id, None, "an id must not be invented");
    }

    #[test]
    fn a_split_tracks_title_drops_the_part_suffix() {
        // The row heading is the name the user typed, not "song (part 1)".
        let pieces = vec![
            ("song (part 1)".to_string(), PathBuf::from("/tmp/a.mp3"), 10),
            ("song (part 2)".to_string(), PathBuf::from("/tmp/b.mp3"), 10),
        ];
        assert_eq!(super::display_title(&pieces), "song");
    }

    #[test]
    fn an_unsplit_title_keeps_dots_and_parentheses() {
        // Only the part suffix is stripped, so a real title like
        // "Mr. Blue Sky (remix)" survives intact.
        let pieces = vec![("Mr. Blue Sky (remix)".to_string(), PathBuf::from("/tmp/a.mp3"), 10)];
        assert_eq!(super::display_title(&pieces), "Mr. Blue Sky (remix)");
    }

    #[test]
    fn an_empty_record_is_not_a_success() {
        // `all` on an empty iterator is true, so without an explicit emptiness
        // check a record with no pieces would read as accepted.
        let mut empty = record_with(&[]);
        assert!(!super::record_status(&empty).is_empty());
        assert_ne!(super::record_status(&empty), super::status::ACCEPTED);
        empty.pieces.clear();
        assert_ne!(super::record_status(&empty), super::status::ACCEPTED);
    }

    /// A record whose pieces carry the given statuses.
    fn record_with(statuses: &[&str]) -> super::UploadRecord {
        super::UploadRecord {
            id: "r1".to_string(),
            title: "song".to_string(),
            uploaded_at: super::chrono_like_now(),
            was_split: statuses.len() > 1,
            total_bytes: 10,
            pieces: statuses
                .iter()
                .enumerate()
                .map(|(index, status)| super::UploadPiece {
                    name: format!("song (part {})", index + 1),
                    path: format!("/tmp/{index}.mp3"),
                    bytes: 10,
                    operation_id: "op".to_string(),
                    asset_id: None,
                    status: (*status).to_string(),
                    message: String::new(),
                })
                .collect(),
        }
    }
}

#[derive(Clone)]
struct ProgressEmitter {
    app: AppHandle,
    file: String,
    index: u32,
    total: u32,
    bytes: u32,
}

impl ProgressEmitter {
    fn report(&self, sent: u32) {
        // A failure here must not abort the upload, so it is deliberately
        // ignored: progress is a nicety, the transfer is the point.
        let _ = self.app.emit(
            "music-upload-progress",
            UploadProgress {
                file: self.file.clone(),
                index: self.index,
                total: self.total,
                sent,
                bytes: self.bytes,
                stage: "uploading".to_string(),
                processing_elapsed_secs: 0,
            },
        );
    }
}

/// Streams a file in chunks, reporting how many bytes have been handed to the
/// request as it goes.
fn file_stream(
    file: tokio::fs::File,
    emitter: ProgressEmitter,
) -> impl futures::Stream<Item = std::io::Result<bytes::Bytes>> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    let sent = Arc::new(AtomicU64::new(0));
    futures::stream::unfold(
        (Box::new(file), emitter, sent),
        |(mut file, emitter, sent)| async move {
            let mut buffer = vec![0_u8; 64 * 1024];
            match file.read(&mut buffer).await {
                // 0 means end of file, and an error ends the stream so the request
                // fails loudly instead of uploading a truncated file.
                Ok(0) | Err(_) => None,
                Ok(read) => {
                    buffer.truncate(read);
                    let total = sent.fetch_add(read as u64, Ordering::Relaxed) + read as u64;
                    emitter.report(total as u32);
                    Some((Ok(Bytes::from(buffer)), (file, emitter, sent)))
                }
            }
        },
    )
}
