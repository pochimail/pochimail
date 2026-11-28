import { accountsMessages } from "./accounts-messages.ts";

/** Connect screen copy per locale, with the account-management copy (reconnect, remove). Plain objects, so this file needs nothing from the catalogs that spread it in. */
export const connectMessages = {
  en: {
    ...accountsMessages.en,
    "connect.title": { text: "Connect an email account", params: [] },
    "connect.description": {
      text: "Sign in with your provider. Pochimail never sees your password, and you can add more accounts later.",
      params: [],
    },
    "connect.gmail": { text: "Continue with Gmail", params: [] },
    "connect.waiting": { text: "Waiting for you to sign in in your browser…", params: [] },
    "connect.cancelled": { text: "Sign-in was cancelled. Nothing was connected.", params: [] },
    "connect.failed": { text: "I couldn’t connect your account. Nothing was changed.", params: [] },
    "connect.notConfigured": { text: "This build has no Google sign-in set up.", params: [] },
    "connect.providerFailed": {
      text: "I couldn’t finish signing in with Google. Check your connection and try again. Nothing was changed.",
      params: [],
    },
    "connect.storageUnavailable": {
      text: "I can’t open my local storage yet. Restart Pochimail, then try again. Nothing was changed.",
      params: [],
    },
    "connect.cancel": { text: "Cancel", params: [] },
    "connect.noAddress": {
      text: "Google didn’t share your email address, so I couldn’t connect your account. Nothing was changed.",
      params: [],
    },
    "connect.retry": { text: "Try again", params: [] },
    "connect.back": { text: "Back", params: [] },
    "connect.promises.heading": { text: "My promises", params: [] },
    "connect.promise.local.title": {
      text: "Your email is only processed on this {device}",
      params: ["device"],
    },
    "connect.promise.local.body": {
      text: "Everything is analyzed locally. No server, no cloud AI.",
      params: [],
    },
    "connect.promise.control.title": { text: "You decide what I can do", params: [] },
    "connect.promise.control.body": {
      text: "Next, you choose whether I only look, suggest, or act on my own.",
      params: [],
    },
    "connect.promise.delete.title": { text: "You keep the control", params: [] },
    "connect.promise.delete.body": {
      text: "Nothing is deleted without your approval. Deleted emails go to the Trash, and you can undo.",
      params: [],
    },
  },
  fr: {
    ...accountsMessages.fr,
    "connect.title": { text: "Connecter un compte email", params: [] },
    "connect.description": {
      text: "Connectez-vous auprès de votre fournisseur. Pochimail ne voit jamais votre mot de passe, et vous pourrez ajouter d’autres comptes plus tard.",
      params: [],
    },
    "connect.gmail": { text: "Continuer avec Gmail", params: [] },
    "connect.waiting": {
      text: "J’attends que vous vous connectiez dans votre navigateur…",
      params: [],
    },
    "connect.cancelled": {
      text: "La connexion a été annulée. Aucun compte n’a été connecté.",
      params: [],
    },
    "connect.failed": {
      text: "Je n’ai pas pu connecter votre compte. Rien n’a été modifié.",
      params: [],
    },
    "connect.notConfigured": {
      text: "Cette version n’a pas de connexion Google configurée.",
      params: [],
    },
    "connect.providerFailed": {
      text: "Je n’ai pas pu terminer la connexion avec Google. Vérifiez votre connexion, puis réessayez. Rien n’a été modifié.",
      params: [],
    },
    "connect.storageUnavailable": {
      text: "Je ne peux pas encore ouvrir mon stockage local. Redémarrez Pochimail, puis réessayez. Rien n’a été modifié.",
      params: [],
    },
    "connect.cancel": { text: "Annuler", params: [] },
    "connect.noAddress": {
      text: "Google n’a pas partagé votre adresse email, je n’ai donc pas pu connecter votre compte. Rien n’a été modifié.",
      params: [],
    },
    "connect.retry": { text: "Réessayer", params: [] },
    "connect.back": { text: "Retour", params: [] },
    "connect.promises.heading": { text: "Mes promesses", params: [] },
    "connect.promise.local.title": {
      text: "Vos emails sont traités uniquement sur votre {device}",
      params: ["device"],
    },
    "connect.promise.local.body": {
      text: "Tout est analysé en local. Aucun serveur, aucune IA dans le cloud.",
      params: [],
    },
    "connect.promise.control.title": { text: "Vous décidez de ce que je peux faire", params: [] },
    "connect.promise.control.body": {
      text: "Ensuite, vous choisissez si je regarde seulement, si je propose ou si j’agis seul.",
      params: [],
    },
    "connect.promise.delete.title": { text: "Vous gardez le contrôle", params: [] },
    "connect.promise.delete.body": {
      text: "Rien n’est supprimé sans votre accord. Les emails supprimés vont dans la corbeille, et vous pouvez annuler.",
      params: [],
    },
  },
  ja: {
    ...accountsMessages.ja,
    "connect.title": { text: "メールアカウントを接続", params: [] },
    "connect.description": {
      text: "ご利用のプロバイダでサインインしてください。Pochimailがパスワードを見ることはなく、アカウントは後から追加できます。",
      params: [],
    },
    "connect.gmail": { text: "Gmailで続行", params: [] },
    "connect.waiting": { text: "ブラウザでのサインインをお待ちしています…", params: [] },
    "connect.cancelled": {
      text: "サインインはキャンセルされました。アカウントは接続されていません。",
      params: [],
    },
    "connect.failed": {
      text: "アカウントを接続できませんでした。何も変更していません。",
      params: [],
    },
    "connect.notConfigured": {
      text: "このビルドにはGoogleサインインが設定されていません。",
      params: [],
    },
    "connect.providerFailed": {
      text: "Googleでのサインインを完了できませんでした。接続を確認してもう一度お試しください。何も変更していません。",
      params: [],
    },
    "connect.storageUnavailable": {
      text: "ローカルストレージをまだ開けません。Pochimailを再起動してもう一度お試しください。何も変更していません。",
      params: [],
    },
    "connect.cancel": { text: "キャンセル", params: [] },
    "connect.noAddress": {
      text: "Googleからメールアドレスが共有されなかったため、アカウントを接続できませんでした。何も変更していません。",
      params: [],
    },
    "connect.retry": { text: "もう一度試す", params: [] },
    "connect.back": { text: "戻る", params: [] },
    "connect.promises.heading": { text: "お約束", params: [] },
    "connect.promise.local.title": {
      text: "メールはこの{device}の中だけで処理します",
      params: ["device"],
    },
    "connect.promise.local.body": {
      text: "すべてこの端末内で分析します。サーバーもクラウドAIも使いません。",
      params: [],
    },
    "connect.promise.control.title": { text: "できることはあなたが決めます", params: [] },
    "connect.promise.control.body": {
      text: "次に、見るだけか、提案するか、自分で動くかを選びます。",
      params: [],
    },
    "connect.promise.delete.title": { text: "主導権はあなたにあります", params: [] },
    "connect.promise.delete.body": {
      text: "ご承認なしに削除はしません。削除したメールはゴミ箱に入り、元に戻せます。",
      params: [],
    },
  },
} as const;
