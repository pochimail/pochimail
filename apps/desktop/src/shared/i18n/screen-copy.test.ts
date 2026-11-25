import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { screenCopyOffenses } from "./screen-copy.ts";

const sandbox = mkdtempSync(join(tmpdir(), "pochimail-screen-copy-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe("no user-facing literals in screen components (M4-07)", () => {
  it("fails a screen component with a hard-coded literal (guards copy drifting out of the catalog)", () => {
    writeFileSync(
      join(sandbox, "hardcoded.tsx"),
      "export const Screen = () => <main><h1>Overview</h1><p>Everything stays here.</p></main>;\n",
    );
    expect(screenCopyOffenses(sandbox)).toEqual([
      { file: "hardcoded.tsx", literal: "Overview" },
      { file: "hardcoded.tsx", literal: "Everything stays here." },
    ]);
  });

  it("accepts catalog-backed screens and ignores code strings (guards false positives)", () => {
    writeFileSync(
      join(sandbox, "catalog.tsx"),
      'import { t } from "@pochimail/ui/i18n/format.ts";\n' +
        'export const Screen = () => <main className="mx-auto"><h1>{t("overview.title")}</h1></main>;\n',
    );
    expect(screenCopyOffenses(sandbox).filter((offense) => offense.file === "catalog.tsx")).toEqual(
      [],
    );

    writeFileSync(
      join(sandbox, "arrow.tsx"),
      "const freed = rows.filter((row) => !row.freesSpace);\n" +
        '  return <main>{t("overview.title")}</main>;\n',
    );
    expect(screenCopyOffenses(sandbox).filter((offense) => offense.file === "arrow.tsx")).toEqual(
      [],
    );
  });

  // Guards: a comparison before JSX looking like the end of a JSX tag and flagging its operands as copy.
  it("ignores bare comparison operators but still finds text inside JSX tags", () => {
    writeFileSync(
      join(sandbox, "comparison.tsx"),
      'const over = count > max ? <p>{t("overview.tooMany")}</p> : null;\n',
    );
    expect(
      screenCopyOffenses(sandbox).filter((offense) => offense.file === "comparison.tsx"),
    ).toEqual([]);

    writeFileSync(
      join(sandbox, "jsx-text.tsx"),
      "const over = count > max ? <p>Too many</p> : null;\n",
    );
    expect(
      screenCopyOffenses(sandbox).filter((offense) => offense.file === "jsx-text.tsx"),
    ).toEqual([{ file: "jsx-text.tsx", literal: "Too many" }]);
  });

  it("keeps every real renderer screen free of hard-coded copy (guards a new screen bypassing t())", () => {
    expect(screenCopyOffenses(resolve(import.meta.dirname, "../../renderer/src"))).toEqual([]);
  });
});
