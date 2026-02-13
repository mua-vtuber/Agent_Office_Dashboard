import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  ko: {
    translation: {
      app_title: "에이전트 오피스 대시보드",
      tab_office: "오피스",
      tab_dashboard: "대시보드",
      tab_agents: "에이전트",
      tab_settings: "설정",
      common_all: "전체",
      common_loading: "불러오는 중...",
      dashboard_title: "대시보드",
      dashboard_subtitle: "상태 카드 + 타임라인 + Time Travel(전후 문맥) 패널.",
      dashboard_hooks_missing: "Hooks 미설정 상태입니다. 현재 모드: {{mode}}. 실시간 정확도가 낮을 수 있습니다.",
      dashboard_open_settings: "설정에서 안내/설치",
      dashboard_stat_total_agents: "총 에이전트",
      dashboard_stat_failed: "실패",
      dashboard_stat_working: "작업중",
      dashboard_stat_events: "이벤트(표시)",
      dashboard_agent_cards: "Agent Status Cards",
      dashboard_agents_empty: "에이전트가 없습니다. seed-mock를 실행해보세요.",
      dashboard_recent_events: "최근 이벤트",
      dashboard_time_travel_title: "Time Travel Context",
      dashboard_select_event_prompt: "이벤트를 선택하세요.",
      dashboard_agent_snapshot: "Agent Snapshot",
      agents_title: "에이전트",
      agents_subtitle: "저장 에이전트는 정직원, 임시 호출 에이전트는 계약직으로 표시합니다.",
      agents_filter_employment: "고용형태 필터",
      agents_employee: "정직원",
      agents_contractor: "계약직",
      agents_list: "목록",
      agents_empty: "표시할 에이전트가 없습니다.",
      agents_detail: "상세",
      agents_select_prompt: "에이전트를 선택하세요.",
      agents_meta: "역할: {{role}} / 고용형태: {{employment}} / 상태: {{status}}",
      agents_tools: "도구",
      agents_expertise: "전문영역",
      agents_go_office: "Office에서 위치 보기",
      agents_recent_events: "최근 이벤트"
    }
  },
  en: {
    translation: {
      app_title: "Agent Office Dashboard",
      tab_office: "Office",
      tab_dashboard: "Dashboard",
      tab_agents: "Agents",
      tab_settings: "Settings",
      common_all: "All",
      common_loading: "Loading...",
      dashboard_title: "Dashboard",
      dashboard_subtitle: "Status cards + timeline + time-travel context.",
      dashboard_hooks_missing: "Hooks are not configured. Current mode: {{mode}}. Realtime accuracy may be degraded.",
      dashboard_open_settings: "Open settings",
      dashboard_stat_total_agents: "Total Agents",
      dashboard_stat_failed: "Failed",
      dashboard_stat_working: "Working",
      dashboard_stat_events: "Events",
      dashboard_agent_cards: "Agent Status Cards",
      dashboard_agents_empty: "No agents yet. Run seed-mock.",
      dashboard_recent_events: "Recent Events",
      dashboard_time_travel_title: "Time Travel Context",
      dashboard_select_event_prompt: "Select an event.",
      dashboard_agent_snapshot: "Agent Snapshot",
      agents_title: "Agents",
      agents_subtitle: "Saved agents are labeled Employee, temporary runtime agents are labeled Contractor.",
      agents_filter_employment: "Employment Filter",
      agents_employee: "Employee",
      agents_contractor: "Contractor",
      agents_list: "List",
      agents_empty: "No agents to display.",
      agents_detail: "Detail",
      agents_select_prompt: "Select an agent.",
      agents_meta: "Role: {{role}} / Employment: {{employment}} / Status: {{status}}",
      agents_tools: "Tools",
      agents_expertise: "Expertise",
      agents_go_office: "Locate in Office",
      agents_recent_events: "Recent Events"
    }
  }
};

const savedLang = (() => {
  try {
    const raw = localStorage.getItem("aod.ui.settings.v1");
    if (!raw) return "ko";
    const parsed = JSON.parse(raw) as { language?: "ko" | "en" };
    return parsed.language === "en" ? "en" : "ko";
  } catch {
    return "ko";
  }
})();

void i18n.use(initReactI18next).init({
  resources,
  lng: savedLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false }
});

export default i18n;
