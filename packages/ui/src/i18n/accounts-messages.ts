/** Reconnect and remove-account copy per locale. Plain objects, so this file needs nothing from the catalogs that spread it in. */
export const accountsMessages = {
  en: {
    "settings.accounts": { text: "Accounts", params: [] },
    "accounts.provider.google": { text: "Gmail", params: [] },
    "accounts.provider.microsoft": { text: "Outlook", params: [] },
    "accounts.needsReauth": {
      text: "{provider} · needs you to sign in again",
      params: ["provider"],
    },
    "accounts.reconnect": { text: "Reconnect", params: [] },
    "accounts.remove": { text: "Remove", params: [] },
    "accounts.remove.title": { text: "Remove {address}?", params: ["address"] },
    "accounts.remove.body": {
      text: "I’ll revoke my access at {provider} and delete what Pochimail keeps for this account on this device. Your mailbox and your saved documents aren’t touched.",
      params: ["provider"],
    },
    "accounts.remove.confirm": { text: "Remove account", params: [] },
    "accounts.remove.cancel": { text: "Keep account", params: [] },
    "accounts.remove.failed": {
      text: "I couldn’t remove this account. Nothing was changed.",
      params: [],
    },
    "accounts.removed": { text: "I removed {address}.", params: ["address"] },
    "accounts.removed.notRevoked": {
      text: "I removed {address}. {provider} may still list Pochimail among its connected apps: you can remove it there.",
      params: ["address", "provider"],
    },
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
    "settings.accounts": { text: "Comptes", params: [] },
    "accounts.provider.google": { text: "Gmail", params: [] },
    "accounts.provider.microsoft": { text: "Outlook", params: [] },
    "accounts.needsReauth": {
      text: "{provider} · vous devez vous reconnecter",
      params: ["provider"],
    },
    "accounts.reconnect": { text: "Reconnecter", params: [] },
    "accounts.remove": { text: "Supprimer", params: [] },
    "accounts.remove.title": { text: "Supprimer {address} ?", params: ["address"] },
    "accounts.remove.body": {
      text: "Je révoquerai mon accès chez {provider} et j’effacerai ce que Pochimail conserve pour ce compte sur cet appareil. Votre boîte mail et vos documents enregistrés ne sont pas touchés.",
      params: ["provider"],
    },
    "accounts.remove.confirm": { text: "Supprimer le compte", params: [] },
    "accounts.remove.cancel": { text: "Garder le compte", params: [] },
    "accounts.remove.failed": {
      text: "Je n’ai pas pu supprimer ce compte. Rien n’a été modifié.",
      params: [],
    },
    "accounts.removed": { text: "J’ai supprimé {address}.", params: ["address"] },
    "accounts.removed.notRevoked": {
      text: "J’ai supprimé {address}. {provider} peut encore lister Pochimail parmi ses applications connectées : vous pouvez l’y retirer.",
      params: ["address", "provider"],
    },
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
    "settings.accounts": { text: "アカウント", params: [] },
    "accounts.provider.google": { text: "Gmail", params: [] },
    "accounts.provider.microsoft": { text: "Outlook", params: [] },
    "accounts.needsReauth": { text: "{provider} · 再度サインインが必要です", params: ["provider"] },
    "accounts.reconnect": { text: "再接続", params: [] },
    "accounts.remove": { text: "削除", params: [] },
    "accounts.remove.title": { text: "{address}を削除しますか？", params: ["address"] },
    "accounts.remove.body": {
      text: "{provider}でのアクセスを取り消し、このデバイスにPochimailが保存しているこのアカウントのデータを削除します。メールボックスと保存済みの書類には影響しません。",
      params: ["provider"],
    },
    "accounts.remove.confirm": { text: "アカウントを削除", params: [] },
    "accounts.remove.cancel": { text: "アカウントを残す", params: [] },
    "accounts.remove.failed": {
      text: "このアカウントを削除できませんでした。何も変更されていません。",
      params: [],
    },
    "accounts.removed": { text: "{address}を削除しました。", params: ["address"] },
    "accounts.removed.notRevoked": {
      text: "{address}を削除しました。{provider}の連携アプリ一覧にPochimailが残っている場合があります。そちらから削除できます。",
      params: ["address", "provider"],
    },
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
