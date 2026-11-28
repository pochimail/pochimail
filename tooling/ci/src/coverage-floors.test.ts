import { readdirSync, readFileSync, statSync } from "node:fs";
import { expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const floors: Record<string, { lines: number; branches?: number }> = JSON.parse(
  readFileSync(new URL("tooling/ci/coverage-floors.json", root), "utf8"),
);

/** Packages whose `src` is measured: everything except the test kit (see vitest.config.ts). */
const measured = ["apps", "packages"].flatMap((kind) =>
  readdirSync(new URL(`${kind}/`, root))
    .filter((name) => `${kind}/${name}` !== "packages/testing")
    .filter((name) =>
      statSync(new URL(`${kind}/${name}/src`, root), { throwIfNoEntry: false })?.isDirectory(),
    )
    .map((name) => `${kind}/${name}/src/**`),
);

// Guards: a new package landing without a floor, so its coverage can fall to zero unnoticed.
it("every measured package has a lines floor", () => {
  expect(Object.keys(floors).sort()).toEqual(measured.sort());
});
