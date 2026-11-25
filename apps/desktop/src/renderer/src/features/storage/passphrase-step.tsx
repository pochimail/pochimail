import { Button } from "@pochimail/ui/components/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@pochimail/ui/components/dialog";
import { TextField } from "@pochimail/ui/components/text-field";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { LockIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PASSPHRASE_MIN_LENGTH } from "#shared/storage-calls.ts";
import { type FormSubmit, NOTE_LIST_CLASS, NoteRow, TITLE_CLASS } from "./prompt-parts.tsx";
import type { StorageApi } from "./storage-api.ts";

type Problem = "tooShort" | "mismatch" | "failed";

/**
 * Passphrase first. The two inputs are uncontrolled: the passphrase is read once at submit, handed to main, and the form
 * is cleared before the answer arrives, so it never sits in React state.
 */
export function PassphraseStep({
  storage,
  onReady,
  onDeclineProtection,
}: {
  storage: StorageApi;
  onReady: () => void;
  onDeclineProtection: () => void;
}) {
  const t = useT();
  const [problem, setProblem] = useState(undefined as Problem | undefined);
  const [pending, setPending] = useState(false);
  const passphraseField = useRef(null as HTMLInputElement | null);
  const repeatField = useRef(null as HTMLInputElement | null);
  useEffect(() => passphraseField.current?.focus(), []);

  const refuse = (next: Problem, field: typeof passphraseField) => {
    setProblem(next);
    field.current?.focus();
  };
  const submit = async (event: FormSubmit) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const passphrase = String(data.get("passphrase"));
    if (passphrase.length < PASSPHRASE_MIN_LENGTH) return refuse("tooShort", passphraseField);
    if (passphrase !== String(data.get("repeat"))) return refuse("mismatch", repeatField);
    setProblem(undefined);
    setPending(true);
    const answer = storage.setPassphrase(passphrase).catch(() => "failed" as const);
    form.reset();
    const outcome = await answer;
    setPending(false);
    if (outcome === "ready") onReady();
    else refuse("failed", passphraseField);
  };
  return (
    <form onSubmit={submit} aria-busy={pending} className="contents">
      <DialogHeader>
        <DialogTitle className={TITLE_CLASS}>{t("storage.passphrase.title")}</DialogTitle>
        <DialogDescription className="text-body leading-normal">
          {t("storage.passphrase.description")}
        </DialogDescription>
      </DialogHeader>
      <TextField
        label={t("storage.passphrase.label")}
        ref={passphraseField}
        name="passphrase"
        type="password"
        autoComplete="new-password"
        error={
          problem === "tooShort"
            ? t("storage.passphrase.tooShort", { count: PASSPHRASE_MIN_LENGTH })
            : undefined
        }
      />
      <TextField
        label={t("storage.passphrase.repeat")}
        ref={repeatField}
        name="repeat"
        type="password"
        autoComplete="new-password"
        error={problem === "mismatch" ? t("storage.passphrase.mismatch") : undefined}
      />
      {problem === "failed" ? (
        <p role="alert" className="text-caption font-medium">
          {t("storage.failed")}
        </p>
      ) : null}
      <ul className={NOTE_LIST_CLASS}>
        <NoteRow
          icon={<LockIcon />}
          title={t("storage.passphrase.protects.title")}
          body={t("storage.passphrase.protects.body")}
        />
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" aria-disabled={pending}>
          {t(pending ? "storage.passphrase.pending" : "storage.passphrase.submit")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="text-muted-foreground"
          aria-disabled={pending}
          onClick={() => !pending && onDeclineProtection()}
        >
          {t("storage.unprotected.choose")}
        </Button>
      </div>
    </form>
  );
}
