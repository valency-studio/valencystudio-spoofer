#[tauri::command]
#[specta::specta]
#[must_use]
pub fn find_studio_process() -> Option<u32> {
    None
}

#[derive(serde::Serialize, specta::Type)]
pub struct MemoryInjectionResult {
    pub utf8_replaced: u32,
    pub utf16_replaced: u32,
    pub total_replaced: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn scan_and_replace_multiple_strings(
    _app: tauri::AppHandle,
    _pid: u32,
    _replacements: std::collections::HashMap<String, String>,
) -> Result<std::collections::HashMap<String, MemoryInjectionResult>, String> {
    Err("Memory injection is only supported on Windows.".into())
}

#[tauri::command]
#[specta::specta]
pub async fn focus_and_save_studio(_pid: u32) -> Result<(), String> {
    Err("Auto-focus and auto-save are only supported on Windows.".into())
}
