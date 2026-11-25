/** Settings › Notifications and the notifications Pochimail itself shows (ADR 0008), per locale. Counts only, never a name or subject. */
export const pochimailNotificationMessages = {
  en: {
    "settings.notifications": { text: "Notifications", params: [] },
    "settings.notifications.label": { text: "Show notifications", params: [] },
    "settings.notifications.hint": {
      text: "Pochi tells you when sorting finishes or your digest is ready. Only counts, never names or subjects.",
      params: [],
    },
    "settings.saveFailed": { text: "I couldn't save that setting. Please try again.", params: [] },
    "notify.scan-complete.title": { text: "Sorting finished", params: [] },
    "notify.scan-complete.body": {
      text: "{count, plural, one {# email sorted} other {# emails sorted}}",
      params: ["count"],
    },
    "notify.digest-ready.title": { text: "Your digest is ready", params: [] },
    "notify.digest-ready.body": {
      text: "{count, plural, one {# thing to look at} other {# things to look at}}",
      params: ["count"],
    },
    "notify.review-waiting.title": { text: "Waiting for your review", params: [] },
    "notify.review-waiting.body": {
      text: "{count, plural, one {# email to review} other {# emails to review}}",
      params: ["count"],
    },
  },
  fr: {
    "settings.notifications": { text: "Notifications", params: [] },
    "settings.notifications.label": { text: "Afficher les notifications", params: [] },
    "settings.notifications.hint": {
      text: "Pochi vous prévient quand le tri est terminé ou que votre résumé est prêt. Seulement des nombres, jamais de noms ni d’objets.",
      params: [],
    },
    "settings.saveFailed": {
      text: "Je n’ai pas pu enregistrer ce réglage. Veuillez réessayer.",
      params: [],
    },
    "notify.scan-complete.title": { text: "Tri terminé", params: [] },
    "notify.scan-complete.body": {
      text: "{count, plural, one {# email trié} other {# emails triés}}",
      params: ["count"],
    },
    "notify.digest-ready.title": { text: "Votre résumé est prêt", params: [] },
    "notify.digest-ready.body": {
      text: "{count, plural, one {# élément à voir} other {# éléments à voir}}",
      params: ["count"],
    },
    "notify.review-waiting.title": { text: "En attente de votre examen", params: [] },
    "notify.review-waiting.body": {
      text: "{count, plural, one {# email à examiner} other {# emails à examiner}}",
      params: ["count"],
    },
  },
  ja: {
    "settings.notifications": { text: "通知", params: [] },
    "settings.notifications.label": { text: "通知を表示", params: [] },
    "settings.notifications.hint": {
      text: "仕分けの完了やダイジェストの準備ができたときにお知らせします。表示されるのは件数だけで、名前や件名は含まれません。",
      params: [],
    },
    "settings.saveFailed": {
      text: "設定を保存できませんでした。もう一度お試しください。",
      params: [],
    },
    "notify.scan-complete.title": { text: "仕分けが完了しました", params: [] },
    "notify.scan-complete.body": {
      text: "{count, plural, other {#件のメールを仕分けました}}",
      params: ["count"],
    },
    "notify.digest-ready.title": { text: "ダイジェストの準備ができました", params: [] },
    "notify.digest-ready.body": {
      text: "{count, plural, other {確認するものが#件あります}}",
      params: ["count"],
    },
    "notify.review-waiting.title": { text: "確認をお待ちしています", params: [] },
    "notify.review-waiting.body": {
      text: "{count, plural, other {確認するメールが#件あります}}",
      params: ["count"],
    },
  },
} as const;
