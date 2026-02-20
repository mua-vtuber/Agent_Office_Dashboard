use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

/// 시스템 트레이 아이콘 + 메뉴를 구성한다.
///
/// 메뉴 구조 (product-spec.md §4.3):
///   마스코트 표시
///   에이전트 이력서
///   ──────────────
///   언어 ▸ 한국어 ✓ / English
///   자동 실행
///   ──────────────
///   종료
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // ── 일반 메뉴 항목 ──
    let show_item = MenuItemBuilder::with_id("show", "마스코트 표시").build(app)?;
    let resume_item = MenuItemBuilder::with_id("resume", "에이전트 이력서").build(app)?;

    // ── 언어 서브메뉴 ──
    let lang_ko = CheckMenuItemBuilder::with_id("lang_ko", "한국어")
        .checked(true)
        .build(app)?;
    let lang_en = CheckMenuItemBuilder::with_id("lang_en", "English")
        .checked(false)
        .build(app)?;
    let lang_submenu = SubmenuBuilder::with_id(app, "lang", "언어")
        .items(&[&lang_ko, &lang_en])
        .build()?;

    // ── 자동 실행 ──
    let autostart_item = CheckMenuItemBuilder::with_id("autostart", "자동 실행")
        .checked(false)
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
                    // WebView 에 모달 열기 이벤트 전송
                    let _ = app_handle.emit("mascot://open-resume-modal", ());
                }
                "quit" => {
                    app_handle.exit(0);
                }
                // lang_ko, lang_en, autostart 등은 별도 핸들러에서 처리 예정
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
