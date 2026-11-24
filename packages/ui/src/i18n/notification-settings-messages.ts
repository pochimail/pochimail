/** Settings › Notifications copy per locale: the reserved section for Pochimail's own notifications. */
export const notificationSettingsMessages = {
  en: {
    "settings.notifications": { text: "Notifications", params: [] },
    "settings.notifications.toggle": { text: "Pochimail notifications", params: [] },
    "settings.notifications.hint": {
      text: "Tell me when sorting finishes, a digest is ready or an account needs reconnecting. They show counts only.",
      params: [],
    },
  },
  fr: {
    "settings.notifications": { text: "Notifications", params: [] },
    "settings.notifications.toggle": { text: "Notifications de Pochimail", params: [] },
    "settings.notifications.hint": {
      text: "Me prévenir quand le tri se termine, qu’un résumé est prêt ou qu’un compte doit être reconnecté. Elles n’affichent que des nombres.",
      params: [],
    },
  },
  ja: {
    "settings.notifications": { text: "通知", params: [] },
    "settings.notifications.toggle": { text: "Pochimailの通知", params: [] },
    "settings.notifications.hint": {
      text: "仕分けの完了、ダイジェストの準備完了、アカウントの再接続が必要なときにお知らせします。表示されるのは件数だけです。",
      params: [],
    },
  },
} as const;
