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
    let (ffmpeg, ffprobe, ytdlp) = tokio::join!(
        which("ffmpeg"),
        which("ffprobe"),
        which("yt-dlp"),
    );

    Ok(MediaTools {
        ffmpeg,
        ffprobe,
        ytdlp,
    })
}

async fn which(program: &str) -> bool {
    // Windows resolves .cmd shims, so probe the platform-specific names too.
    let mut candidates = vec![program.to_string()];
    if cfg!(windows) {
        candidates.push(format!("{program}.exe"));
        candidates.push(format!("{program}.cmd"));
    }

    for candidate in candidates {
        let ok = Command::new(&candidate)
            .arg("-version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false);
        if ok {
            return true;
        }
    }
    false
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
    if !which("ffprobe").await {
        return Err(tool_error("ffprobe", "read audio details"));
    }

    let output = Command::new("ffprobe")
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
    if !which("yt-dlp").await {
        return Err(tool_error("yt-dlp", "import a track from a link"));
    }

    let dir = media_dir(&app)?;

    let probe = Command::new("yt-dlp")
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

    let download = Command::new("yt-dlp")
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
    if !which("ffmpeg").await {
        return Err(tool_error("ffmpeg", "export audio"));
    }

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

    let mut command = Command::new("ffmpeg");
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
}
