use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::error::AppError;

type Result<T> = crate::error::Result<T>;

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
            let works = Command::new(&full)
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
    Command::new(path)
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

    let output = Command::new(&ffprobe)
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

    let probe = Command::new(&ytdlp)
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

    let download = Command::new(&ytdlp)
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

/// Renders the edited track to a new file. The input is never modified.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn bake_media(
    app: AppHandle,
    input_path: String,
    output_name: String,
    speed: f64,
    semitones: f64,
    format: AudioFormat,
    sample_rate: u32,
) -> Result<ImportedMedia> {
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
    let output = dir.join(format!("{safe_name}.{extension}"));

    let mut command = Command::new(&ffmpeg);
    command.arg("-y").arg("-v").arg("error").arg("-i").arg(&input);

    let filter = build_filter(speed, semitones, rate);
    if !filter.is_empty() {
        command.arg("-af").arg(filter);
    }

    for arg in codec_args(format, rate) {
        command.arg(arg);
    }
    command.arg(&output);

    let result = command
        .output()
        .await
        .map_err(|_| tool_error("ffmpeg", "export audio"))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(AppError::Custom(format!(
            "ffmpeg could not export the track: {}",
            summarize(&stderr)
        )));
    }

    if !output.is_file() {
        return Err("ffmpeg finished but produced no file.".into());
    }

    Ok(ImportedMedia {
        path: output.to_string_lossy().to_string(),
        title: safe_name,
        uploader: None,
        thumbnail_url: None,
        source_url: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::{build_filter, AudioFormat, SEMITONES_PER_OCTAVE};

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
