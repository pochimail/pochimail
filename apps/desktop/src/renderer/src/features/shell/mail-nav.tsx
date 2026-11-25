import type { EmailType } from "@pochimail/classification/model/email-type";
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

/** The types that hold email, in the fixed order of ADR 0016. */
export function TypeItems({
  types,
  pathname,
}: {
  types: readonly { id: EmailType; count: number }[];
  pathname: string;
}) {
  const t = useT();
  return types.map(({ id, count }) => (
    <SidebarMenuItem key={id} reach="wide">
      <SidebarMenuButton
        asChild
        isActive={pathname === `/type/${id}`}
        tone="muted"
        tooltip={t(TYPE_NAV[id].label)}
      >
        <Link to="/type/$typeId" params={{ typeId: id }} search={(prev) => prev}>
          <RowContent icon={TYPE_NAV[id].icon} label={t(TYPE_NAV[id].label)} count={count} />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  ));
}

/** The topics that hold email; the group is absent while there are none. */
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
            >
              <Link to="/topic/$topicId" params={{ topicId: id }} search={(prev) => prev}>
                <RowContent icon={HashIcon} label={name} count={count} />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
