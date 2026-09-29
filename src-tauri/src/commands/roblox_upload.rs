use std::path::{Path, PathBuf};

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;

use crate::error::AppError;

type Result<T> = crate::error::Result<T>;

const ASSETS_BASE: &str = "https://apis.roblox.com";
const CREATE_ASSET: &str = "https://apis.roblox.com/assets/v1/assets";
const OPERATIONS: &str = "https://apis.roblox.com/assets/v1/operations";
const QUOTAS: &str = "https://apis.roblox.com/cloud/v2/users";

/// How long to wait for Roblox to finish processing an upload.
const OPERATION_TIMEOUT_SECS: u64 = 180;
const OPERATION_POLL_MS: u64 = 1500;

/// Roblox rejects audio over 7 minutes and anything over 20 MB.
pub const MAX_AUDIO_SECS: f64 = 7.0 * 60.0;
pub const MAX_UPLOAD_BYTES: u64 = 20 * 1024 * 1024;

/// Emitted while a piece uploads so the Music view can show live progress.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    pub file: String,
    pub index: usize,
    pub total: usize,
    pub sent: u64,
    pub bytes: u64,
    /// "uploading" while bytes move, "processing" while Roblox approves.
    pub stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadedAsset {
    pub name: String,
    pub asset_id: u64,
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadSummary {
    pub assets: Vec<UploadedAsset>,
    pub was_split: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioQuota {
    pub remaining: u64,
    pub limit: u64,
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
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
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

/// Uploads the rendered pieces as new Roblox assets.
///
/// Roblox cannot update an existing audio asset, so a track that had to be
/// split becomes one asset per piece. Each piece is uploaded on its own because
/// the 20 MB limit applies per request.
pub async fn upload_pieces(
    app: &AppHandle,
    files: &[(String, PathBuf)],
    creator_user_id: u64,
) -> Result<UploadSummary> {
    if files.is_empty() {
        return Err("There is nothing to upload.".into());
    }
    if creator_user_id == 0 {
        return Err(
            "Add a Roblox account and an Open Cloud API key before uploading.".into(),
        );
    }

    let key = api_key()?;
    let client = crate::utils::get_http_client();
    let total = files.len();

    let mut assets = Vec::with_capacity(total);
    for (index, (name, path)) in files.iter().enumerate() {
        let asset_id = upload_one(
            &client,
            &key,
            name,
            path,
            index,
            total,
            app,
            creator_user_id,
        )
        .await?;

        assets.push(UploadedAsset {
            name: name.clone(),
            asset_id,
            path: path.to_string_lossy().to_string(),
            bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        });
    }

    // Permissions are applied after every asset exists, so a partial failure
    // still leaves usable assets rather than uploads nobody can load.
    for asset in &assets {
        grant_use_permission(&client, &key, asset.asset_id).await?;
    }

    Ok(UploadSummary {
        assets,
        was_split: total > 1,
    })
}

#[allow(clippy::too_many_arguments)]
async fn upload_one(
    client: &reqwest::Client,
    key: &str,
    name: &str,
    path: &Path,
    index: usize,
    total: usize,
    app: &AppHandle,
    creator_user_id: u64,
) -> Result<u64> {
    let size = std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| AppError::Custom(format!("Could not read {}: {e}", name)))?;

    if size > MAX_UPLOAD_BYTES {
        return Err(AppError::Custom(format!(
            "\"{name}\" is {:.1} MB, over Roblox's 20 MB limit per upload.",
            size as f64 / (1024.0 * 1024.0)
        )));
    }

    let content_type = content_type_for(path)?;
    // The name is kept under Roblox's 100 character limit, and the creator has
    // to be the uploader's own user id or the asset is rejected.
    let display_name: String = name.chars().take(100).collect();
    let request = serde_json::json!({
        "assetType": "Audio",
        "displayName": display_name,
        "description": display_name,
        "creator": { "userId": creator_user_id },
    });

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| AppError::Custom(format!("Could not open {}: {e}", name)))?;

    let emitter = ProgressEmitter {
        app: app.clone(),
        file: name.to_string(),
        index,
        total,
        bytes: size,
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

    let response = client
        .post(CREATE_ASSET)
        .header("x-api-key", key)
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(describe(&body, status.as_u16()));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| AppError::Custom(e.to_string()))?;
    let operation_id = parsed
        .get("operationId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            AppError::Custom(format!("Roblox did not return an operation id for \"{name}\"."))
        })?
        .to_string();

    wait_for_operation(client, key, &operation_id, name, index, total, app).await
}

/// Polls until Roblox finishes processing, then returns the asset id.
async fn wait_for_operation(
    client: &reqwest::Client,
    key: &str,
    operation_id: &str,
    name: &str,
    index: usize,
    total: usize,
    app: &AppHandle,
) -> Result<u64> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(OPERATION_TIMEOUT_SECS);

    loop {
        if std::time::Instant::now() > deadline {
            return Err(AppError::Custom(format!(
                "Roblox is still processing \"{name}\". Check your Creator Dashboard in a few minutes."
            )));
        }

        tokio::time::sleep(std::time::Duration::from_millis(OPERATION_POLL_MS)).await;

        let _ = app.emit(
            "music-upload-progress",
            UploadProgress {
                file: name.to_string(),
                index,
                total,
                sent: 0,
                bytes: 0,
                stage: "processing".to_string(),
            },
        );

        let response = client
            .get(format!("{OPERATIONS}/{operation_id}"))
            .header("x-api-key", key)
            .send()
            .await?;

        if !response.status().is_success() {
            continue;
        }

        let parsed: serde_json::Value = response.json().await?;
        let state = parsed
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        match state.as_str() {
            "succeeded" | "completed" => {
                return parsed
                    .get("response")
                    .and_then(|r| r.get("assetId"))
                    .and_then(serde_json::Value::as_u64)
                    .ok_or_else(|| {
                        AppError::Custom(format!(
                            "Roblox approved \"{name}\" but did not return an asset id."
                        ))
                    });
            }
            "failed" | "error" => {
                let message = parsed
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("no reason given");
                return Err(AppError::Custom(format!(
                    "Roblox rejected \"{name}\": {message}"
                )));
            }
            _ => {}
        }
    }
}

/// Grants the uploader permission to use the asset in their own experience.
///
/// Audio cannot be updated in place on Roblox, so a new asset is created
/// without a universe attached. Without this the asset stays owned-but-unusable
/// and a place cannot load it.
async fn grant_use_permission(
    client: &reqwest::Client,
    key: &str,
    asset_id: u64,
) -> Result<()> {
    let response = client
        .patch(format!(
            "{ASSETS_BASE}/asset-permissions-api/v1/assets/permissions"
        ))
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

    let remaining = entry
        .get("remaining")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let limit = entry
        .get("limit")
        .or_else(|| entry.get("capacity"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);

    Ok((remaining, limit))
}

/// Uploads one rendered piece and returns the new Roblox asset id.
#[tauri::command]
#[specta::specta]
pub async fn upload_audio_piece(
    app: AppHandle,
    path: String,
    name: String,
    creator_user_id: u64,
) -> Result<UploadedAsset> {
    let file_path = PathBuf::from(path.trim());
    if !file_path.is_file() {
        return Err("The exported file could not be found. Export it again.".into());
    }

    let summary = upload_pieces(&app, &[(name.clone(), file_path.clone())], creator_user_id).await?;

    summary
        .assets
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Custom("Roblox did not return an asset for that file.".into()))
}

/// Uploads every rendered piece, for a track that was split.
#[tauri::command]
#[specta::specta]
pub async fn upload_audio_parts(
    app: AppHandle,
    paths: Vec<String>,
    creator_user_id: u64,
) -> Result<UploadSummary> {
    let mut files: Vec<(String, PathBuf)> = Vec::with_capacity(paths.len());

    for path in paths {
        let file_path = PathBuf::from(path.trim());
        if !file_path.is_file() {
            return Err(
                format!("\"{}\" could not be found. Export the track again.", file_path.display())
                    .into(),
            );
        }
        let name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("track")
            .to_string();
        files.push((name, file_path));
    }

    upload_pieces(&app, &files, creator_user_id).await
}

/// Audio uploads left this month, according to Roblox.
#[tauri::command]
#[specta::specta]
pub async fn fetch_open_cloud_audio_quota(creator_user_id: u64) -> Result<AudioQuota> {
    if creator_user_id == 0 {
        return Err("Add a Roblox account first.".into());
    }

    let key = api_key()?;
    let client = crate::utils::get_http_client();
    let (remaining, limit) = audio_quota(&client, &key, creator_user_id).await?;

    Ok(AudioQuota { remaining, limit })
}

/// Turns a Roblox error body into something a user can act on.
fn describe(body: &str, status: u16) -> AppError {    let parsed: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);

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
    use super::{content_type_for, describe, MAX_UPLOAD_BYTES};
    use crate::error::AppError;
    use std::path::Path;

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
        let error = describe(
            r#"{"message":"Asset type not supported","errors":[{"message":"bad"}]}"#,
            400,
        );
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
}

#[derive(Clone)]
struct ProgressEmitter {
    app: AppHandle,
    file: String,
    index: usize,
    total: usize,
    bytes: u64,
}

impl ProgressEmitter {
    fn report(&self, sent: u64) {
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
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    let sent = Arc::new(AtomicU64::new(0));
    futures::stream::unfold((Box::new(file), emitter, sent), |(mut file, emitter, sent)| async move {
        let mut buffer = vec![0_u8; 64 * 1024];
        match file.read(&mut buffer).await {
            // 0 means end of file, and an error ends the stream so the request
            // fails loudly instead of uploading a truncated file.
            Ok(0) | Err(_) => None,
            Ok(read) => {
                buffer.truncate(read);
                let total = sent.fetch_add(read as u64, Ordering::Relaxed) + read as u64;
                emitter.report(total);
                Some((Ok(Bytes::from(buffer)), (file, emitter, sent)))
            }
        }
    })
}
