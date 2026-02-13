import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  ko: {
    translation: {
      app_title: "에이전트 오피스 대시보드",
      tab_office: "오피스",
      tab_dashboard: "대시보드",
      tab_agents: "에이전트",
      tab_settings: "설정"
    }
  },
  en: {
    translation: {
      app_title: "Agent Office Dashboard",
      tab_office: "Office",
      tab_dashboard: "Dashboard",
      tab_agents: "Agents",
      tab_settings: "Settings"
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
