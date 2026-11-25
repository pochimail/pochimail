import { DialogDescription, DialogHeader, DialogTitle } from "@pochimail/ui/components/dialog";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { TriangleAlertIcon } from "lucide-react";
import { NOTE_LIST_CLASS, NoteRow, TITLE_CLASS } from "./prompt-parts.tsx";

/** Nothing the person can type fixes this: say what is wrong and what to do, and never offer to start over silently. */
export function BlockedStep() {
  const t = useT();
  return (
    <>
      <DialogHeader>
        <DialogTitle className={TITLE_CLASS}>{t("storage.blocked.title")}</DialogTitle>
        <DialogDescription className="text-body leading-normal">
          {t("storage.blocked.description")}
        </DialogDescription>
      </DialogHeader>
      <ul className={NOTE_LIST_CLASS}>
        <NoteRow
          icon={<TriangleAlertIcon />}
          title={t("storage.blocked.todo.title")}
          body={t("storage.blocked.todo.body")}
        />
      </ul>
    </>
  );
}
