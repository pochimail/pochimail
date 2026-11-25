/** Review screen "no account" copy per locale. Plain objects, so this file needs nothing from the catalogs that spread it in. */
export const reviewMessages = {
  en: {
    "review.noAccount.title": { text: "Connect an account", params: [] },
    "review.noAccount.body": {
      text: "These counts are all Pochimail keeps. To list emails, delete or unsubscribe, it needs a connected account: it fetches them from your provider when you ask.",
      params: [],
    },
  },
  fr: {
    "review.noAccount.title": { text: "Connectez un compte", params: [] },
    "review.noAccount.body": {
      text: "Ces chiffres sont tout ce que Pochimail conserve. Pour lister des emails, supprimer ou vous désabonner, un compte connecté est nécessaire : Pochimail les récupère chez votre fournisseur à votre demande.",
      params: [],
    },
  },
  ja: {
    "review.noAccount.title": { text: "アカウントを接続してください", params: [] },
    "review.noAccount.body": {
      text: "Pochimailが保存しているのはこの件数だけです。メールの一覧表示、削除、配信停止にはアカウントの接続が必要です。必要なときにプロバイダーから取得します。",
      params: [],
    },
  },
} as const;
