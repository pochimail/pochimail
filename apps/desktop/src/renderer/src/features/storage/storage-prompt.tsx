import { Dialog, DialogContent } from "@pochimail/ui/components/dialog";
import { useEffect, useState } from "react";
import type { StorageStatus } from "#shared/storage-calls.ts";
import { BlockedStep } from "./blocked-step.tsx";
import { PassphraseStep } from "./passphrase-step.tsx";
import type { StorageApi } from "./storage-api.ts";
import { UnlockStep } from "./unlock-step.tsx";
import { UnprotectedStep } from "./unprotected-step.tsx";

type Step = "loading" | "ready" | "passphrase" | "unprotected" | "unlock" | "blocked";
const STEP_FOR_STATUS: Record<StorageStatus, Step> = {
  ready: "ready",
  choose: "passphrase",
  locked: "unlock",
  blocked: "blocked",
};

/**
 * Asks main how the local data is protected before the app is usable (ADR 0005): a passphrase first, "store without
 * protection" only as a second, explicit choice, and the passphrase again on later launches. It cannot be dismissed:
 * the worker does not start until the question is answered. When the key cannot be produced, or main cannot even be
 * asked, it says so instead of leaving a blank window. With nothing to ask it renders nothing.
 */
export function StoragePrompt({ storage }: { storage: StorageApi }) {
  const [step, setStep] = useState<Step>("loading");

  useEffect(() => {
    let current = true;
    storage
      .status()
      .then((status) => {
        if (current) setStep(STEP_FOR_STATUS[status]);
      })
      .catch(() => current && setStep("blocked"));
    return () => {
      current = false;
    };
  }, [storage]);

  if (step === "loading" || step === "ready") return null;
  const ready = () => setStep("ready");
  return (
    <Dialog open>
      <DialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="top-16 flex translate-y-0 flex-col gap-5 px-8 pt-7 pb-6 shadow-lg sm:max-w-120"
      >
        {step === "passphrase" ? (
          <PassphraseStep
            storage={storage}
            onReady={ready}
            onDeclineProtection={() => setStep("unprotected")}
          />
        ) : null}
        {step === "unprotected" ? (
          <UnprotectedStep
            storage={storage}
            onReady={ready}
            onUsePassphrase={() => setStep("passphrase")}
          />
        ) : null}
        {step === "unlock" ? <UnlockStep storage={storage} onReady={ready} /> : null}
        {step === "blocked" ? <BlockedStep /> : null}
      </DialogContent>
    </Dialog>
  );
}
