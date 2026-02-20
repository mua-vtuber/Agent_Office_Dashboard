use crate::config::DisplayConfig;
use crate::error::AppError;
use crate::models::agent::{MascotAgent, SlotCounts};

#[tauri::command]
pub async fn get_all_agents() -> Result<Vec<MascotAgent>, AppError> {
    // TODO: storage에서 로드
    Ok(vec![])
}

#[tauri::command]
pub async fn get_agent_resume(agent_id: String) -> Result<serde_json::Value, AppError> {
    // TODO: storage에서 로드
    let _ = agent_id;
    Ok(serde_json::json!(null))
}

#[tauri::command]
pub async fn set_slot_counts(slot_counts: SlotCounts) -> Result<(), AppError> {
    // TODO: 앱 상태에 저장
    tracing::info!("slot_counts received: {:?}", slot_counts);
    Ok(())
}

#[tauri::command]
pub async fn notify_animation_done(agent_id: String, animation: String) -> Result<(), AppError> {
    // TODO: synthetic 이벤트 처리
    tracing::info!("animation_done: {} - {}", agent_id, animation);
    Ok(())
}

#[tauri::command]
pub async fn notify_movement_done(
    agent_id: String,
    movement_type: String,
) -> Result<(), AppError> {
    // TODO: synthetic 이벤트 처리
    tracing::info!("movement_done: {} - {}", agent_id, movement_type);
    Ok(())
}

#[tauri::command]
pub async fn notify_chat_done(agent_id: String) -> Result<(), AppError> {
    tracing::info!("chat_done: {}", agent_id);
    Ok(())
}

#[tauri::command]
pub async fn get_display_config() -> Result<DisplayConfig, AppError> {
    // TODO: config에서 로드 (Tauri managed state)
    Ok(DisplayConfig {
        activity_zone_height_px: 120,
        taskbar_offset_px: 48,
        character_spacing_px: 60,
        group_spacing_px: 150,
        max_bubble_chars: 80,
        bubble_fade_ms: 3000,
        idle_sway_px: 2,
    })
}
