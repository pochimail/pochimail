import { Button } from "@pochimail/ui/components/button";
import { Switch } from "@pochimail/ui/components/switch";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cn } from "@pochimail/ui/lib/utils";
import { useEffect, useState } from "react";
import type { CheckResult, UpdateState } from "#shared/update-calls.ts";
import { SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { SETTINGS_ROW } from "../../lib/settings-row.ts";
import { useUpdates } from "./updates-context.tsx";

type Shown = CheckResult | { status: "checking" } | { status: "none" };

/**
 * Settings › Updates: the running version, "Check now" and the switch for the automatic check. It never installs anything:
 * a newer version is a Download button that opens the releases page. Hidden in builds that do not check (dev, PR, smoke).
 */
export function UpdatesSection() {
  const updates = useUpdates();
  const t = useT();
  const [shown, setShown] = useState<Shown>({ status: "none" });
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    void updates?.state().then(setState, () => undefined);
  }, [updates]);

  if (updates === null || state === null || !state.enabled) return null;

  const checkNow = async (): Promise<void> => {
    setShown({ status: "checking" });
    const result = await updates.checkNow().catch((): CheckResult => ({ status: "failed" }));
    setShown(result);
    setState(await updates.state());
  };
  const available = shown.status === "available" ? shown.version : state.latest;
  const statusText = (): string => {
    if (shown.status === "checking") return t("update.checking");
    if (shown.status === "failed") return t("update.failed");
    if (available !== null) return t("update.available", { version: available });
    if (shown.status === "up-to-date") return t("update.upToDate");
    return t("update.current", { version: state.currentVersion });
  };

  return (
    <section aria-labelledby="settings-updates" className="flex flex-col gap-2">
      <h2 id="settings-updates" className={cn("mx-1", SECTION_TITLE_CLASS)}>
        {t("settings.updates")}
      </h2>
      <ul className="m-0 list-none rounded-2xl border border-border bg-card p-0">
        <li className={SETTINGS_ROW}>
          <span className="flex-1 text-body font-medium" aria-live="polite">
            {statusText()}
          </span>
          {available === null ? (
            <Button variant="secondary" size="sm" onClick={() => void checkNow()}>
              {t("update.checkNow")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void updates.download()}>
              {t("update.download")}
            </Button>
          )}
        </li>
        <li className={SETTINGS_ROW}>
          <span id="updates-auto-label" className="flex-1 text-body font-medium">
            {t("update.auto")}
          </span>
          <Switch
            aria-labelledby="updates-auto-label"
            checked={state.autoCheck}
            onCheckedChange={(autoCheck) => {
              setState({ ...state, autoCheck });
              void updates.setAutoCheck(autoCheck);
            }}
          />
        </li>
      </ul>
    </section>
  );
}
