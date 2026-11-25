import { Button } from "@pochimail/ui/components/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@pochimail/ui/components/dialog";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { KeyRoundIcon, MailIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NOTE_LIST_CLASS, NoteRow, TITLE_CLASS } from "./prompt-parts.tsx";
import type { StorageApi } from "./storage-api.ts";

/** The second, explicit choice: what stays open and what is not affected, then "Store without protection" or back to a passphrase. */
export function UnprotectedStep({
  storage,
  onReady,
  onUsePassphrase,
}: {
  storage: StorageApi;
  onReady: () => void;
  onUsePassphrase: () => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const firstButton = useRef(null as HTMLButtonElement | null);
  useEffect(() => firstButton.current?.focus(), []);

  const store = async () => {
    if (pending) return;
    setPending(true);
    const outcome = await storage.storeUnprotected().catch(() => "failed" as const);
    setPending(false);
    if (outcome === "ready") onReady();
    else setFailed(true);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className={TITLE_CLASS}>{t("storage.unprotected.title")}</DialogTitle>
        <DialogDescription className="text-body leading-normal">
          {t("storage.unprotected.description")}
        </DialogDescription>
      </DialogHeader>
      <ul className={NOTE_LIST_CLASS}>
        <NoteRow
          icon={<KeyRoundIcon />}
          title={t("storage.unprotected.open.title")}
          body={t("storage.unprotected.open.body")}
        />
        <NoteRow
          icon={<MailIcon />}
          title={t("storage.unprotected.safe.title")}
          body={t("storage.unprotected.safe.body")}
        />
      </ul>
      {failed ? (
        <p role="alert" className="text-caption font-medium">
          {t("storage.failed")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={firstButton}
          size="lg"
          aria-disabled={pending}
          onClick={() => !pending && onUsePassphrase()}
        >
          {t("storage.unprotected.usePassphrase")}
        </Button>
        <Button variant="secondary" size="lg" aria-disabled={pending} onClick={store}>
          {t("storage.unprotected.choose")}
        </Button>
      </div>
    </>
  );
}
