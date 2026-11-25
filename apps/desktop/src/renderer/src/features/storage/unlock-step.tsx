import { Button } from "@pochimail/ui/components/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@pochimail/ui/components/dialog";
import { TextField } from "@pochimail/ui/components/text-field";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { LockIcon } from "lucide-react";
import { useState } from "react";
import { type FormSubmit, TITLE_CLASS } from "./prompt-parts.tsx";
import type { StorageApi } from "./storage-api.ts";

/** Later launches: one field. The input is uncontrolled and cleared as soon as the passphrase is sent. */
export function UnlockStep({ storage, onReady }: { storage: StorageApi; onReady: () => void }) {
  const t = useT();
  const [problem, setProblem] = useState<"storage.unlock.wrong" | "storage.failed">();
  const [pending, setPending] = useState(false);

  const submit = async (event: FormSubmit) => {
    event.preventDefault();
    const form = event.currentTarget;
    const passphrase = String(new FormData(form).get("passphrase"));
    setProblem(undefined);
    setPending(true);
    const answer = storage.unlock(passphrase).catch(() => "failed" as const);
    form.reset();
    const outcome = await answer;
    setPending(false);
    if (outcome === "ready") onReady();
    else setProblem(outcome === "wrong-passphrase" ? "storage.unlock.wrong" : "storage.failed");
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle className={TITLE_CLASS}>{t("storage.unlock.title")}</DialogTitle>
        <DialogDescription className="text-body leading-normal">
          {t("storage.unlock.description")}
        </DialogDescription>
      </DialogHeader>
      <TextField
        label={t("storage.passphrase.label")}
        name="passphrase"
        type="password"
        autoComplete="current-password"
        maxLength={256}
        error={problem === undefined ? undefined : t(problem)}
      />
      <p className="m-0 flex items-center gap-2 text-caption text-muted-foreground">
        <LockIcon aria-hidden="true" className="size-4" />
        {t("storage.unlock.hint")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {t("storage.unlock.submit")}
        </Button>
      </div>
    </form>
  );
}
