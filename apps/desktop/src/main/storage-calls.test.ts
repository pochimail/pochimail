import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@pochimail/logger/logger";
import { describe, expect, it } from "vitest";
import { storageChannels } from "../shared/storage-calls.ts";
import { basicTextVault } from "../test-support/fake-key-vault.ts";
import { registerStorageCalls } from "./storage-calls.ts";
import { createStorageGate } from "./storage-gate.ts";

const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "pochimail-calls-"));
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  registerStorageCalls({
    ipc: { handle: (channel, listener) => void handlers.set(channel, listener as never) },
    gate: createStorageGate({
      vault: basicTextVault(),
      platform: "linux",
      directory,
      databaseFile: join(directory, "pochimail.db"),
      logger: createLogger({ sink: { write: () => {} } }),
    }),
    isAppUrl: (url) => url.startsWith("file:///app/"),
  });
  const call = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)?.({ senderFrame: { url: "file:///app/index.html" } } as never, ...args);
  return { handlers, call };
};

describe("storage calls", () => {
  // Guards: an extra main channel that could return key material, or a missing one the prompt needs.
  it("registers exactly the four storage channels", () => {
    expect([...setup().handlers.keys()].sort()).toEqual(Object.values(storageChannels).sort());
  });

  // Guards: an injected frame or navigated window answering the prompt on the person's behalf.
  it("refuses calls from a sender that is not the app page", () => {
    const { handlers } = setup();
    const stranger = { senderFrame: { url: "https://evil.example/" } } as never;
    for (const channel of Object.values(storageChannels))
      expect(() => handlers.get(channel)?.(stranger, "a passphrase")).toThrow("unknown sender");
  });

  // Guards: an answer that carries the passphrase or the key back to the page instead of a status word.
  it("answers with status words only", async () => {
    const { call } = setup();
    expect(await call(storageChannels.status)).toBe("choose");
    expect(await call(storageChannels.setPassphrase, "correct horse battery")).toBe("ready");
    expect(await call(storageChannels.status)).toBe("ready");
  });
});
