use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

/// 히트존 정보. WebView에서 set_hit_zones 커맨드로 전달받는다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HitZone {
    pub agent_id: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// 커서 폴링 루프.
/// poll_interval_ms 간격으로 GetCursorPos를 호출하고,
/// 히트존과 비교하여 hover 상태를 WebView에 알린다.
pub async fn run_cursor_poll(
    app_handle: tauri::AppHandle,
    active: Arc<AtomicBool>,
    poll_interval_ms: u64,
    hit_zones: Arc<Mutex<Vec<HitZone>>>,
    hit_padding: i32,
) {
    let interval = tokio::time::Duration::from_millis(poll_interval_ms);
    let mut prev_hovered: Option<String> = None;

    loop {
        if !active.load(Ordering::Relaxed) {
            tokio::time::sleep(interval).await;
            continue;
        }

        let cursor = get_cursor_position();
        let zones = hit_zones
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        let mut current_hovered: Option<String> = None;
        for zone in &zones {
            if cursor.0 >= zone.x - hit_padding
                && cursor.0 <= zone.x + zone.width + hit_padding
                && cursor.1 >= zone.y - hit_padding
                && cursor.1 <= zone.y + zone.height + hit_padding
            {
                current_hovered = Some(zone.agent_id.clone());
                break;
            }
        }

        // hover 상태 변경 시에만 이벤트 발송
        if current_hovered != prev_hovered {
            let payload = serde_json::json!({
                "hovered_agent_id": current_hovered,
                "cursor_x": cursor.0,
                "cursor_y": cursor.1,
            });
            let _ = app_handle.emit("mascot://cursor-hover", &payload);
            prev_hovered = current_hovered;
        }

        tokio::time::sleep(interval).await;
    }
}

#[cfg(target_os = "windows")]
fn get_cursor_position() -> (i32, i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut pt) };
    (pt.x, pt.y)
}

#[cfg(not(target_os = "windows"))]
fn get_cursor_position() -> (i32, i32) {
    (0, 0)
}
