import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { NotifyMessage } from "../shared/notifications.ts";
import {
  COALESCE_WINDOW_MS,
  DAILY_CAP,
  type ShownNotification,
  showWorkerNotifications,
} from "./worker-notifications.ts";

const setup = () => {
  const os = { supported: true };
  const worker = new EventEmitter();
  const shown: { title: string; body: string; click: () => void }[] = [];
  let now = 1_000_000;
  const open = vi.fn();
  showWorkerNotifications({
    worker,
    create: (content) => {
      if (!os.supported) return undefined;
      const entry = { ...content, click: () => {} };
      const notification: ShownNotification = {
        on: (_event, listener) => {
          entry.click = listener;
        },
        show: () => void shown.push(entry),
      };
      return notification;
    },
    now: () => now,
    osLocale: "en",
    open,
  });
  const send = (message: unknown) => worker.emit("message", message);
  const notify = (kind: NotifyMessage["kind"], count = 3, locale: NotifyMessage["locale"] = null) =>
    send({ type: "notify", kind, count, locale });
  return {
    os,
    shown,
    open,
    send,
    notify,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

describe("showWorkerNotifications", () => {
  it("shows a count and no content, in the saved language (guards names or subjects in a notification, or the wrong language)", () => {
    const { shown, notify } = setup();

    notify("scan-complete", 120);
    notify("digest-ready", 3, "fr");

    expect(shown.map(({ title, body }) => [title, body])).toEqual([
      ["Sorting finished", "120 emails sorted"],
      ["Votre résumé est prêt", "3 éléments à voir"],
    ]);
  });

  it("opens the matching screen when clicked (guards a click that does nothing)", () => {
    const { shown, open, notify } = setup();

    notify("scan-complete");
    notify("digest-ready");
    shown[0]?.click();
    shown[1]?.click();

    expect(open.mock.calls).toEqual([["overview"], ["review"]]);
  });

  it("shows one notification per kind per window (guards a notification storm from repeated events)", () => {
    const { shown, notify, advance } = setup();

    notify("scan-complete");
    notify("scan-complete");
    notify("digest-ready");
    advance(COALESCE_WINDOW_MS);
    notify("scan-complete");

    expect(shown).toHaveLength(3);
  });

  it("stops at the daily cap and starts again a day later (guards unbounded notifications)", () => {
    const { shown, notify, advance } = setup();
    const kinds = ["scan-complete", "digest-ready", "review-waiting"] as const;

    for (let i = 0; i < DAILY_CAP + 5; i++) {
      notify(kinds[i % 3] ?? "scan-complete");
      advance(COALESCE_WINDOW_MS);
    }
    expect(shown).toHaveLength(DAILY_CAP);

    advance(24 * 60 * 60_000);
    notify("scan-complete");
    expect(shown).toHaveLength(DAILY_CAP + 1);
  });

  it("drops a message that is not a valid notification (guards a compromised worker or a bug showing arbitrary text)", () => {
    const { shown, send } = setup();

    send(undefined);
    send({ type: "notify", kind: "scan-complete", count: -1, locale: null });
    send({ type: "notify", kind: "free-text", count: 1, locale: null });
    send({ type: "notify", kind: "scan-complete", count: 1, locale: "de" });
    send({ type: "other", kind: "scan-complete", count: 1, locale: null });

    expect(shown).toEqual([]);
  });

  it("does not count a notification the OS could not show (guards a silent OS using up the window)", () => {
    const { os, shown, notify } = setup();

    os.supported = false;
    notify("scan-complete");
    os.supported = true;
    notify("scan-complete");

    expect(shown).toHaveLength(1);
  });
});
