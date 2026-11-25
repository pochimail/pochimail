// @vitest-environment jsdom
// Guards: a storage prompt that stores without protection on the first click, keeps the passphrase in the page after it
// was sent, shows up where nothing needs asking, or can be dismissed so the app starts without an answer.

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
  status: StorageStatus,
  outcomes: Partial<Record<keyof StorageApi, StorageOutcome>> = {},
) => {
  const storage = {
    status: vi.fn(async () => status),
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

describe("storage prompt", () => {
  // Guards: the prompt appearing when the OS keychain already protects the key.
  it("renders nothing when there is nothing to ask", async () => {
    const storage = fakeStorage("ready");
    await waitFor(() => expect(storage.status).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
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

  it("asks for at least eight characters", async () => {
    const storage = fakeStorage("choose");
    await type("Passphrase", "short");
    await type("Repeat the passphrase", "short");
    await userEvent.click(button("Use this passphrase"));
    expect(await screen.findByText("Use at least 8 characters.")).toBeTruthy();
    expect(storage.setPassphrase).not.toHaveBeenCalled();
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
    expect(await screen.findByText("That passphrase doesn’t match.")).toBeTruthy();
    expect((screen.getByLabelText("Passphrase") as HTMLInputElement).value).toBe("");
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
