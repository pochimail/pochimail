/** Storage-protection prompt copy per locale (ADR 0005). Plain objects, so this file needs nothing from the catalogs that spread it in. */
export const storageMessages = {
  en: {
    "storage.passphrase.title": { text: "Lock your local data", params: [] },
    "storage.passphrase.description": {
      text: "This computer has no password manager I can use, so I can’t keep the key to my local data safe on my own. A passphrase can.",
      params: [],
    },
    "storage.passphrase.label": { text: "Passphrase", params: [] },
    "storage.passphrase.repeat": { text: "Repeat the passphrase", params: [] },
    "storage.passphrase.mismatch": { text: "The two passphrases don’t match.", params: [] },
    "storage.passphrase.tooShort": {
      text: "Use at least {count, number} characters.",
      params: ["count"],
    },
    "storage.passphrase.protects.title": { text: "What a passphrase protects", params: [] },
    "storage.passphrase.protects.body": {
      text: "It locks the data I keep on this computer. You enter it each time you open Pochimail, and I can’t recover it if you lose it.",
      params: [],
    },
    "storage.passphrase.submit": { text: "Use this passphrase", params: [] },
    "storage.unprotected.choose": { text: "Store without protection", params: [] },
    "storage.unprotected.title": { text: "Store without protection?", params: [] },
    "storage.unprotected.description": {
      text: "I will keep the data on this computer unlocked. You can still choose a passphrase instead.",
      params: [],
    },
    "storage.unprotected.open.title": { text: "What stays open", params: [] },
    "storage.unprotected.open.body": {
      text: "Anyone who can read your files can read what I keep on this computer: senders, dates and how I sorted your email.",
      params: [],
    },
    "storage.unprotected.safe.title": { text: "What is not affected", params: [] },
    "storage.unprotected.safe.body": {
      text: "Your emails stay with your provider, and the files you saved to your own storage stay where they are.",
      params: [],
    },
    "storage.unprotected.usePassphrase": { text: "Use a passphrase", params: [] },
    "storage.unlock.title": { text: "Enter your passphrase", params: [] },
    "storage.unlock.description": { text: "Your local data is locked.", params: [] },
    "storage.unlock.hint": { text: "I can’t recover a lost passphrase.", params: [] },
    "storage.unlock.submit": { text: "Unlock", params: [] },
    "storage.unlock.wrong": { text: "That passphrase doesn’t match.", params: [] },
    "storage.failed": {
      text: "I couldn’t save your choice. Nothing was changed. Restart Pochimail and try again.",
      params: [],
    },
  },
  fr: {
    "storage.passphrase.title": { text: "Verrouillez vos données locales", params: [] },
    "storage.passphrase.description": {
      text: "Cet ordinateur n’a pas de gestionnaire de mots de passe que je puisse utiliser, donc je ne peux pas protéger seul la clé de vos données locales. Une phrase secrète le peut.",
      params: [],
    },
    "storage.passphrase.label": { text: "Phrase secrète", params: [] },
    "storage.passphrase.repeat": { text: "Répétez la phrase secrète", params: [] },
    "storage.passphrase.mismatch": {
      text: "Les deux phrases secrètes ne correspondent pas.",
      params: [],
    },
    "storage.passphrase.tooShort": {
      text: "Utilisez au moins {count, number} caractères.",
      params: ["count"],
    },
    "storage.passphrase.protects.title": { text: "Ce que protège une phrase secrète", params: [] },
    "storage.passphrase.protects.body": {
      text: "Elle verrouille les données que je garde sur cet ordinateur. Vous la saisissez à chaque ouverture de Pochimail, et je ne peux pas la récupérer si vous la perdez.",
      params: [],
    },
    "storage.passphrase.submit": { text: "Utiliser cette phrase secrète", params: [] },
    "storage.unprotected.choose": { text: "Stocker sans protection", params: [] },
    "storage.unprotected.title": { text: "Stocker sans protection ?", params: [] },
    "storage.unprotected.description": {
      text: "Je garderai les données de cet ordinateur déverrouillées. Vous pouvez encore choisir une phrase secrète à la place.",
      params: [],
    },
    "storage.unprotected.open.title": { text: "Ce qui reste accessible", params: [] },
    "storage.unprotected.open.body": {
      text: "Toute personne qui peut lire vos fichiers peut lire ce que je garde sur cet ordinateur : expéditeurs, dates et la façon dont j’ai trié vos emails.",
      params: [],
    },
    "storage.unprotected.safe.title": { text: "Ce qui n’est pas touché", params: [] },
    "storage.unprotected.safe.body": {
      text: "Vos emails restent chez votre fournisseur, et les fichiers enregistrés dans votre propre stockage restent où ils sont.",
      params: [],
    },
    "storage.unprotected.usePassphrase": { text: "Utiliser une phrase secrète", params: [] },
    "storage.unlock.title": { text: "Saisissez votre phrase secrète", params: [] },
    "storage.unlock.description": { text: "Vos données locales sont verrouillées.", params: [] },
    "storage.unlock.hint": {
      text: "Je ne peux pas récupérer une phrase secrète perdue.",
      params: [],
    },
    "storage.unlock.submit": { text: "Déverrouiller", params: [] },
    "storage.unlock.wrong": { text: "Cette phrase secrète ne correspond pas.", params: [] },
    "storage.failed": {
      text: "Je n’ai pas pu enregistrer votre choix. Rien n’a été modifié. Redémarrez Pochimail et réessayez.",
      params: [],
    },
  },
  ja: {
    "storage.passphrase.title": { text: "ローカルデータをロックする", params: [] },
    "storage.passphrase.description": {
      text: "このコンピューターには私が使えるパスワードマネージャーがないため、ローカルデータの鍵を私だけで安全に保てません。パスフレーズなら保てます。",
      params: [],
    },
    "storage.passphrase.label": { text: "パスフレーズ", params: [] },
    "storage.passphrase.repeat": { text: "パスフレーズをもう一度入力", params: [] },
    "storage.passphrase.mismatch": { text: "2つのパスフレーズが一致しません。", params: [] },
    "storage.passphrase.tooShort": {
      text: "{count, number}文字以上にしてください。",
      params: ["count"],
    },
    "storage.passphrase.protects.title": { text: "パスフレーズが守るもの", params: [] },
    "storage.passphrase.protects.body": {
      text: "このコンピューターに保存するデータをロックします。Pochimailを開くたびに入力が必要で、なくした場合は私には復元できません。",
      params: [],
    },
    "storage.passphrase.submit": { text: "このパスフレーズを使う", params: [] },
    "storage.unprotected.choose": { text: "保護せずに保存する", params: [] },
    "storage.unprotected.title": { text: "保護せずに保存しますか？", params: [] },
    "storage.unprotected.description": {
      text: "このコンピューターのデータはロックせずに保存します。あとからパスフレーズを選ぶこともできます。",
      params: [],
    },
    "storage.unprotected.open.title": { text: "誰でも読める範囲", params: [] },
    "storage.unprotected.open.body": {
      text: "ファイルを読める人なら、このコンピューターに保存した送信者、日付、メールの仕分け結果を読めます。",
      params: [],
    },
    "storage.unprotected.safe.title": { text: "影響しないもの", params: [] },
    "storage.unprotected.safe.body": {
      text: "メール本体はプロバイダーに残り、ご自身のストレージに保存したファイルもそのままです。",
      params: [],
    },
    "storage.unprotected.usePassphrase": { text: "パスフレーズを使う", params: [] },
    "storage.unlock.title": { text: "パスフレーズを入力してください", params: [] },
    "storage.unlock.description": { text: "ローカルデータはロックされています。", params: [] },
    "storage.unlock.hint": { text: "なくしたパスフレーズは私には復元できません。", params: [] },
    "storage.unlock.submit": { text: "ロック解除", params: [] },
    "storage.unlock.wrong": { text: "パスフレーズが一致しません。", params: [] },
    "storage.failed": {
      text: "選択を保存できませんでした。何も変更していません。Pochimailを再起動してもう一度お試しください。",
      params: [],
    },
  },
} as const;
