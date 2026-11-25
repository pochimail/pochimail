import { beforeEach, describe, expect, it, vi } from "vitest";

const exposed: [string, Record<string, unknown>][] = [];
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: Record<string, unknown>) => void exposed.push([key, api]),
  },
  ipcRenderer: { once: vi.fn(), on: vi.fn(), invoke: vi.fn(async () => null) },
}));

beforeEach(() => {
  exposed.length = 0;
  vi.resetModules();
});

describe("preload surface", () => {
  // Guards: the page must only ever see these methods; any new key (or a leaked ipcRenderer/Node) widens the attack surface.
  it("exposes one object with exactly the allowed methods and nothing else", async () => {
    await import("./preload.ts");
    expect(exposed).toHaveLength(1);
    const [key, api] = exposed[0] ?? ["", {}];
    expect(key).toBe("pochimail");
    expect(Object.keys(api).sort()).toEqual([
      "chooseFolder",
      "onOpenScreen",
      "openMailAppLink",
      "requestWorkerPort",
      "showInFinder",
      "storage",
    ]);
    for (const [name, value] of Object.entries(api))
      if (name !== "storage") expect(typeof value).toBe("function");
    expect(Object.keys(api.storage as object).sort()).toEqual([
      "setPassphrase",
      "status",
      "storeUnprotected",
      "unlock",
    ]);
    for (const leaked of ["ipcRenderer", "require", "process", "electron", "send", "invoke", "on"])
      expect(api).not.toHaveProperty(leaked);
  });

  // Guards: the keychain-backed store stays in main/worker; no secret API reaches the page (M2-04).
  it("never exposes a secret or keychain procedure", async () => {
    await import("./preload.ts");
    const api = exposed[0]?.[1] ?? {};
    for (const name of [
      "getSecret",
      "setSecret",
      "removeSecret",
      "protection",
      "secretStore",
      "serveSecrets",
    ])
      expect(api).not.toHaveProperty(name);
  });

  // Guards: a hostile page must not get a bad link as far as main; the preload rejects it first.
  it("validates arguments before calling main", async () => {
    await import("./preload.ts");
    const api = exposed[0]?.[1] as { openMailAppLink: (link: string) => Promise<void> };
    expect(() => api.openMailAppLink("https://evil.example")).toThrow();
  });

  // Guards: an empty or NUL-laced path, or a non-string folder reply, reaching the page or main unchecked.
  it("validates showInFinder arguments and the chooseFolder reply", async () => {
    const { ipcRenderer } = await import("electron");
    await import("./preload.ts");
    const api = exposed[0]?.[1] as {
      showInFinder: (path: string) => Promise<void>;
      chooseFolder: () => Promise<string | null>;
    };
    expect(() => api.showInFinder("")).toThrow();
    expect(() => api.showInFinder("a\0b")).toThrow();
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(42);
    await expect(api.chooseFolder()).rejects.toThrow();
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce("/Users/me/Exports");
    await expect(api.chooseFolder()).resolves.toBe("/Users/me/Exports");
  });

  // Guards: a short passphrase reaching main, or an answer carrying anything but a status word back to the page.
  it("validates storage arguments before main and storage answers before the page", async () => {
    const { ipcRenderer } = await import("electron");
    await import("./preload.ts");
    const api = exposed[0]?.[1] as {
      storage: {
        setPassphrase: (value: string) => Promise<string>;
        unlock: (value: string) => Promise<string>;
        status: () => Promise<string>;
      };
    };
    const { storage } = api;
    vi.mocked(ipcRenderer.invoke).mockClear();
    await expect(storage.setPassphrase("elevenchars")).rejects.toThrow();
    await expect(storage.unlock("x".repeat(257))).rejects.toThrow();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce("0123456789abcdef");
    await expect(storage.status()).rejects.toThrow();
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce("ready");
    await expect(storage.setPassphrase("twelve chars")).resolves.toBe("ready");
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce("wrong-passphrase");
    await expect(storage.unlock("short")).resolves.toBe("wrong-passphrase");
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce("blocked");
    await expect(storage.status()).resolves.toBe("blocked");
  });

  // Guards: a notification click reaching the page with anything but a screen name, or being lost before the page subscribes.
  it("hands the page only a known screen, including one that arrived before it subscribed", async () => {
    const { ipcRenderer } = await import("electron");
    await import("./preload.ts");
    const api = exposed[0]?.[1] as { onOpenScreen: (l: (screen: string) => void) => () => void };
    const deliver = vi
      .mocked(ipcRenderer.on)
      .mock.calls.find(([channel]) => channel === "notifications:open-screen")?.[1] as (
      event: unknown,
      screen: unknown,
    ) => void;
    const seen: string[] = [];

    deliver({}, "review");
    deliver({}, "https://evil.example");
    const stop = api.onOpenScreen((screen) => void seen.push(screen));
    deliver({}, "overview");
    deliver({}, { screen: "overview" });
    stop();
    deliver({}, "review");

    expect(seen).toEqual(["review", "overview"]);
  });
});
