// @vitest-environment jsdom
// Guards: a storage prompt that stores without protection on the first click, keeps the passphrase in the page after it
// was sent, shows up where nothing needs asking, can be dismissed so the app starts without an answer, leaves a blank
// window when the key cannot be produced, or loses keyboard focus on errors, step changes and while it works.

import { I18nProvider } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageOutcome, StorageStatus } from "#shared/storage-calls.ts";
import type { StorageApi } from "./storage-api.ts";
import { StoragePrompt } from "./storage-prompt.tsx";

afterEach(cleanup);

const PASSPHRASE = "correct horse battery";

const fakeStorage = (
  status: StorageStatus | Error,
  outcomes: Partial<Record<keyof StorageApi, StorageOutcome>> = {},
) => {
  const storage = {
    status: vi.fn(async () => {
      if (status instanceof Error) throw status;
      return status;
    }),
    setPassphrase: vi.fn(async (_: string) => outcomes.setPassphrase ?? "ready"),
    storeUnprotected: vi.fn(async () => outcomes.storeUnprotected ?? "ready"),
    unlock: vi.fn(async (_: string) => outcomes.unlock ?? "ready"),
  } satisfies StorageApi;
  render(
    <I18nProvider locale="en">
      <StoragePrompt storage={storage} />
    </I18nProvider>,
  );
  return storage;
};
const type = async (label: string, value: string) =>
  userEvent.type(await screen.findByLabelText(label), value);
const button = (name: string) => screen.getByRole("button", { name });
const focused = () => document.activeElement;
const field = (label: string) => screen.getByLabelText(label);

describe("storage prompt", () => {
  // Guards: the prompt appearing when the OS keychain already protects the key.
  it("renders nothing when there is nothing to ask", async () => {
    const storage = fakeStorage("ready");
    await waitFor(() => expect(storage.status).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Guards: a blank window, or a prompt asking something nobody can answer, when the key cannot be produced.
  it.each([
    ["main reports the key cannot be produced", "blocked" as const],
    ["main cannot be asked at all", new Error("ipc failed")],
  ])("explains what to do when %s", async (_, status) => {
    const storage = fakeStorage(status);
    expect(await screen.findByText("I can’t open your local data")).toBeTruthy();
    expect(screen.getByText(/put back the files you backed up/)).toBeTruthy();
    expect(screen.queryByLabelText("Passphrase")).toBeNull();
    expect(screen.queryByRole("button", { name: "Store without protection" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(storage.setPassphrase).not.toHaveBeenCalled();
  });

  // Guards: a passphrase sent without confirmation, too short, or kept in the inputs after it was handed to main.
  it("checks the two passphrases, sends one, and clears the inputs before the answer", async () => {
    const storage = fakeStorage("choose");
    await type("Passphrase", PASSPHRASE);
    await type("Repeat the passphrase", "something else");
    await userEvent.click(button("Use this passphrase"));
    expect(await screen.findByText("The two passphrases don’t match.")).toBeTruthy();
    expect(storage.setPassphrase).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Repeat the passphrase"));
    await userEvent.type(screen.getByLabelText("Repeat the passphrase"), PASSPHRASE);
    let answer: (outcome: StorageOutcome) => void = () => {};
    storage.setPassphrase.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    await userEvent.click(button("Use this passphrase"));
    expect(storage.setPassphrase).toHaveBeenCalledWith(PASSPHRASE);
    for (const label of ["Passphrase", "Repeat the passphrase"])
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    answer("ready");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks for at least twelve characters and puts the cursor back in the field", async () => {
    const storage = fakeStorage("choose");
    await type("Passphrase", "elevenchars");
    await type("Repeat the passphrase", "elevenchars");
    await userEvent.click(button("Use this passphrase"));
    expect(
      await screen.findByText("Use at least 12 characters. A short sentence works well."),
    ).toBeTruthy();
    expect(storage.setPassphrase).not.toHaveBeenCalled();
    expect(focused()).toBe(field("Passphrase"));
  });

  // Guards: keyboard users losing their place: focus dropping to the page after an error, a step change or a submit.
  it("moves focus to the field that needs attention and keeps it on the button while working", async () => {
    const storage = fakeStorage("choose");
    await screen.findByLabelText("Passphrase");
    expect(focused()).toBe(field("Passphrase"));
    await type("Passphrase", PASSPHRASE);
    await type("Repeat the passphrase", "something else");
    await userEvent.click(button("Use this passphrase"));
    expect(focused()).toBe(field("Repeat the passphrase"));

    await userEvent.click(button("Store without protection"));
    expect(focused()).toBe(button("Use a passphrase"));
    await userEvent.click(button("Use a passphrase"));
    expect(focused()).toBe(field("Passphrase"));

    await type("Passphrase", PASSPHRASE);
    await type("Repeat the passphrase", PASSPHRASE);
    let answer: (outcome: StorageOutcome) => void = () => {};
    storage.setPassphrase.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const submit = button("Use this passphrase");
    submit.focus();
    await userEvent.keyboard("{Enter}");
    const working = screen.getByRole("button", { name: "Locking your data…" });
    expect(working).toBe(submit);
    expect(working.getAttribute("aria-disabled")).toBe("true");
    expect(working.hasAttribute("disabled")).toBe(false);
    expect(focused()).toBe(working);
    expect(working.closest("form")?.getAttribute("aria-busy")).toBe("true");
    await userEvent.click(working);
    expect(storage.setPassphrase).toHaveBeenCalledTimes(1);
    answer("failed");
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was changed");
    expect(focused()).toBe(field("Passphrase"));
  });

  // Guards: "store without protection" being one click away from the first screen, or a failed save looking like success.
  it("stores without protection only after a second, explicit confirmation", async () => {
    const storage = fakeStorage("choose");
    await userEvent.click(await screen.findByRole("button", { name: "Store without protection" }));
    expect(await screen.findByText("Store without protection?")).toBeTruthy();
    expect(storage.storeUnprotected).not.toHaveBeenCalled();
    await userEvent.click(button("Use a passphrase"));
    expect(await screen.findByText("Lock your local data")).toBeTruthy();
    await userEvent.click(button("Store without protection"));
    await userEvent.click(await screen.findByRole("button", { name: "Store without protection" }));
    expect(storage.storeUnprotected).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the prompt open and says so when saving fails", async () => {
    fakeStorage("choose", { setPassphrase: "failed" });
    await type("Passphrase", PASSPHRASE);
    await type("Repeat the passphrase", PASSPHRASE);
    await userEvent.click(button("Use this passphrase"));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was changed");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  // Guards: a wrong passphrase letting the app start, or the dialog being dismissed with Escape.
  it("unlocks with the right passphrase only and cannot be dismissed", async () => {
    const storage = fakeStorage("locked", { unlock: "wrong-passphrase" });
    await type("Passphrase", "not the one");
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("That isn’t the right passphrase.")).toBeTruthy();
    expect((screen.getByLabelText("Passphrase") as HTMLInputElement).value).toBe("");
    expect(focused()).toBe(field("Passphrase"));
    expect(field("Passphrase").getAttribute("aria-describedby")?.split(" ")).toHaveLength(2); // the error and the hint
    expect(
      document.getElementById(
        field("Passphrase").getAttribute("aria-describedby")?.split(" ")[1] ?? "",
      )?.textContent,
    ).toBe("I can’t recover a lost passphrase.");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    storage.unlock.mockResolvedValueOnce("ready");
    await userEvent.clear(screen.getByLabelText("Passphrase")); // user-event remembers what it typed before the reset
    await type("Passphrase", PASSPHRASE);
    await userEvent.click(button("Unlock"));
    expect(storage.unlock).toHaveBeenLastCalledWith(PASSPHRASE);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
