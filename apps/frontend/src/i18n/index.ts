import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  ko: {
    translation: {
      app_title: "에이전트 오피스 대시보드"
    }
  },
  en: {
    translation: {
      app_title: "Agent Office Dashboard"
    }
  }
};

void i18n.use(initReactI18next).init({
  resources,
  lng: "ko",
  fallbackLng: "en",
  interpolation: { escapeValue: false }
});

export default i18n;
