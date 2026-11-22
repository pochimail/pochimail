import type { Category } from "@pochimail/classification/model/category";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";

/** One translated label per category id, shared by the sidebar and the category screen. */
export const CATEGORY_LABELS: Readonly<Record<Category, MessageKey>> = {
  people: "category.people",
  records: "category.records",
  "purchases-travel": "category.purchasesTravel",
  "sign-ins-security": "category.signInsSecurity",
  notifications: "category.notifications",
  newsletters: "category.newsletters",
  promotions: "category.promotions",
};

/** Route params are opaque strings; an unknown id keeps its raw label. */
export const categoryLabelKey = (id: string): MessageKey | undefined =>
  (CATEGORY_LABELS as Readonly<Partial<Record<string, MessageKey>>>)[id];
