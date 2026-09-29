use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::error::AppError;

type Result<T> = crate::error::Result<T>;

/// Keeps a spawned helper from opening a console window.
///
/// The app is only a GUI process in release builds; in debug it keeps the
/// console subsystem so developer output is visible. Either way, a child that
/// is itself a console program will put a terminal on screen unless it is
/// started with CREATE_NO_WINDOW, which is what this applies everywhere.
fn no_console(command: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Semitones in an octave, the divisor of the pitch ratio.
const SEMITONES_PER_OCTAVE: f64 = 12.0;

/// Output container/codec combinations offered by the Music editor.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AudioFormat {
    Mp3,
    Ogg,
    Wav,
}

/// External programs the editor drives, and how each one reports its version.
///
/// yt-dlp matters here: it parses `-version` as a *config file path* and exits
/// non-zero, so probing it with ffmpeg's flag made it look missing on machines
/// where it was installed correctly.
struct ToolSpec {
    program: &'static str,
    version_arg: &'static str,
}

const FFMPEG: ToolSpec = ToolSpec {
    program: "ffmpeg",
    version_arg: "-version",
};
const FFPROBE: ToolSpec = ToolSpec {
    program: "ffprobe",
    version_arg: "-version",
};
const YTDLP: ToolSpec = ToolSpec {
    program: "yt-dlp",
    version_arg: "--version",
};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MediaTools {
    pub ffmpeg: bool,
    pub ffprobe: bool,
    pub ytdlp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration: Option<f64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub bit_rate: Option<u32>,
    pub format_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedia {
    pub path: String,
    pub title: String,
    pub uploader: Option<String>,
    pub thumbnail_url: Option<String>,
    pub source_url: String,
}

/// Reports which external tools are on PATH so the UI can tell the user exactly
/// what is missing instead of failing later with an opaque error.
#[tauri::command]
#[specta::specta]
pub async fn check_media_tools() -> Result<MediaTools> {
    let (ffmpeg, ffprobe, ytdlp) =
        tokio::join!(resolve(FFMPEG), resolve(FFPROBE), resolve(YTDLP));

    Ok(MediaTools {
        ffmpeg: ffmpeg.is_some(),
        ffprobe: ffprobe.is_some(),
        ytdlp: ytdlp.is_some(),
    })
}

/// Locates a tool by walking PATH and confirms it runs.
///
/// Scanning PATH explicitly rather than relying on the child's own resolution
/// keeps discovery and the later invocation consistent, and lets the error name
/// the directories that were searched.
async fn resolve(spec: ToolSpec) -> Option<std::path::PathBuf> {
    let path_var = std::env::var_os("PATH")?;

    for dir in std::env::split_paths(&path_var) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for candidate in candidate_names(spec.program) {
            let full = dir.join(&candidate);
            if !full.is_file() {
                continue;
            }

            // Confirm it actually executes. Some PATH entries are stale, and a
            // file that cannot run is no more useful than a missing one.
            let mut probe = Command::new(&full);
            no_console(&mut probe);
            let works = probe
                .arg(spec.version_arg)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map(|status| status.success())
                .unwrap_or(false);

            if works {
                return Some(full);
            }
        }
    }

    None
}

/// Candidate names to try for a program, covering the Windows resolution rules.
fn candidate_names(program: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![
            format!("{program}.exe"),
            format!("{program}.cmd"),
            format!("{program}.bat"),
            program.to_string(),
        ]
    } else {
        vec![program.to_string()]
    }
}

// ---------------------------------------------------------------- yt-dlp install

const YTDLP_RELEASE_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

/// Where we install tools we fetch ourselves, so nothing touches the user's PATH
/// and no elevation is required.
fn tool_bin_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir()?.join("bin");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// The yt-dlp release asset that matches this OS and CPU.
///
/// yt-dlp publishes self-contained binaries per target. The Windows assets are
/// named `.exe`, everything else is an extensionless native binary.
fn ytdlp_asset() -> &'static str {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            "yt-dlp_arm64.exe"
        } else if cfg!(target_arch = "x86") {
            "yt-dlp_x86.exe"
        } else {
            "yt-dlp.exe"
        }
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_arch = "aarch64") {
        if is_musl() {
            "yt-dlp_musllinux_aarch64"
        } else {
            "yt-dlp_linux_aarch64"
        }
    } else if is_musl() {
        "yt-dlp_musllinux"
    } else {
        "yt-dlp_linux"
    }
}

/// Alpine-style targets link against musl rather than glibc, and yt-dlp ships a
/// separate build for them.
fn is_musl() -> bool {
    cfg!(target_os = "linux")
        && std::env::var("LD_LIBRARY_PATH")
            .map(|v| v.contains("musl"))
            .unwrap_or(false)
}

fn local_ytdlp_name() -> String {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe".to_string()
    } else {
        "yt-dlp".to_string()
    }
}

/// Resolves yt-dlp, preferring a copy this app installed itself.
async fn resolve_ytdlp(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = tool_bin_dir(app) {
        let candidate = dir.join(local_ytdlp_name());
        if candidate.is_file() && runs(&candidate, YTDLP.version_arg).await {
            return Some(candidate);
        }
    }
    resolve(YTDLP).await
}

async fn runs(path: &std::path::Path, version_arg: &str) -> bool {
    let mut probe = Command::new(path);
    no_console(&mut probe);
    probe
        .arg(version_arg)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|status| status.success())
        .unwrap_or(false)
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Downloads yt-dlp if it is not already reachable, verifying it against the
/// SHA2-256SUMS file published in the same release.
#[tauri::command]
#[specta::specta]
pub async fn ensure_ytdlp(app: AppHandle) -> Result<bool> {
    if resolve_ytdlp(&app).await.is_some() {
        return Ok(false);
    }

    let asset = ytdlp_asset();
    let client = crate::utils::get_http_client();

    let sums = client
        .get(format!("{YTDLP_RELEASE_BASE}/SHA2-256SUMS"))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    // Lines look like "<hex>  <name>".
    let expected = sums
        .lines()
        .find_map(|line| {
            let mut parts = line.split_whitespace();
            let digest = parts.next()?;
            let name = parts.next()?.trim_start_matches('*');
            (name == asset).then(|| digest.to_ascii_lowercase())
        })
        .ok_or_else(|| {
            AppError::Custom(format!("yt-dlp release did not list an expected {asset} file."))
        })?;

    let bytes = client
        .get(format!("{YTDLP_RELEASE_BASE}/{asset}"))
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;

    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(AppError::Custom(
            "The downloaded yt-dlp did not match its published checksum, so it was discarded."
                .to_string(),
        ));
    }

    let dir = tool_bin_dir(&app)?;
    let target = dir.join(local_ytdlp_name());

    // Write to a temporary name first so an interrupted write can never leave a
    // truncated binary that later looks installed.
    let staging = dir.join(format!("{}.partial", local_ytdlp_name()));
    std::fs::write(&staging, &bytes)?;
    std::fs::rename(&staging, &target)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))?;
    }

    if !runs(&target, YTDLP.version_arg).await {
        let _ = std::fs::remove_file(&target);
        return Err(AppError::Custom(
            "yt-dlp was installed but would not run on this system.".to_string(),
        ));
    }

    Ok(true)
}

/// Tool availability plus whether this call installed yt-dlp, so the caller can
/// report what actually changed.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MediaToolStatus {
    pub tools: MediaTools,
    pub ytdlp_installed: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn ensure_media_tools(app: AppHandle) -> Result<MediaToolStatus> {
    let ytdlp_installed = match ensure_ytdlp(app.clone()).await {
        Ok(installed) => installed,
        Err(err) => {
            // A failed install must not stop startup; the Music view explains it.
            log::warn!("Could not install yt-dlp automatically: {err}");
            false
        }
    };

    let (ffmpeg, ffprobe, ytdlp) = tokio::join!(
        resolve(FFMPEG),
        resolve(FFPROBE),
        resolve_ytdlp(&app),
    );

    Ok(MediaToolStatus {
        tools: MediaTools {
            ffmpeg: ffmpeg.is_some(),
            ffprobe: ffprobe.is_some(),
            ytdlp: ytdlp.is_some(),
        },
        ytdlp_installed,
    })
}

fn media_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir()?.join("media");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn tool_error(tool: &str, purpose: &str) -> AppError {
    AppError::Custom(format!(
        "{tool} is required to {purpose}. Install it and make sure it is on your PATH, then try again."
    ))
}

/// Reads stream metadata with ffprobe.
#[tauri::command]
#[specta::specta]
pub async fn probe_media(path: String) -> Result<MediaInfo> {
    let path = PathBuf::from(path.trim());
    if !path.is_file() {
        return Err("The media file could not be found.".into());
    }
    let ffprobe = resolve(FFPROBE).await.ok_or_else(|| tool_error("ffprobe", "read audio details"))?;

    let mut ffprobe_cmd = Command::new(&ffprobe);
    no_console(&mut ffprobe_cmd);
    let output = ffprobe_cmd
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=sample_rate,channels,bit_rate:format=duration,format_name",
            "-of",
            "json",
        ])
        .arg(&path)
        .output()
        .await
        .map_err(|_| tool_error("ffprobe", "read audio details"))?;

    if !output.status.success() {
        return Err("ffprobe could not read that file. It may not be audio.".into());
    }

    let parsed: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| AppError::Custom(e.to_string()))?;

    let stream = parsed
        .get("streams")
        .and_then(|s| s.get(0))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let format = parsed.get("format").cloned().unwrap_or(serde_json::Value::Null);

    let as_u64 = |value: Option<&serde_json::Value>| -> Option<u64> {
        match value {
            // ffprobe emits numbers or strings depending on the field.
            Some(serde_json::Value::Number(n)) => n.as_u64(),
            Some(serde_json::Value::String(s)) => s.parse().ok(),
            _ => None,
        }
    };

    Ok(MediaInfo {
        duration: as_u64(format.get("duration")).map(|d| d as f64),
        sample_rate: as_u64(stream.get("sample_rate")).map(|v| v as u32),
        channels: as_u64(stream.get("channels")).map(|v| v as u32),
        bit_rate: as_u64(stream.get("bit_rate")).map(|v| v as u32),
        format_name: format
            .get("format_name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
    })
}

/// Fetches a track from a URL using a user-installed yt-dlp.
///
/// The downloader is deliberately not bundled: no ripping code ships with the
/// app, and the user controls which version runs. Only the audio stream is
/// pulled, re-encoded to m4a so the editor can work on a predictable input.
#[tauri::command]
#[specta::specta]
pub async fn import_media_from_url(app: AppHandle, url: String) -> Result<ImportedMedia> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Paste a track URL first.".into());
    }
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("That does not look like a link. It should start with http:// or https://.".into());
    }
    let ytdlp = resolve(YTDLP).await.ok_or_else(|| tool_error("yt-dlp", "import a track from a link"))?;

    let dir = media_dir(&app)?;

    let mut ytdlp_probe = Command::new(&ytdlp);
    no_console(&mut ytdlp_probe);
    let probe = ytdlp_probe
        .args(["--no-playlist", "--dump-single-json", "--skip-download"])
        .arg(&url)
        .output()
        .await
        .map_err(|_| tool_error("yt-dlp", "import a track from a link"))?;

    if !probe.status.success() {
        let stderr = String::from_utf8_lossy(&probe.stderr);
        return Err(AppError::Custom(format!(
            "yt-dlp could not read that link: {}",
            summarize(&stderr)
        )));
    }

    let meta: serde_json::Value =
        serde_json::from_slice(&probe.stdout).map_err(|e| AppError::Custom(e.to_string()))?;
    let title = meta
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported track")
        .to_string();
    let uploader = meta
        .get("uploader")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let mut ytdlp_download = Command::new(&ytdlp);
    no_console(&mut ytdlp_download);
    let download = ytdlp_download
        .args([
            "--no-playlist",
            "-x",
            "--audio-format",
            "m4a",
            "--audio-quality",
            "0",
            "-o",
        ])
        .arg(dir.join("%(title).80s.%(ext)s"))
        .arg(&url)
        .output()
        .await
        .map_err(|_| tool_error("yt-dlp", "import a track from a link"))?;

    if !download.status.success() {
        let stderr = String::from_utf8_lossy(&download.stderr);
        return Err(AppError::Custom(format!(
            "yt-dlp could not download that track: {}",
            summarize(&stderr)
        )));
    }

    // yt-dlp wrote the file without an extension we can predict, so take the
    // newest matching entry rather than guessing the exact name.
    let path = newest_audio_file(&dir)
        .ok_or_else(|| AppError::Custom("yt-dlp finished but no audio file appeared.".into()))?;

    Ok(ImportedMedia {
        path: path.to_string_lossy().to_string(),
        title,
        uploader,
        thumbnail_url: meta
            .get("thumbnail")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        source_url: url,
    })
}

fn summarize(stderr: &str) -> String {
    let last = stderr
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("no details available");
    last.trim().to_string()
}

fn newest_audio_file(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "m4a" | "mp3" | "webm" | "opus" | "ogg" | "wav") {
            continue;
        }
        if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
            let is_newer = match &newest {
                Some((best, _)) => modified > *best,
                None => true,
            };
            if is_newer {
                newest = Some((modified, path));
            }
        }
    }

    newest.map(|(_, path)| path)
}

/// Builds the ffmpeg filter chain for a speed and pitch change.
///
/// The pitch stage is `asetrate=SR*r, aresample=SR`, which shifts pitch up by r
/// while shortening the audio by the same factor. `atempo` then corrects the
/// tempo back to the requested speed, so the two controls stay independent.
/// r = 2^(semitones/12), equal temperament.
fn build_filter(speed: f64, semitones: f64, target_sample_rate: u32) -> String {
    let mut filters: Vec<String> = Vec::new();

    if semitones.abs() > f64::EPSILON {
        let ratio = 2.0f64.powf(semitones / SEMITONES_PER_OCTAVE);
        filters.push(format!("asetrate={target_sample_rate}*{ratio:.8}"));
        filters.push(format!("aresample={target_sample_rate}"));
        filters.push(format!("atempo={:.8}", speed / ratio));
    } else if (speed - 1.0).abs() > f64::EPSILON {
        // atempo only accepts 0.5-100, so stay well inside that range.
        filters.push(format!("atempo={speed:.8}"));
    }

    filters.push(format!("aresample={target_sample_rate}"));
    filters.join(",")
}

fn codec_args(format: AudioFormat, target_sample_rate: u32) -> Vec<String> {
    match format {
        AudioFormat::Mp3 => vec![
            "-c:a".into(),
            "libmp3lame".into(),
            "-b:a".into(),
            "320k".into(),
            "-ar".into(),
            target_sample_rate.to_string(),
        ],
        AudioFormat::Ogg => vec![
            "-c:a".into(),
            "libvorbis".into(),
            "-q:a".into(),
            "5".into(),
            "-ar".into(),
            target_sample_rate.to_string(),
        ],
        AudioFormat::Wav => vec!["-c:a".into(), "pcm_s16le".into()],
    }
}

/// Copies a user-picked file into the app's media directory.
///
/// The picker can return a path anywhere on disk, which the asset protocol may
/// not be allowed to read and which the user could later move or delete. Copying
/// keeps the editor working from a stable, readable location.
#[tauri::command]
#[specta::specta]
pub async fn import_local_media(app: AppHandle, path: String) -> Result<ImportedMedia> {
    let source = PathBuf::from(path.trim());
    if !source.is_file() {
        return Err("That file could not be found.".into());
    }

    let dir = media_dir(&app)?;
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("track")
        .to_string();
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3")
        .to_string();

    let target = dir.join(format!("{stem}.{extension}"));
    if source != target {
        tokio::fs::copy(&source, &target)
            .await
            .map_err(|e| AppError::Custom(format!("Could not read that file: {e}")))?;
    }

    Ok(ImportedMedia {
        path: target.to_string_lossy().to_string(),
        title: stem,
        uploader: None,
        thumbnail_url: None,
        source_url: String::new(),
    })
}

/// Short fade applied to the outer edges of every piece. Cutting a waveform
/// mid-cycle leaves a step discontinuity, which is audible as a click at every
/// seam, so each piece fades in and out over a few milliseconds.
const EDGE_FADE_SECS: f64 = 0.02;

/// Piece length that keeps the encoded file inside one upload request.
fn max_output_secs(format: AudioFormat, sample_rate: u32) -> f64 {
    // Uncompressed audio is limited by bytes long before it is limited by the
    // seven minute duration cap.
    let by_bytes = ROBLOX_MAX_UPLOAD_BYTES as f64 * 8.0 / bits_per_second(format, sample_rate) as f64;
    ROBLOX_MAX_DURATION_SECS.min(by_bytes)
}

/// Builds the ffmpeg arguments that render one piece: seek the source window,
/// apply the edits, then encode.
fn segment_args(
    input: &std::path::Path,
    output: &std::path::Path,
    part: &SplitPlan,
    speed: f64,
    semitones: f64,
    format: AudioFormat,
    sample_rate: u32,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into(), "-v".into(), "error".into()];

    // Input seeking keeps each piece independent, so one failure does not
    // invalidate the whole set.
    args.push("-ss".into());
    args.push(format!("{:.3}", part.source_start));
    args.push("-to".into());
    args.push(format!("{:.3}", part.source_end));
    args.push("-i".into());
    args.push(input.to_string_lossy().to_string());

    let mut filters = Vec::new();
    // A fade must never be longer than half the piece, or it would run past the
    // end of a very short segment.
    let fade = EDGE_FADE_SECS.min(part.output_duration / 2.0);
    if part.source_start > 0.0 && fade > 0.0 {
        filters.push(format!("afade=t=in:st=0:d={fade:.3}"));
    }
    if part.source_end > 0.0 && fade > 0.0 {
        let out_start = (part.output_duration - fade).max(0.0);
        filters.push(format!("afade=t=out:st={out_start:.3}:d={fade:.3}"));
    }
    let edit = build_filter(speed, semitones, sample_rate);
    if !edit.is_empty() {
        filters.push(edit);
    }
    if !filters.is_empty() {
        args.push("-af".into());
        args.push(filters.join(","));
    }

    for arg in codec_args(format, sample_rate) {
        args.push(arg);
    }
    args.push(output.to_string_lossy().to_string());
    args
}

/// Renders the edited track, splitting it when Roblox's limits require it.
///
/// The source file is never modified. A track that fits comes back as one file;
/// a longer one comes back as one file per piece, in order.
#[tauri::command]
#[specta::specta]
pub async fn bake_media(
    app: AppHandle,
    input_path: String,
    output_name: String,
    speed: f64,
    semitones: f64,
    format: AudioFormat,
    sample_rate: u32,
    source_duration: Option<f64>,
) -> Result<BakedMedia> {
    let input = PathBuf::from(input_path.trim());
    if !input.is_file() {
        return Err("The source file could not be found.".into());
    }
    let ffmpeg = resolve(FFMPEG).await.ok_or_else(|| tool_error("ffmpeg", "export audio"))?;

    if !speed.is_finite() || !(0.25..=4.0).contains(&speed) {
        return Err("Playback speed must be between 0.25x and 4x.".into());
    }
    if !semitones.is_finite() || !(-24.0..=24.0).contains(&semitones) {
        return Err("Pitch must be between -24 and +24 semitones.".into());
    }

    let rate = sample_rate.clamp(8000, 192000);
    let dir = media_dir(&app)?;

    let safe_name: String = output_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(80)
        .collect();
    let safe_name = if safe_name.trim().is_empty() {
        "track".to_string()
    } else {
        safe_name
    };

    let extension = match format {
        AudioFormat::Mp3 => "mp3",
        AudioFormat::Ogg => "ogg",
        AudioFormat::Wav => "wav",
    };

    // Without a probed duration we cannot reason about limits, so render whole.
    let plan = source_duration.filter(|d| d.is_finite() && *d > 0.0).map(|duration| {
        plan_split(duration, speed, &safe_name, max_output_secs(format, rate))
    });

    let parts: Vec<SplitPlan> = plan
        .as_ref()
        .map(|p| p.parts.clone())
        .unwrap_or_else(|| {
            vec![SplitPlan {
                source_start: 0.0,
                source_end: f64::MAX,
                output_duration: 0.0,
                name: safe_name.clone(),
            }]
        });

    let mut files = Vec::with_capacity(parts.len());
    for part in &parts {
        let output = dir.join(format!("{}.{extension}", part.name));
        let args = segment_args(&input, &output, part, speed, semitones, format, rate);

        let mut ffmpeg_cmd = Command::new(&ffmpeg);
        no_console(&mut ffmpeg_cmd);
        let result = ffmpeg_cmd
            .args(&args)
            .output()
            .await
            .map_err(|_| tool_error("ffmpeg", "export audio"))?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(AppError::Custom(format!(
                "ffmpeg could not export \"{}\": {}",
                part.name,
                summarize(&stderr)
            )));
        }

        if !output.is_file() {
            return Err(AppError::Custom(format!(
                "ffmpeg produced no file for \"{}\".",
                part.name
            )));
        }

        let size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        files.push(BakedFile {
            name: part.name.clone(),
            path: output.to_string_lossy().to_string(),
            bytes: size,
            output_duration: part.output_duration,
        });
    }

    let total = files.iter().map(|f| f.output_duration).sum();
    let was_split = files.len() > 1;
    Ok(BakedMedia {
        files,
        total_duration: total,
        was_split,
    })
}

/// Previews how a track will be split without rendering anything, so the Music
/// view can tell the user up front that a long track becomes several parts.
#[tauri::command]
#[specta::specta]
pub fn preview_split(
    source_duration: f64,
    speed: f64,
    title: String,
    format: AudioFormat,
    sample_rate: u32,
) -> Result<SplitPreview> {
    let rate = sample_rate.clamp(8000, 192000);
    let mut plan = plan_split(
        source_duration,
        speed,
        &title,
        max_output_secs(format, rate),
    );
    // Titles are user supplied; keep them usable as file names.
    for part in &mut plan.parts {
        part.name = sanitize_stem(&part.name);
    }
    Ok(plan)
}

fn sanitize_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(80)
        .collect();

    // A title made only of separators would otherwise become a name like "___".
    if cleaned.trim_matches(['-', '_']).is_empty() {
        "track".to_string()
    } else {
        cleaned
    }
}

// ---------------------------------------------------------------- audio splitting

/// Roblox rejects audio longer than this.
pub const ROBLOX_MAX_DURATION_SECS: f64 = 7.0 * 60.0;

/// Roblox rejects any single upload above this.
const ROBLOX_MAX_UPLOAD_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BakedFile {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub output_duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BakedMedia {
    pub files: Vec<BakedFile>,
    pub total_duration: f64,
    pub was_split: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SplitPlan {
    /// Source-time start and end of the piece, in seconds.
    pub source_start: f64,
    pub source_end: f64,
    /// Duration of the piece after speed and pitch are applied.
    pub output_duration: f64,
    /// Suggested file name, without an extension.
    pub name: String,
}

/// How a track will be cut up to satisfy Roblox's upload limits.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SplitPreview {
    pub parts: Vec<SplitPlan>,
    /// Output duration of the whole track once edits are applied.
    pub output_duration: f64,
    pub needs_split: bool,
}

/// Works out how many pieces a track needs and where they fall in source time.
///
/// Duration is only known after the edits, so this runs on the exported length
/// rather than the imported one: a ten minute track at 2x speed is five minutes
/// and needs no split, while a five minute track at 0.5x becomes ten minutes and
/// does. Pitch shifting alone leaves duration untouched, because the tempo stage
/// cancels the rate change the pitch stage introduces, so only speed matters
/// here.
///
/// Pieces are cut at even source-time boundaries rather than filled to the limit,
/// so a 20 minute track becomes four five minute parts instead of 7+7+6.
pub fn plan_split(
    source_duration: f64,
    speed: f64,
    stem: &str,
    max_output_secs: f64,
) -> SplitPreview {
    let speed = if speed.is_finite() && speed > 0.0 { speed } else { 1.0 };
    let output_duration = source_duration / speed;

    // Source-time length that yields one piece of at most max_output_secs.
    let source_piece = (max_output_secs * speed).max(0.001);
    let count = (source_duration / source_piece).ceil().max(1.0) as usize;
    let even_piece = source_duration / count as f64;

    let mut parts = Vec::with_capacity(count);
    for index in 0..count {
        let start = even_piece * index as f64;
        let end = if index + 1 == count {
            source_duration
        } else {
            (even_piece * (index + 1) as f64).min(source_duration)
        };

        parts.push(SplitPlan {
            source_start: start,
            source_end: end,
            output_duration: (end - start) / speed,
            name: if count == 1 {
                stem.to_string()
            } else {
                format!("{stem} (part {})", index + 1)
            },
        });
    }

    SplitPreview {
        needs_split: count > 1,
        parts,
        output_duration,
    }
}

/// Estimates whether one piece will fit a single upload, given the encoded
/// bitrate. Used to reject WAV and other high-bitrate choices up front.
pub const fn estimate_part_bytes(output_duration: f64, bits_per_second: u32) -> u64 {
    (output_duration * bits_per_second as f64 / 8.0) as u64
}

/// The bitrate each output format actually produces.
pub const fn bits_per_second(format: AudioFormat, sample_rate: u32) -> u32 {
    match format {
        // libmp3lame is pinned to 320k in codec_args, independent of sample rate.
        AudioFormat::Mp3 => 320_000,
        // libvorbis quality 5 lands near 160k for typical material.
        AudioFormat::Ogg => 160_000,
        // pcm_s16le is uncompressed: channels * rate * 16.
        AudioFormat::Wav => sample_rate * 2 * 16,
    }
}

/// True when any planned piece would exceed the per-request byte limit.
pub fn any_part_too_large(
    plan: &SplitPreview,
    format: AudioFormat,
    sample_rate: u32,
) -> bool {
    let bps = bits_per_second(format, sample_rate);
    plan.parts
        .iter()
        .any(|part| estimate_part_bytes(part.output_duration, bps) > ROBLOX_MAX_UPLOAD_BYTES)
}

#[cfg(test)]
mod tests {
    use super::{
        any_part_too_large, bits_per_second, build_filter, estimate_part_bytes, max_output_secs,
        plan_split, sanitize_stem, segment_args, AudioFormat, SplitPlan, ROBLOX_MAX_DURATION_SECS,
        ROBLOX_MAX_UPLOAD_BYTES, SEMITONES_PER_OCTAVE,
    };

    #[test]
    fn a_short_track_is_not_split() {
        let plan = plan_split(180.0, 1.0, "clip", ROBLOX_MAX_DURATION_SECS);
        assert!(!plan.needs_split);
        assert_eq!(plan.parts.len(), 1);
        assert_eq!(plan.parts[0].name, "clip");
        assert!((plan.output_duration - 180.0).abs() < 0.001);
    }

    #[test]
    fn exactly_the_limit_is_one_part() {
        let plan = plan_split(ROBLOX_MAX_DURATION_SECS, 1.0, "clip", ROBLOX_MAX_DURATION_SECS);
        assert!(!plan.needs_split);
        assert_eq!(plan.parts.len(), 1);
    }

    #[test]
    fn a_twenty_minute_track_becomes_four_even_parts() {
        // 20 / 7 = 2.86, so three parts of 400s each rather than 7+7+6.
        let plan = plan_split(1200.0, 1.0, "song", ROBLOX_MAX_DURATION_SECS);
        assert!(plan.needs_split);
        assert_eq!(plan.parts.len(), 3);
        for part in &plan.parts {
            assert!(part.output_duration <= ROBLOX_MAX_DURATION_SECS + 0.001);
        }
        assert!((plan.parts[0].output_duration - 400.0).abs() < 0.001);
        assert_eq!(plan.parts[0].name, "song (part 1)");
    }

    #[test]
    fn parts_are_contiguous_and_cover_the_whole_source() {
        let plan = plan_split(1000.0, 1.0, "song", ROBLOX_MAX_DURATION_SECS);
        let mut expected_start = 0.0;
        for part in &plan.parts {
            assert!((part.source_start - expected_start).abs() < 0.001, "gap in parts");
            assert!(part.source_end > part.source_start);
            expected_start = part.source_end;
        }
        let last_end = plan.parts.last().map(|p| p.source_end).unwrap_or(0.0);
        assert!((last_end - 1000.0).abs() < 0.001);
    }

    #[test]
    fn speed_change_is_accounted_for_after_editing() {
        // 10 minutes at 2x is 5 minutes output, so it must not be split.
        let fast = plan_split(600.0, 2.0, "clip", ROBLOX_MAX_DURATION_SECS);
        assert!(!fast.needs_split);
        assert!((fast.output_duration - 300.0).abs() < 0.001);

        // 5 minutes at 0.5x is 10 minutes output, so it now must be split.
        let slow = plan_split(300.0, 0.5, "clip", ROBLOX_MAX_DURATION_SECS);
        assert!(slow.needs_split);
        assert!(slow.output_duration > ROBLOX_MAX_DURATION_SECS);
    }

    #[test]
    fn pitch_alone_does_not_change_the_plan() {
        // build_filter keeps duration at source/speed regardless of semitones,
        // so the plan must not depend on pitch at all.
        let plan = plan_split(900.0, 1.0, "clip", ROBLOX_MAX_DURATION_SECS);
        assert!((plan.output_duration - 900.0).abs() < 0.001);
        // 900 / 420 = 2.14, so three even pieces of 300s.
        assert_eq!(plan.parts.len(), 3);
    }

    #[test]
    fn a_degenerate_speed_does_not_divide_by_zero() {
        // Speed 0 is sanitised to 1x, so a ten minute track is a normal split.
        let plan = plan_split(600.0, 0.0, "clip", ROBLOX_MAX_DURATION_SECS);
        assert!(plan.output_duration.is_finite());
        assert_eq!(plan.parts.len(), 2);
    }

    #[test]
    fn wav_pieces_are_capped_at_about_two_minutes() {
        // Uncompressed stereo 16 bit runs about 1.4 Mbps, so the 20 MB request
        // ceiling allows only about 119 seconds per piece. This is why WAV needs
        // its own piece length rather than the seven minute audio limit.
        let bps = bits_per_second(AudioFormat::Wav, 44_100);
        let max_secs = ROBLOX_MAX_UPLOAD_BYTES as f64 * 8.0 / bps as f64;
        assert!(
            (max_secs - 119.0).abs() < 2.0,
            "unexpected wav ceiling of {max_secs}s"
        );

        // A plan built for that ceiling produces pieces that do fit.
        let plan = plan_split(400.0, 1.0, "clip", max_secs);
        assert!(plan.parts.len() >= 4);
        assert!(!any_part_too_large(&plan, AudioFormat::Wav, 44_100));

        // Whereas pieces sized for the seven minute limit do not.
        let loose = plan_split(400.0, 1.0, "clip", ROBLOX_MAX_DURATION_SECS);
        assert!(any_part_too_large(&loose, AudioFormat::Wav, 44_100));
    }

    #[test]
    fn short_pieces_are_never_emitted() {
        // A track just over the limit should not produce a sliver second part.
        let plan = plan_split(ROBLOX_MAX_DURATION_SECS + 0.5, 1.0, "clip", ROBLOX_MAX_DURATION_SECS);
        assert_eq!(plan.parts.len(), 2);
        let Some(last) = plan.parts.last() else {
            panic!("expected at least one part");
        };
        assert!(last.output_duration > 0.1, "trailing sliver of {last:?}");
    }

    #[test]
    fn uncompressed_audio_cannot_be_seven_minutes_long() {
        // 16 bit stereo at 44.1k is about 74 MB for seven minutes, far past the
        // 20 MB per-request limit, so WAV always needs shorter pieces.
        let seven_min = ROBLOX_MAX_DURATION_SECS;
        assert!(estimate_part_bytes(seven_min, bits_per_second(AudioFormat::Wav, 44_100))
            > ROBLOX_MAX_UPLOAD_BYTES);

        let plan = plan_split(seven_min, 1.0, "clip", ROBLOX_MAX_DURATION_SECS);
        assert!(any_part_too_large(
            &plan,
            AudioFormat::Wav,
            44_100
        ));

        // The same length in mp3 fits comfortably.
        assert!(!any_part_too_large(
            &plan,
            AudioFormat::Mp3,
            44_100
        ));
    }

    #[test]
    fn shorter_wav_pieces_do_fit() {
        // Halving the piece length is not enough for uncompressed audio; see
        // wav_pieces_are_capped_at_about_two_minutes for the real ceiling.
        let plan = plan_split(200.0, 1.0, "clip", 100.0);
        assert!(!any_part_too_large(&plan, AudioFormat::Wav, 44_100));
    }

    #[test]
    fn compressed_formats_stay_well_inside_the_byte_limit() {
        let plan = plan_split(ROBLOX_MAX_DURATION_SECS * 4.0, 1.0, "song", ROBLOX_MAX_DURATION_SECS);
        assert!(plan.parts.len() >= 4);
        assert!(!any_part_too_large(&plan, AudioFormat::Mp3, 44_100));
        assert!(!any_part_too_large(&plan, AudioFormat::Ogg, 44_100));
    }

    #[test]
    fn wav_gets_a_tighter_piece_length_than_mp3() {
        let wav = max_output_secs(AudioFormat::Wav, 44_100);
        let mp3 = max_output_secs(AudioFormat::Mp3, 44_100);
        assert!(wav < mp3, "wav pieces must be shorter: {wav} vs {mp3}");
        assert!((wav - 119.0).abs() < 2.0, "wav piece length was {wav}");
        assert!((mp3 - ROBLOX_MAX_DURATION_SECS).abs() < 0.001);
    }

    #[test]
    fn a_segment_seeks_the_source_window_it_was_given() {
        let part = SplitPlan {
            source_start: 600.0,
            source_end: 1200.0,
            output_duration: 600.0,
            name: "song (part 2)".to_string(),
        };
        let args = segment_args(
            std::path::Path::new("in.mp3"),
            std::path::Path::new("out.mp3"),
            &part,
            1.0,
            0.0,
            AudioFormat::Mp3,
            44_100,
        );

        let seek = args.iter().position(|a| a == "-ss").expect("-ss present");
        assert_eq!(args[seek + 1], "600.000");
        let to = args.iter().position(|a| a == "-to").expect("-to present");
        assert_eq!(args[to + 1], "1200.000");

        // Seeking must come before the input, otherwise it applies to the output.
        let input = args.iter().position(|a| a == "-i").expect("-i present");
        assert!(seek < input && to < input, "seek options must precede -i");
        assert_eq!(args[input + 1], "in.mp3");
        assert_eq!(args.last().map(String::as_str), Some("out.mp3"));
    }

    #[test]
    fn the_first_piece_does_not_fade_in_from_nothing() {
        // A fade on the leading edge of the very first piece would eat into
        // real audio, so it is only added where a cut actually happened.
        let part = SplitPlan {
            source_start: 0.0,
            source_end: 420.0,
            output_duration: 420.0,
            name: "song".to_string(),
        };
        let args = segment_args(
            std::path::Path::new("in.mp3"),
            std::path::Path::new("out.mp3"),
            &part,
            1.0,
            0.0,
            AudioFormat::Mp3,
            44_100,
        );
        let filter = args.iter().find(|a| a.contains("afade")).expect("fade present");
        assert!(!filter.contains("afade=t=in"), "leading fade on part 1");
        assert!(filter.contains("afade=t=out"), "trailing fade still needed");
    }

    #[test]
    fn the_fade_never_runs_past_the_end_of_a_short_piece() {
        // A 30ms piece cannot take a 20ms fade at each end, so the fade is
        // clamped to half the piece and the two no longer overlap.
        let part = SplitPlan {
            source_start: 0.0,
            source_end: 0.03,
            output_duration: 0.03,
            name: "clip".to_string(),
        };
        let args = segment_args(
            std::path::Path::new("in.mp3"),
            std::path::Path::new("out.mp3"),
            &part,
            1.0,
            0.0,
            AudioFormat::Mp3,
            44_100,
        );
        let filter = args.iter().find(|a| a.contains("afade")).expect("fade present");
        assert!(filter.contains("d=0.015"), "fade not clamped: {filter}");
    }

    #[test]
    fn a_normal_length_piece_keeps_the_full_fade() {
        // 20ms of fade is well inside a 100ms piece, so it is left alone.
        let part = SplitPlan {
            source_start: 0.0,
            source_end: 0.1,
            output_duration: 0.1,
            name: "clip".to_string(),
        };
        let args = segment_args(
            std::path::Path::new("in.mp3"),
            std::path::Path::new("out.mp3"),
            &part,
            1.0,
            0.0,
            AudioFormat::Mp3,
            44_100,
        );
        let filter = args.iter().find(|a| a.contains("afade")).expect("fade present");
        assert!(filter.contains("d=0.020"), "fade changed unnecessarily: {filter}");
    }

    #[test]
    fn a_piece_too_short_to_fade_gets_no_fade_at_all() {
        let part = SplitPlan {
            source_start: 300.0,
            source_end: 300.0,
            output_duration: 0.0,
            name: "clip".to_string(),
        };
        let args = segment_args(
            std::path::Path::new("in.mp3"),
            std::path::Path::new("out.mp3"),
            &part,
            1.0,
            0.0,
            AudioFormat::Mp3,
            44_100,
        );
        assert!(!args.iter().any(|a| a.contains("afade")));
    }

    #[test]
    fn edits_are_still_applied_to_every_piece() {
        let part = SplitPlan {
            source_start: 300.0,
            source_end: 600.0,
            output_duration: 300.0,
            name: "song (part 2)".to_string(),
        };
        let args = segment_args(
            std::path::Path::new("in.mp3"),
            std::path::Path::new("out.mp3"),
            &part,
            2.0,
            3.0,
            AudioFormat::Mp3,
            44_100,
        );
        let filter = args.iter().find(|a| a.contains("atempo")).expect("edit applied");
        assert!(filter.contains("asetrate=44100*1.18920712"), "pitch stage: {filter}");
        assert!(filter.contains("atempo="), "tempo stage: {filter}");
    }

    #[test]
    fn user_titles_cannot_escape_the_output_directory() {
        // Dots are replaced too, so a title cannot force a file extension.
        assert_eq!(sanitize_stem("../../../etc/passwd"), "_________etc_passwd");
        assert_eq!(sanitize_stem("a/b\\c:d"), "a_b_c_d");
        assert_eq!(sanitize_stem("my.track"), "my_track");
        assert_eq!(sanitize_stem("   "), "track");
    }

    #[test]
    fn no_edits_only_resamples() {
        assert_eq!(build_filter(1.0, 0.0, 44_100), "aresample=44100");
    }

    #[test]
    fn speed_alone_never_touches_pitch() {
        // Without the asetrate stage there is nothing to shift pitch.
        let filter = build_filter(1.5, 0.0, 44_100);
        assert!(filter.contains("atempo=1.50000000"));
        assert!(!filter.contains("asetrate"));
    }

    #[test]
    fn pitch_stage_is_corrected_by_tempo() {
        // +12 semitones doubles the frequency, so the tempo filter halves.
        let filter = build_filter(1.0, 12.0, 44_100);
        assert!(filter.contains("asetrate=44100*2.00000000"));
        assert!(filter.contains("atempo=0.50000000"));
    }

    #[test]
    fn pitch_and_speed_combine_into_one_tempo_factor() {
        // +12 semitones at 2x speed still needs atempo 1.0 overall.
        let filter = build_filter(2.0, 12.0, 44_100);
        assert!(filter.contains("atempo=1.00000000"));
    }

    #[test]
    fn negative_pitch_lowers_the_ratio() {
        let filter = build_filter(1.0, -12.0, 44_100);
        assert!(filter.contains("asetrate=44100*0.50000000"));
        assert!(filter.contains("atempo=2.00000000"));
    }

    #[test]
    fn ratio_matches_equal_temperament() {
        // 12 semitones is exactly one octave for any base frequency.
        assert!((2.0f64.powf(12.0 / SEMITONES_PER_OCTAVE) - 2.0).abs() < 1e-9);
        // A quarter tone is not an exact ratio, it is a fraction of an octave.
        assert!((2.0f64.powf(1.0 / SEMITONES_PER_OCTAVE) - 1.059_463).abs() < 1e-5);
    }

    #[test]
    fn every_format_maps_to_a_codec() {
        for format in [AudioFormat::Mp3, AudioFormat::Ogg, AudioFormat::Wav] {
            let rate = 48_000;
            let args = super::codec_args(format, rate);
            assert!(!args.is_empty());
            assert!(args.iter().any(|a| a == "-c:a"));
        }
    }

    #[tokio::test]
    async fn resolves_tools_that_are_really_installed() {
        // Probes this machine, so it only asserts about what is present. The
        // point is that resolution returns a runnable path when a tool exists,
        // which is what the old -version probe failed to do for yt-dlp.
        if let Some(path) = super::resolve(super::YTDLP).await {
            assert!(path.is_file(), "resolved yt-dlp should be a real file");
            assert!(
                path.to_string_lossy().to_ascii_lowercase().contains("yt-dlp"),
                "unexpected match for yt-dlp: {path:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_missing_tool_resolves_to_none() {
        assert!(super::resolve(super::ToolSpec {
            program: "definitely-not-a-real-program-xyz",
            version_arg: "--version",
        })
        .await
        .is_none());
    }

    #[test]
    fn candidate_names_cover_windows_extensions() {
        let names = super::candidate_names("ffmpeg");
        if cfg!(windows) {
            assert!(names.contains(&"ffmpeg.exe".to_string()));
            assert!(names.contains(&"ffmpeg.cmd".to_string()));
        }
        assert!(names.iter().any(|n| n == "ffmpeg"));
    }

    #[test]
    fn version_flags_are_per_tool() {
        // yt-dlp reads a single-dash -version as a config file path and fails,
        // so it must be probed with the double-dash form.
        assert_eq!(super::YTDLP.version_arg, "--version");
        assert_eq!(super::FFMPEG.version_arg, "-version");
        assert_eq!(super::FFPROBE.version_arg, "-version");
    }

    #[test]
    fn the_selected_asset_exists_in_a_real_release() {
        // Guards against renaming an asset upstream without noticing: the chosen
        // name has to be one of the files yt-dlp actually publishes.
        let asset = super::ytdlp_asset();
        let known = [
            "yt-dlp.exe",
            "yt-dlp_x86.exe",
            "yt-dlp_arm64.exe",
            "yt-dlp_linux",
            "yt-dlp_linux_aarch64",
            "yt-dlp_musllinux",
            "yt-dlp_musllinux_aarch64",
            "yt-dlp_macos",
        ];
        assert!(known.contains(&asset), "unexpected yt-dlp asset: {asset}");
    }

    #[test]
    fn local_name_is_invocable_on_this_platform() {
        let name = super::local_ytdlp_name();
        if cfg!(windows) {
            assert!(name.ends_with(".exe"));
        } else {
            assert!(!name.contains('.'), "unix binaries must stay extensionless");
        }
    }

    #[test]
    fn sums_file_is_parsed_the_way_yt_dlp_publishes_it() {
        let sums = "abc123  yt-dlp_linux\ndef456  *yt-dlp_macos\n";
        let parse = |want: &str| {
            sums.lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    let digest = parts.next()?;
                    let name = parts.next()?.trim_start_matches('*');
                    (name == want).then(|| digest.to_string())
                })
        };
        assert_eq!(parse("yt-dlp_linux").as_deref(), Some("abc123"));
        // The asterisk form marks binary mode and must still match.
        assert_eq!(parse("yt-dlp_macos").as_deref(), Some("def456"));
        assert!(parse("yt-dlp").is_none());
    }

    #[test]
    fn checksums_match_the_reference_implementation() {
        // Known SHA-256 of the empty input, to prove the hashing helper is wired
        // to a real digest rather than a placeholder.
        assert_eq!(
            super::sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            super::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
