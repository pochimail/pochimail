/** Reconnect and remove-account copy per locale. Plain objects, so this file needs nothing from the catalogs that spread it in. */
export const accountsMessages = {
  en: {
    "reconnect.failed": {
      text: "I couldn’t reconnect your account. Please try again.",
      params: [],
    },
    "reconnect.wrongAccount": {
      text: "That sign-in was for a different account. Choose the account I lost access to.",
      params: [],
    },
  },
  fr: {
    "reconnect.failed": {
      text: "Je n’ai pas pu reconnecter votre compte. Veuillez réessayer.",
      params: [],
    },
    "reconnect.wrongAccount": {
      text: "Cette connexion concernait un autre compte. Choisissez celui auquel je n’ai plus accès.",
      params: [],
    },
  },
  ja: {
    "reconnect.failed": {
      text: "アカウントを再接続できませんでした。もう一度お試しください。",
      params: [],
    },
    "reconnect.wrongAccount": {
      text: "別のアカウントでサインインされました。アクセスできなくなったアカウントを選んでください。",
      params: [],
    },
  },
} as const;
