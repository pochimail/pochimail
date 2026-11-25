/** Sync now copy per locale. Plain objects, so this file needs nothing from the catalogs that spread it in. */
export const syncMessages = {
  en: {
    "sync.progress": { text: "Syncing your email", params: [] },
    "sync.now": { text: "Sync now", params: [] },
    "sync.running": { text: "Syncing…", params: [] },
    "sync.offline": { text: "You’re offline. We’ll sync when you’re back.", params: [] },
    "sync.authExpired": { text: "{account} needs you to sign in again.", params: ["account"] },
    "sync.reconnect": { text: "Reconnect", params: [] },
    "sync.rateLimited": {
      text: "{account} asked us to slow down. We’ll sync again at {time}.",
      params: ["account", "time"],
    },
    "sync.failed": {
      text: "We couldn’t sync {account}. Try again in a moment.",
      params: ["account"],
    },
    "sync.failedGeneric": { text: "We couldn’t sync. Try again in a moment.", params: [] },
  },
  fr: {
    "sync.progress": { text: "Synchronisation de vos emails", params: [] },
    "sync.now": { text: "Synchroniser maintenant", params: [] },
    "sync.running": { text: "Synchronisation…", params: [] },
    "sync.offline": {
      text: "Vous êtes hors ligne. Nous synchroniserons dès votre retour.",
      params: [],
    },
    "sync.authExpired": {
      text: "{account} vous demande de vous reconnecter.",
      params: ["account"],
    },
    "sync.reconnect": { text: "Se reconnecter", params: [] },
    "sync.rateLimited": {
      text: "{account} nous a demandé de ralentir. Nous synchroniserons de nouveau à {time}.",
      params: ["account", "time"],
    },
    "sync.failed": {
      text: "Nous n’avons pas pu synchroniser {account}. Réessayez dans un instant.",
      params: ["account"],
    },
    "sync.failedGeneric": {
      text: "Nous n’avons pas pu synchroniser. Réessayez dans un instant.",
      params: [],
    },
  },
  ja: {
    "sync.progress": { text: "メールを同期しています", params: [] },
    "sync.now": { text: "今すぐ同期", params: [] },
    "sync.running": { text: "同期しています…", params: [] },
    "sync.offline": {
      text: "オフラインです。接続が戻ったら同期します。",
      params: [],
    },
    "sync.authExpired": { text: "{account}は再度サインインが必要です。", params: ["account"] },
    "sync.reconnect": { text: "再接続", params: [] },
    "sync.rateLimited": {
      text: "{account}から速度を落とすよう求められました。{time}にもう一度同期します。",
      params: ["account", "time"],
    },
    "sync.failed": {
      text: "{account}を同期できませんでした。少し待ってからもう一度お試しください。",
      params: ["account"],
    },
    "sync.failedGeneric": {
      text: "同期できませんでした。少し待ってからもう一度お試しください。",
      params: [],
    },
  },
};
