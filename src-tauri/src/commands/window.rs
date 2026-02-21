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

/// 현재 글로벌 커서 위치를 물리 픽셀 좌표로 반환한다 (Windows 전용).
#[tauri::command]
pub async fn get_cursor_pos() -> Result<(i32, i32), AppError> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let mut pt = POINT { x: 0, y: 0 };
        let success = unsafe { GetCursorPos(&mut pt) };
        if success == 0 {
            return Err(AppError::Io(std::io::Error::last_os_error()));
        }
        Ok((pt.x, pt.y))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "cursor polling is only supported on Windows",
        )))
    }
}
