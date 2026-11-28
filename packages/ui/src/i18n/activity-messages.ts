/** Activity screen copy per locale. Plain objects, so this file needs nothing from the catalogs that spread it in. */
export const activityMessages = {
  en: {
    "activity.subtitle": { text: "Everything I did, and what you can undo", params: [] },
    "activity.intro": {
      text: "Deleted emails stay in the Trash until Gmail or Outlook clears it, about 30 days. Undo brings them back while they are still there.",
      params: [],
    },
    "activity.today": { text: "Today", params: [] },
    "activity.yesterday": { text: "Yesterday", params: [] },
    "activity.archived.title": {
      text: "Archived {count, plural, one {# email} other {# emails}}",
      params: ["count"],
    },
    "activity.archived.detail": { text: "They are in the Archive of your accounts.", params: [] },
    "activity.trash.title": {
      text: "Moved {count, plural, one {# email} other {# emails}} to the Trash",
      params: ["count"],
    },
    "activity.trash.detail": { text: "Undo while they are still in the Trash.", params: [] },
    "activity.unsubscribe.title": {
      text: "Unsubscribed from {count, plural, one {# sender} other {# senders}}",
      params: ["count"],
    },
    "activity.unsubscribe.detail": {
      text: "I sent one-click requests. This can’t be undone.",
      params: [],
    },
    "activity.restored.title": {
      text: "Brought back {count, plural, one {# email} other {# emails}}",
      params: ["count"],
    },
    "activity.restored.detail": { text: "They are where they were before.", params: [] },
    "activity.other.title": {
      text: "Changed {count, plural, one {# email} other {# emails}}",
      params: ["count"],
    },
    "activity.failed.title": {
      text: "Couldn’t change {count, plural, one {# email} other {# emails}}",
      params: ["count"],
    },
    "activity.failed.detail": {
      text: "The provider did not answer. Nothing was lost.",
      params: [],
    },
    "activity.refused.title": {
      text: "Left {count, plural, one {# email} other {# emails}} alone",
      params: ["count"],
    },
    "activity.refused.detail": {
      text: "It needed your approval, or they are protected.",
      params: [],
    },
    "activity.undone.detail": { text: "Undone. They are back where they were.", params: [] },
    "activity.undoAll": { text: "Undo all", params: [] },
    "activity.undone": { text: "Undone", params: [] },
    "activity.cantUndo": { text: "Can’t be undone", params: [] },
    "activity.undoUnavailable": { text: "Undo unavailable", params: [] },
    "activity.undoFailed": { text: "I couldn’t undo that. Try again later.", params: [] },
    "activity.loading": { text: "Loading your activity", params: [] },
    "activity.error.title": { text: "I could not load your activity.", params: [] },
    "activity.more": { text: "Show more", params: [] },
  },
  fr: {
    "activity.subtitle": {
      text: "Tout ce que j’ai fait, et ce que vous pouvez annuler",
      params: [],
    },
    "activity.intro": {
      text: "Les emails supprimés restent dans la corbeille jusqu’à ce que Gmail ou Outlook la vide, environ 30 jours. Annuler les remet tant qu’ils y sont.",
      params: [],
    },
    "activity.today": { text: "Aujourd’hui", params: [] },
    "activity.yesterday": { text: "Hier", params: [] },
    "activity.archived.title": {
      text: "{count, plural, one {# email archivé} other {# emails archivés}}",
      params: ["count"],
    },
    "activity.archived.detail": { text: "Ils sont dans les archives de vos comptes.", params: [] },
    "activity.trash.title": {
      text: "{count, plural, one {# email déplacé} other {# emails déplacés}} dans la corbeille",
      params: ["count"],
    },
    "activity.trash.detail": { text: "Annulez tant qu’ils sont dans la corbeille.", params: [] },
    "activity.unsubscribe.title": {
      text: "Désabonnement de {count, plural, one {# expéditeur} other {# expéditeurs}}",
      params: ["count"],
    },
    "activity.unsubscribe.detail": {
      text: "J’ai envoyé des demandes en un clic. Impossible de l’annuler.",
      params: [],
    },
    "activity.restored.title": {
      text: "{count, plural, one {# email remis} other {# emails remis}} en place",
      params: ["count"],
    },
    "activity.restored.detail": { text: "Ils sont là où ils étaient avant.", params: [] },
    "activity.other.title": {
      text: "{count, plural, one {# email modifié} other {# emails modifiés}}",
      params: ["count"],
    },
    "activity.failed.title": {
      text: "Impossible de modifier {count, plural, one {# email} other {# emails}}",
      params: ["count"],
    },
    "activity.failed.detail": {
      text: "Le fournisseur n’a pas répondu. Rien n’a été perdu.",
      params: [],
    },
    "activity.refused.title": {
      text: "{count, plural, one {# email laissé} other {# emails laissés}} tel quel",
      params: ["count"],
    },
    "activity.refused.detail": {
      text: "Il fallait votre accord, ou ils sont protégés.",
      params: [],
    },
    "activity.undone.detail": { text: "Annulé. Ils sont revenus où ils étaient.", params: [] },
    "activity.undoAll": { text: "Tout annuler", params: [] },
    "activity.undone": { text: "Annulé", params: [] },
    "activity.cantUndo": { text: "Impossible à annuler", params: [] },
    "activity.undoUnavailable": { text: "Annulation indisponible", params: [] },
    "activity.undoFailed": { text: "Je n’ai pas pu annuler. Réessayez plus tard.", params: [] },
    "activity.loading": { text: "Chargement de votre activité", params: [] },
    "activity.error.title": { text: "Je n’ai pas pu charger votre activité.", params: [] },
    "activity.more": { text: "Afficher plus", params: [] },
  },
  ja: {
    "activity.subtitle": { text: "実行した内容と、元に戻せるもの", params: [] },
    "activity.intro": {
      text: "削除したメールは、GmailやOutlookが空にするまで（約30日間）ゴミ箱に残ります。残っている間は元に戻せます。",
      params: [],
    },
    "activity.today": { text: "今日", params: [] },
    "activity.yesterday": { text: "昨日", params: [] },
    "activity.archived.title": {
      text: "{count, plural, other {#件のメールをアーカイブしました}}",
      params: ["count"],
    },
    "activity.archived.detail": { text: "アカウントのアーカイブにあります。", params: [] },
    "activity.trash.title": {
      text: "{count, plural, other {#件のメールをゴミ箱に移動しました}}",
      params: ["count"],
    },
    "activity.trash.detail": { text: "ゴミ箱にある間は元に戻せます。", params: [] },
    "activity.unsubscribe.title": {
      text: "{count, plural, other {#件の送信元}}の配信を停止しました",
      params: ["count"],
    },
    "activity.unsubscribe.detail": {
      text: "ワンクリックのリクエストを送信しました。元に戻せません。",
      params: [],
    },
    "activity.restored.title": {
      text: "{count, plural, other {#件のメールを元に戻しました}}",
      params: ["count"],
    },
    "activity.restored.detail": { text: "元の場所に戻っています。", params: [] },
    "activity.other.title": {
      text: "{count, plural, other {#件のメールを変更しました}}",
      params: ["count"],
    },
    "activity.failed.title": {
      text: "{count, plural, other {#件のメール}}を変更できませんでした",
      params: ["count"],
    },
    "activity.failed.detail": {
      text: "プロバイダーから応答がありませんでした。何も失われていません。",
      params: [],
    },
    "activity.refused.title": {
      text: "{count, plural, other {#件のメール}}はそのままにしました",
      params: ["count"],
    },
    "activity.refused.detail": { text: "承認が必要か、保護されています。", params: [] },
    "activity.undone.detail": { text: "元に戻しました。元の場所にあります。", params: [] },
    "activity.undoAll": { text: "すべて元に戻す", params: [] },
    "activity.undone": { text: "元に戻しました", params: [] },
    "activity.cantUndo": { text: "元に戻せません", params: [] },
    "activity.undoUnavailable": { text: "元に戻せなくなりました", params: [] },
    "activity.undoFailed": {
      text: "元に戻せませんでした。後でもう一度お試しください。",
      params: [],
    },
    "activity.loading": { text: "アクティビティを読み込み中", params: [] },
    "activity.error.title": { text: "アクティビティを読み込めませんでした。", params: [] },
    "activity.more": { text: "もっと見る", params: [] },
  },
} as const;
