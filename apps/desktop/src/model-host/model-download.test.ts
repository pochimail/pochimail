import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestSchema } from "@pochimail/ai/manifest";
import { createModelStore } from "@pochimail/ai/model-store";
import { egressPolicy } from "@pochimail/net/egress/allowlist";
import { createModelDownloader } from "@pochimail/net/egress/model-download";
import { createFakeModelServer } from "@pochimail/testing/fake-model-server";
import { describe, expect, it } from "vitest";

describe("model download composition", () => {
  // Guards: the net downloader and the AI store drifting apart, or a redirect to the CDN breaking resume.
  it("downloads through the egress allow-list, across the CDN redirect and a dropped connection", async () => {
    const commit = "d".repeat(40);
    const bytes = Uint8Array.from({ length: 200_000 }, (_unused, at) => (at * 7) % 251);
    const path = `/owner/repo/resolve/${commit}/model.bin`;
    const manifest = manifestSchema.parse({
      models: [
        {
          id: "tiny",
          role: "embedding",
          tiers: ["T0"],
          license: "MIT",
          files: [
            {
              name: "model.bin",
              url: `https://huggingface.co${path}`,
              bytes: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          ],
        },
      ],
    });
    const server = createFakeModelServer({
      files: { [path]: bytes },
      redirectHost: "us.aws.cdn.hf.co",
      cutAfterBytes: [50_000],
    });
    const dir = await mkdtemp(join(tmpdir(), "pochimail-models-"));
    try {
      const store = createModelStore({
        dir,
        manifest,
        transport: createModelDownloader({
          allowlist: egressPolicy.createForModelDownloads(),
          fetch: server.fetch,
        }),
      });
      expect((await store.download("T0")).ok).toBe(true);
      const ready = await store.resolve("T0");
      if (ready.status !== "ready") throw new Error("expected ready");
      const file = ready.models[0]?.files[0]?.path as string;
      expect(
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ).toBe(manifest.models[0]?.files[0]?.sha256);
      expect(server.requests().map((request) => request.host)).toEqual([
        "huggingface.co",
        "us.aws.cdn.hf.co",
        "huggingface.co",
        "us.aws.cdn.hf.co",
      ]);
      expect(server.requests().map((request) => request.rangeStart)).toEqual([
        0, 0, 50_000, 50_000,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
