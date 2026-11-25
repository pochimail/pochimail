import { EMAIL_TYPES, type EmailType } from "@pochimail/classification/model/email-type";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuLabel,
} from "@pochimail/ui/components/sidebar";
import { useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import { Link } from "@tanstack/react-router";
import { AtSignIcon, FileTextIcon, HashIcon, NewspaperIcon, TagIcon, UserIcon } from "lucide-react";
import type { ComponentType } from "react";
import { TYPE_LABELS } from "../../lib/type-labels.ts";

const TYPE_NAV: Record<EmailType, { label: MessageKey; icon: ComponentType }> = {
  personal: { label: TYPE_LABELS.personal, icon: UserIcon },
  transactional: { label: TYPE_LABELS.transactional, icon: FileTextIcon },
  notification: { label: TYPE_LABELS.notification, icon: AtSignIcon },
  newsletter: { label: TYPE_LABELS.newsletter, icon: NewspaperIcon },
  promotion: { label: TYPE_LABELS.promotion, icon: TagIcon },
};

/** An empty section stays listed and clickable, muted, and its name says it is empty. */
const EMPTY_CLASS = "opacity-60";

/** The inside of a sidebar link: icon, label and email count. */
function RowContent({
  icon: Icon,
  label,
  count,
}: {
  icon: ComponentType;
  label: string;
  count: number;
}) {
  const locale = useLocale();
  return (
    <>
      <Icon />
      <SidebarMenuLabel>{label}</SidebarMenuLabel>
      <SidebarMenuBadge>{count.toLocaleString(locale)}</SidebarMenuBadge>
    </>
  );
}

/** Every type, always, with its count (0 when it has no email) in the fixed order of ADR 0016. */
export function TypeItems({
  counts,
  pathname,
}: {
  counts: Readonly<Partial<Record<EmailType, number>>> | undefined;
  pathname: string;
}) {
  const t = useT();
  return EMAIL_TYPES.map((id) => {
    const count = counts?.[id] ?? 0;
    const label = t(TYPE_NAV[id].label);
    return (
      <SidebarMenuItem key={id} reach="wide">
        <SidebarMenuButton
          asChild
          isActive={pathname === `/type/${id}`}
          tone="muted"
          tooltip={label}
          className={count === 0 ? EMPTY_CLASS : undefined}
        >
          <Link
            to="/type/$typeId"
            params={{ typeId: id }}
            search={(prev) => prev}
            aria-label={count === 0 ? t("nav.empty", { name: label }) : undefined}
          >
            <RowContent icon={TYPE_NAV[id].icon} label={label} count={count} />
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}

/** Every topic that exists, with its count; the group is absent only while no topic exists. */
export function TopicsGroup({
  topics,
  pathname,
}: {
  topics: readonly { id: string; name: string; count: number }[];
  pathname: string;
}) {
  const t = useT();
  if (topics.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("nav.topics")}</SidebarGroupLabel>
      <SidebarMenu>
        {topics.map(({ id, name, count }) => (
          <SidebarMenuItem key={id} reach="wide">
            <SidebarMenuButton
              asChild
              isActive={pathname === `/topic/${id}`}
              tone="muted"
              tooltip={name}
              className={count === 0 ? EMPTY_CLASS : undefined}
            >
              <Link
                to="/topic/$topicId"
                params={{ topicId: id }}
                search={(prev) => prev}
                aria-label={count === 0 ? t("nav.empty", { name }) : undefined}
              >
                <RowContent icon={HashIcon} label={name} count={count} />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
