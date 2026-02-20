use crate::error::AppError;

#[tauri::command]
pub async fn toggle_click_through(
    window: tauri::WebviewWindow,
    ignore: bool,
) -> Result<(), AppError> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
    Ok(())
}
