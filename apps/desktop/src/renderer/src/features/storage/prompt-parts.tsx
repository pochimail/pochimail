import type { ReactNode } from "react";

/** One "what this choice does" row of the storage prompt: an icon, a short title and a plain sentence. */
export function NoteRow({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3 border-t border-border py-3">
      <span aria-hidden="true" className="flex-none pt-0.5 [&_svg]:size-4">
        {icon}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-body font-semibold">{title}</span>
        <span className="text-ui leading-normal text-muted-foreground">{body}</span>
      </span>
    </li>
  );
}

export const NOTE_LIST_CLASS = "m-0 list-none border-b border-border p-0";

export const TITLE_CLASS =
  "font-display text-title leading-heading font-title tracking-title text-foreground";

/** The part of a form submit event the steps use; spelled out so no generic angle brackets sit in screen markup files. */
export type FormSubmit = { preventDefault: () => void; currentTarget: HTMLFormElement };
