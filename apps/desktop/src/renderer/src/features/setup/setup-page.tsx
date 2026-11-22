import {
  AUTONOMY_LEVELS,
  AUTOPILOT_CONFIDENCE_THRESHOLD,
} from "@pochimail/actions/policies/autonomy";
import { Button } from "@pochimail/ui/components/button";
import { CheckboxCard } from "@pochimail/ui/components/checkbox-card";
import type { MascotPose } from "@pochimail/ui/components/mascot";
import { RadioCard } from "@pochimail/ui/components/radio-card";
import { RadioGroup } from "@pochimail/ui/components/radio-group";
import { SpeechBubble } from "@pochimail/ui/components/speech-bubble";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LockIcon } from "lucide-react";
import { useRef, useState } from "react";
import { type AppSettings, CAPABILITIES, type Capability } from "#shared/settings.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";

type Choice = Pick<AppSettings, "autonomy" | "capabilities">;
type Phase = "saving" | "reading";

/** Setup: two plain questions and one button (brief §2, §7 item 3). The answers are saved, then the first scan starts. */
export function SetupPage({ pose }: { pose: MascotPose }) {
  const t = useT();
  const client = useWorkerClient();
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => client.call("settings.get"),
  });
  // The form starts from the saved answers, so it waits for them; the title stays put so focus is not lost.
  return (
    <div className="flex w-full flex-col gap-8">
      {/* Shown on focus so the keyboard focus the layout moves here is visible (docs/design.md, focus). */}
      <h1 className="sr-only rounded-md focus:not-sr-only focus:self-center focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        {t("setup.title")}
      </h1>
      {settings.data ? <SetupForm initial={settings.data} idlePose={pose} /> : null}
      {settings.isError ? (
        <div className="flex flex-col items-center gap-3">
          <p role="alert" className="text-ui text-destructive">
            {t("setup.settingsError")}
          </p>
          <Button variant="secondary" onClick={() => void settings.refetch()}>
            {t("setup.retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SetupForm({ initial, idlePose }: { initial: Choice; idlePose: MascotPose }) {
  const t = useT();
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [capabilities, setCapabilities] = useState(initial.capabilities);
  const [autonomy, setAutonomy] = useState(initial.autonomy);
  const [phase, setPhase] = useState(null as Phase | null);

  // Accounts whose scan already runs: a retry after a partial failure must not start them twice.
  const started = useRef(new Set<string>());
  // Set synchronously: a second click can land before the pending state has rendered.
  const inFlight = useRef(false);
  const noneChosen = !CAPABILITIES.some((capability) => capabilities[capability]);

  const start = useMutation({
    mutationFn: async () => {
      setPhase("saving");
      await client.call("settings.update", { autonomy, capabilities });
      const accounts = await client.call("accounts.list");
      setPhase("reading");
      // The scans run in the background; progress arrives on the Overview.
      const pending = accounts.filter(({ id }) => !started.current.has(id));
      const results = await Promise.allSettled(
        pending.map(async ({ id }) => {
          await client.call("scan.start", { accountId: id });
          started.current.add(id);
        }),
      );
      if (results.some((result) => result.status === "rejected")) throw new Error("scan.start");
    },
    onSettled: () => {
      inFlight.current = false;
      setPhase(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
      await navigate({ to: "/overview" });
    },
  });

  const toggle = (capability: Capability, checked: boolean) =>
    setCapabilities((current) => ({ ...current, [capability]: checked }));

  return (
    <form
      className="flex w-full flex-col gap-8 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        if (inFlight.current || noneChosen) return;
        inFlight.current = true;
        start.mutate();
      }}
    >
      <SpeechBubble pose={phase ?? idlePose}>{t("setup.bubble")}</SpeechBubble>

      <section aria-labelledby="setup-capabilities" className="flex flex-col gap-3">
        <h2 id="setup-capabilities" className={SECTION_TITLE_CLASS}>
          {t("setup.capabilities.heading")}{" "}
          <span className="font-sans text-ui font-normal text-muted-foreground">
            {t("setup.capabilities.hint")}
          </span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((capability) => (
            <CheckboxCard
              key={capability}
              checked={capabilities[capability]}
              onCheckedChange={(checked) => toggle(capability, checked === true)}
              title={t(`setup.capability.${capability}.title`)}
              description={t(`setup.capability.${capability}.description`)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="setup-autonomy" className="flex flex-col gap-3">
        <h2 id="setup-autonomy" className={SECTION_TITLE_CLASS}>
          {t("setup.autonomy.heading")}
        </h2>
        <RadioGroup
          value={autonomy}
          onValueChange={(value) => setAutonomy(value as Choice["autonomy"])}
          aria-labelledby="setup-autonomy"
          className="grid-cols-1 md:grid-cols-3"
        >
          {AUTONOMY_LEVELS.map((level) => (
            <RadioCard
              key={level}
              value={level}
              title={t(`setup.autonomy.${level}.title`)}
              description={t(`setup.autonomy.${level}.description`)}
              badge={level === "suggest" ? t("setup.autonomy.recommended") : undefined}
            />
          ))}
        </RadioGroup>
        {autonomy === "autopilot" ? (
          <p className="text-ui leading-snug text-foreground">
            {t("setup.autonomy.autopilot.reminder", {
              percent: Math.round(AUTOPILOT_CONFIDENCE_THRESHOLD * 100),
            })}
          </p>
        ) : null}
        <p className="flex items-start gap-2 text-ui text-muted-foreground">
          <LockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("setup.invariants")}
        </p>
      </section>

      <div className="flex flex-col items-center gap-3">
        <Button
          type="submit"
          size="lg"
          className="w-full max-w-104"
          disabled={start.isPending || noneChosen}
          aria-describedby={noneChosen ? "setup-none" : undefined}
        >
          {t("setup.start")}
        </Button>
        {noneChosen ? (
          <p id="setup-none" className="text-ui text-muted-foreground">
            {t("setup.capabilities.none")}
          </p>
        ) : null}
        {start.isError ? (
          <p role="alert" className="text-ui text-destructive">
            {t("setup.error")}
          </p>
        ) : null}
      </div>
    </form>
  );
}
