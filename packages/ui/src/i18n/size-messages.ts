/** Size copy per locale. Plain objects, like summary-messages.ts, so the catalogs can spread it in. */
export const sizeMessages = {
  en: {
    "overview.size.gb": { text: "{size, number} GB", params: ["size"] },
    "overview.size.mb": { text: "{size, number} MB", params: ["size"] },
    "overview.size.underTenthMb": { text: "< 0.1 MB", params: [] },
    "overview.size.free": {
      text: "{size, number} GB you can free, out of {total, number} GB",
      params: ["size", "total"],
    },
    "overview.size.freeMb": {
      text: "{size, number} MB you can free, out of {total, number} MB",
      params: ["size", "total"],
    },
    "overview.size.freeUnderTenthMb": {
      text: "< 0.1 MB you can free, out of {total, number} MB",
      params: ["total"],
    },
    "overview.size.freeMixed": {
      text: "{size, number} MB you can free, out of {total, number} GB",
      params: ["size", "total"],
    },
    "overview.size.freeUnderTenthMixed": {
      text: "< 0.1 MB you can free, out of {total, number} GB",
      params: ["total"],
    },
  },
  fr: {
    "overview.size.gb": { text: "{size, number} Go", params: ["size"] },
    "overview.size.mb": { text: "{size, number} Mo", params: ["size"] },
    "overview.size.underTenthMb": { text: "< 0,1 Mo", params: [] },
    "overview.size.free": {
      text: "{size, number} Go à libérer, sur {total, number} Go",
      params: ["size", "total"],
    },
    "overview.size.freeMb": {
      text: "{size, number} Mo à libérer, sur {total, number} Mo",
      params: ["size", "total"],
    },
    "overview.size.freeUnderTenthMb": {
      text: "< 0,1 Mo à libérer, sur {total, number} Mo",
      params: ["total"],
    },
    "overview.size.freeMixed": {
      text: "{size, number} Mo à libérer, sur {total, number} Go",
      params: ["size", "total"],
    },
    "overview.size.freeUnderTenthMixed": {
      text: "< 0,1 Mo à libérer, sur {total, number} Go",
      params: ["total"],
    },
  },
  ja: {
    "overview.size.gb": { text: "{size, number} GB", params: ["size"] },
    "overview.size.mb": { text: "{size, number} MB", params: ["size"] },
    "overview.size.underTenthMb": { text: "0.1 MB未満", params: [] },
    "overview.size.free": {
      text: "合計{total, number} GBのうち、{size, number} GBを空けられます。",
      params: ["size", "total"],
    },
    "overview.size.freeMb": {
      text: "合計{total, number} MBのうち、{size, number} MBを空けられます。",
      params: ["size", "total"],
    },
    "overview.size.freeUnderTenthMb": {
      text: "合計{total, number} MBのうち、0.1 MB未満を空けられます。",
      params: ["total"],
    },
    "overview.size.freeMixed": {
      text: "合計{total, number} GBのうち、{size, number} MBを空けられます。",
      params: ["size", "total"],
    },
    "overview.size.freeUnderTenthMixed": {
      text: "合計{total, number} GBのうち、0.1 MB未満を空けられます。",
      params: ["total"],
    },
  },
} as const;
