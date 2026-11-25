import { appearanceMessages } from "./appearance-messages.ts";
import { connectMessages } from "./connect-messages.ts";
import { type Catalog, entry } from "./messages.ts";
import { notificationMessages } from "./notification-messages.ts";
import { sizeMessages } from "./size-messages.ts";
import { storageMessages } from "./storage-messages.ts";
import { summaryMessages } from "./summary-messages.ts";

/**
 * French catalog. Typed against the English keys: a missing key or a renamed placeholder fails
 * typecheck. Voice: warm and plain, "emails" (never "mails"), "Pochi"/"je" for the assistant.
 */
export const fr = {
  "overview.title": entry("Vue d’ensemble", []),
  "overview.privacy": entry("Tout reste sur cet appareil. Rien n’est envoyé nulle part.", []),
  "overview.promise.device": entry("Vos emails ne quittent jamais votre {device}.", ["device"]),
  "overview.sorting": entry("Je trie en privé sur votre {device}", ["device"]),
  "overview.email.count": entry(
    "{count, plural, =0 {Aucun email} one {# email} other {# emails}}",
    ["count"],
  ),
  ...sizeMessages.fr,
  "overview.figure.archived": entry("emails archivés", []),
  "overview.figure.saved": entry("pièces jointes enregistrées", []),
  "overview.figure.unsubscribed": entry("newsletters désabonnées", []),
  "scan.failed": entry(
    "Je n'ai pas pu finir le tri. Rien n'a été modifié. Relancez-le et je reprendrai là où je me suis arrêté.",
    [],
  ),
  "overview.review": entry("Examiner", []),
  "overview.pause": entry("Pause", []),
  "overview.resume": entry("Reprendre", []),
  "overview.viewSummary": entry("Voir le résumé", []),
  "overview.catch.title": entry("Ce qui compte vraiment", []),
  "overview.clean.title": entry("Faire le tri", []),
  "overview.accounts": entry("{count, plural, one {# compte} other {# comptes}}", ["count"]),
  "overview.catch.note": entry("Je ne nettoie jamais ces emails", []),
  "overview.clean.note": entry("Rien ne se passe avant que vous ayez examiné", []),
  "overview.waiting.title": entry(
    "{count, plural, one {personne vous attend} other {personnes vous attendent}}",
    ["count"],
  ),
  "overview.waiting.detail": entry(
    "La plus ancienne attend depuis {days, plural, one {# jour} other {# jours}}",
    ["days"],
  ),
  "overview.deadlines.title": entry(
    "{count, plural, one {email mentionne une échéance} other {emails mentionnent une échéance}}",
    ["count"],
  ),
  "overview.deadlines.detail": entry("Des dates repérées dans vos emails", []),
  "overview.important.title": entry(
    "{count, plural, one {email d’une personne importante} other {emails de personnes importantes}}",
    ["count"],
  ),
  "overview.important.detail": entry("Des expéditeurs à qui vous répondez souvent", []),
  "overview.clean.headline": entry("emails à supprimer, sur {total, number}", ["total"]),
  "overview.clean.summary": entry("{total, number} emails triés", ["total"]),
  "overview.clean.keep": entry("Restent", []),
  "overview.clean.free": entry("À supprimer", []),
  "overview.clean.sizeUnknown": entry("Je n’ai que des nombres, pas de Go libéré.", []),
  "overview.clean.noFreeing": entry("Ceux-ci ne libèrent pas d’espace", []),
  "overview.clean.never": entry(
    "Les emails qui semblent importants ne sont jamais sélectionnés pour vous.",
    [],
  ),
  "overview.rec.newsletters.sentence": entry("Se désabonner des newsletters", []),
  "overview.rec.newsletters.reason": entry("Des expéditeurs réguliers que vous pouvez quitter", []),
  "overview.rec.promotions.sentence": entry("Supprimer les anciennes promotions", []),
  "overview.rec.promotions.reason": entry("Des emails de ventes et de marketing", []),
  "overview.rec.notifications.sentence": entry("Archiver les emails d’alerte", []),
  "overview.rec.notifications.reason": entry(
    "Des alertes automatiques, pas des emails de personnes. Examiner ouvre la liste : rien n’est archivé avant votre accord.",
    [],
  ),
  "overview.rec.signins.sentence": entry("Supprimer les codes de connexion expirés", []),
  "overview.rec.signins.reason": entry("Des codes à usage unique et des alertes de connexion", []),
  "overview.scan.progress": entry("{processed, number} emails triés sur {total, number}", [
    "processed",
    "total",
  ]),
  "overview.scan.progressNoTotal": entry("{processed, number} emails triés pour l’instant", [
    "processed",
  ]),
  "overview.nothingToCatch": entry("Rien ne demande votre attention pour le moment.", []),
  "overview.nothingToClean": entry("Rien à nettoyer pour le moment.", []),
  "overview.empty.title": entry("Aucun email pour l’instant", []),
  "overview.empty.description": entry(
    "Connectez un compte et je commencerai à trier sur cet appareil.",
    [],
  ),
  "overview.empty.action": entry("Connecter un compte", []),
  "overview.worker.unavailable": entry("Je n’ai pas pu charger la vue d’ensemble.", []),
  "overview.retry": entry("Réessayer", []),
  "overview.scan.paused": entry("En pause. Rien n’a été modifié.", []),
  "overview.loading": entry("Chargement de la vue d’ensemble", []),
  ...summaryMessages.fr,

  "sync.progress": entry("Synchronisation de vos emails", []),
  "shell.loading": entry("Démarrage…", []),
  "shell.error.title": entry("Un problème est survenu", []),
  "shell.error.body": entry(
    "Pochimail a rencontré un problème. Fermez et rouvrez l’application pour réessayer.",
    [],
  ),

  "tray.open": entry("Ouvrir Pochimail", []),
  "tray.quit": entry("Quitter Pochimail", []),

  "welcome.headline": entry("Faites le tri dans vos emails. Gardez l’essentiel.", []),
  "welcome.description": entry(
    "Pochimail est un assistant privé pour les comptes email que vous avez déjà. Il repère ce qui a besoin de vous, fait le tri dans l’encombrement et enregistre vos documents. Vos emails ne quittent jamais votre {device}.",
    ["device"],
  ),
  "welcome.cta": entry("Commencer", []),
  "welcome.openSource": entry("Gratuit et open source", []),
  "onboarding.progress": entry("Étape {current} sur {total}", ["current", "total"]),

  ...connectMessages.fr,
  ...storageMessages.fr,
  "setup.title": entry("Configuration", []),
  "setup.description": entry("Choisissez comment Pochi peut vous aider.", []),
  "setup.bubble": entry(
    "Bonjour, je suis Pochi. Dites-moi ce que je peux faire pour vous et jusqu'où je peux aller. Vous pourrez changer cela à tout moment dans les réglages.",
    [],
  ),
  "setup.capabilities.heading": entry("Que dois-je faire pour vous ?", []),
  "setup.capabilities.hint": entry("Plusieurs choix possibles", []),
  "setup.capability.catch-what-matters.title": entry("Repérer l'essentiel", []),
  "setup.capability.catch-what-matters.description": entry(
    "Signaler les personnes qui vous attendent, les échéances et les expéditeurs importants.",
    [],
  ),
  "setup.capability.declutter.title": entry("Faire le tri", []),
  "setup.capability.declutter.description": entry(
    "Vous désabonner et archiver ce dont vous n'avez pas besoin.",
    [],
  ),
  "setup.capability.organize.title": entry("Organiser", []),
  "setup.capability.organize.description": entry(
    "Classer vos emails en catégories et sujets clairs, sous forme de libellés.",
    [],
  ),
  "setup.capability.save-documents.title": entry("Enregistrer les documents", []),
  "setup.capability.save-documents.description": entry(
    "Repérer les pièces jointes importantes et les ranger dans un dossier.",
    [],
  ),
  "setup.autonomy.heading": entry("Jusqu'où puis-je aller ?", []),
  "setup.autonomy.recommended": entry("Recommandé", []),
  "setup.autonomy.just-look.title": entry("Observer", []),
  "setup.autonomy.just-look.description": entry(
    "Je vous montre, mais je ne change jamais rien.",
    [],
  ),
  "setup.autonomy.suggest.title": entry("Proposer", []),
  "setup.autonomy.suggest.description": entry("Je prépare, vous validez chaque étape.", []),
  "setup.autonomy.autopilot.title": entry("Pilote automatique", []),
  "setup.autonomy.autopilot.description": entry(
    "Je m'occupe de l'évident, puis je vous le dis.",
    [],
  ),
  "setup.autonomy.autopilot.reminder": entry(
    "Avec le pilote automatique, je n'archive ou ne désabonne que si j'en suis sûr à au moins {percent} %, et je ne touche jamais aux emails de vraies personnes. Je consigne tout et je vous en rends compte ensuite. Vous pouvez l'annuler, sauf un désabonnement.",
    ["percent"],
  ),
  "setup.invariants": entry(
    "Quel que soit le mode, je n'agis jamais sur les emails de vraies personnes sans vous demander. Je consigne chaque action, et vous pouvez toutes les annuler, sauf un désabonnement.",
    [],
  ),
  "setup.capabilities.none": entry(
    "Choisissez au moins une chose pour laquelle je peux vous aider.",
    [],
  ),
  "setup.settingsError": entry("Je n'ai pas pu charger vos choix.", []),
  "setup.retry": entry("Réessayer", []),
  "setup.start": entry("Commencer le tri", []),
  "setup.error": entry("Je n'ai pas pu lancer le tri. Veuillez réessayer.", []),

  "documents.title": entry("Documents", []),

  "activity.title": entry("Activité", []),

  "settings.title": entry("Réglages", []),
  "settings.description": entry("Les préférences et les réglages du compte apparaîtront ici.", []),
  ...appearanceMessages.fr,

  "nav.brand": entry("Pochimail", []),
  "nav.label": entry("Navigation principale", []),
  "nav.email": entry("Email", []),
  "nav.tools": entry("Outils", []),
  "nav.teams": entry("Équipes", []),
  "nav.soon": entry("Bientôt", []),
  "switcher.menu": entry("Compte", []),
  "switcher.all": entry("Tous les comptes", []),
  "switcher.add": entry("Ajouter un autre compte", []),
  "category.people": entry("Personnes", []),
  "category.records": entry("Documents officiels", []),
  "category.purchasesTravel": entry("Achats et voyages", []),
  "category.signInsSecurity": entry("Connexions et sécurité", []),
  "category.notifications": entry("Emails d’alerte", []),
  "category.newsletters": entry("Newsletters", []),
  "category.promotions": entry("Promotions", []),
  "category.placeholder": entry("Les emails de cette catégorie apparaîtront ici.", []),
  ...notificationMessages.fr,

  "devGallery.title": entry("Galerie de développement", []),
  "devGallery.description": entry("Aperçus des états et des animations pour le développement.", []),
  "devGallery.dark": entry("Thème sombre", []),
  "devGallery.reduceMotion": entry("Réduire les animations", []),
  "devGallery.states": entry("États", []),
  "devGallery.motion": entry("Animations", []),
  "action.close": entry("Fermer", []),
  "action.undo": entry("Annuler", []),
  "action.backToOverview": entry("Retour à la vue d’ensemble", []),
  "storageBar.description": entry("{summary} : {items}", ["summary", "items"]),
  "storageBar.descriptionItem": entry("{size} {label}", ["size", "label"]),
  "storageBar.itemSeparator": entry(", ", []),
  "storageBar.legendItem": entry("{label} · {size}", ["label", "size"]),
  "state.signInCancelled.title": entry("Connexion annulée", []),
  "state.signInCancelled.body": entry(
    "Pas de souci. Je n’ai eu accès à rien. Vous pouvez réessayer quand vous voulez.",
    [],
  ),
  "state.signInCancelled.retry": entry("Réessayer", []),
  "state.signInCancelled.other": entry("Choisir un autre compte", []),
  "state.offline.title": entry("Vous êtes hors ligne", []),
  "state.offline.body": entry(
    "Continuez comme d’habitude. Je me synchroniserai de nouveau et j’appliquerai ce que vous avez approuvé dès votre retour en ligne.",
    [],
  ),
  "state.offline.dismiss": entry("Compris", []),
  "state.reconnect.title": entry("J’ai perdu l’accès à votre compte {provider}", ["provider"]),
  "state.reconnect.body": entry(
    "{provider} vous demande de vous reconnecter. Votre tri et vos réglages sont en sécurité.",
    ["provider"],
  ),
  "state.reconnect.action": entry("Reconnecter", []),
  "state.reconnect.remove": entry("Supprimer le compte", []),
  "state.modelFailed.title": entry("Le modèle de l’assistant n’a pas été téléchargé", []),
  "state.modelFailed.body": entry(
    "Je peux continuer à trier avec des règles simples pendant que vous réessayez. Les résultats seront un peu moins précis.",
    [],
  ),
  "state.modelFailed.retry": entry("Réessayer le téléchargement", []),
  "state.modelFailed.rules": entry("Continuer avec les règles", []),
  "state.rateLimit.title": entry("{provider} me ralentit", ["provider"]),
  "state.rateLimit.body": entry(
    "Les grandes boîtes de réception atteignent les limites de {provider}. Je reprendrai automatiquement dans {minutes, plural, one {# minute} other {# minutes}}.",
    ["provider", "minutes"],
  ),
  "state.rateLimit.dismiss": entry("Compris", []),
  "state.emptyActivity.title": entry("Rien pour l’instant", []),
  "state.emptyActivity.body": entry(
    "Quand j’archive, je supprime ou je me désabonne pour vous, l’action apparaît ici avec un Annuler lorsque c’est possible.",
    [],
  ),
  "state.emptyDocuments.title": entry("Rien d’enregistré pour l’instant", []),
  "state.emptyDocuments.body": entry(
    "Les documents que je vous enregistre apparaîtront ici, sur cet appareil.",
    [],
  ),
  "state.emptyCategory.title": entry("Rien à nettoyer ici", []),
  "state.emptyCategory.body": entry(
    "Cette catégorie est déjà en ordre. Je vous préviendrai si cela change.",
    [],
  ),
  "state.emptyCategory.action": entry("Retour à la vue d’ensemble", []),
  "state.nothingToDo.title": entry("Tout est à jour", []),
  "state.nothingToDo.body": entry(
    "Rien ne demande votre attention. Je vous préviendrai si cela change.",
    [],
  ),
  "state.nothingToDo.action": entry("Retour à la vue d’ensemble", []),
  "state.updateReady.title": entry("Une nouvelle version est prête", []),
  "state.updateReady.body": entry(
    "Pochimail {version} est prêt. Il s’installe au redémarrage, et vos emails restent où ils sont.",
    ["version"],
  ),
  "state.updateReady.restart": entry("Redémarrer maintenant", []),
  "state.updateReady.whatsNew": entry("Nouveautés", []),
} satisfies Catalog;
