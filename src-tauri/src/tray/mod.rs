use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use crate::state::AppState;
use crate::storage::settings_repo::SettingsRepo;

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // 초기 설정값 로드
    let initial_lang = {
        let state: tauri::State<'_, AppState> = app.state();
        let repo = SettingsRepo::new(state.db.clone());
        repo.get("lang").unwrap_or(None).unwrap_or_else(|| "ko".to_string())
    };

    let initial_autostart = {
        let state: tauri::State<'_, AppState> = app.state();
        let repo = SettingsRepo::new(state.db.clone());
        repo.get("autostart").unwrap_or(None).unwrap_or_else(|| "false".to_string()) == "true"
    };

    // ── 일반 메뉴 항목 ──
    let show_item = MenuItemBuilder::with_id("show", "마스코트 표시").build(app)?;
    let resume_item = MenuItemBuilder::with_id("resume", "에이전트 이력서").build(app)?;

    // ── 언어 서브메뉴 ──
    let lang_ko = CheckMenuItemBuilder::with_id("lang_ko", "한국어")
        .checked(initial_lang == "ko")
        .build(app)?;
    let lang_en = CheckMenuItemBuilder::with_id("lang_en", "English")
        .checked(initial_lang == "en")
        .build(app)?;
    let lang_submenu = SubmenuBuilder::with_id(app, "lang", "언어")
        .items(&[&lang_ko, &lang_en])
        .build()?;

    // ── 자동 실행 ──
    let autostart_item = CheckMenuItemBuilder::with_id("autostart", "자동 실행")
        .checked(initial_autostart)
        .build(app)?;

    // ── 종료 ──
    let quit_item = MenuItemBuilder::with_id("quit", "종료").build(app)?;

    // ── 전체 메뉴 조립 ──
    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &resume_item])
        .separator()
        .item(&lang_submenu)
        .item(&autostart_item)
        .separator()
        .item(&quit_item)
        .build()?;

    // 클로저에서 사용할 CheckMenuItem 클론
    let lang_ko_clone = lang_ko.clone();
    let lang_en_clone = lang_en.clone();
    let autostart_clone = autostart_item.clone();

    // ── 트레이 아이콘 생성 ──
    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Agent Mascot")
        .on_menu_event(move |app_handle, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "resume" => {
                    let _ = app_handle.emit("mascot://open-resume-modal", ());
                }
                "lang_ko" => {
                    let _ = lang_ko_clone.set_checked(true);
                    let _ = lang_en_clone.set_checked(false);
                    save_setting(app_handle, "lang", "ko");
                    let _ = app_handle.emit("mascot://settings-changed", serde_json::json!({
                        "key": "lang",
                        "value": "ko"
                    }));
                }
                "lang_en" => {
                    let _ = lang_ko_clone.set_checked(false);
                    let _ = lang_en_clone.set_checked(true);
                    save_setting(app_handle, "lang", "en");
                    let _ = app_handle.emit("mascot://settings-changed", serde_json::json!({
                        "key": "lang",
                        "value": "en"
                    }));
                }
                "autostart" => {
                    let is_checked = autostart_clone.is_checked().unwrap_or(false);
                    // 토글: 현재 checked 상태의 반대로 설정
                    let new_val = if is_checked { "false" } else { "true" };
                    let _ = autostart_clone.set_checked(!is_checked);
                    save_setting(app_handle, "autostart", new_val);
                    let _ = app_handle.emit("mascot://settings-changed", serde_json::json!({
                        "key": "autostart",
                        "value": !is_checked
                    }));
                }
                "quit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

/// settings DB에 값 저장
fn save_setting(app_handle: &tauri::AppHandle, key: &str, value: &str) {
    let state: tauri::State<'_, AppState> = app_handle.state();
    let repo = SettingsRepo::new(state.db.clone());
    if let Err(e) = repo.set(key, value) {
        tracing::error!("failed to save setting {key}={value}: {e}");
    }
}
