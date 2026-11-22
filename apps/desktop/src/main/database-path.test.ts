// Guards: the dev database path drifting with the process environment or between launches.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { databasePathFor } from "./database-path.ts";

describe("database path resolution", () => {
  it("is one file under the given user's app data on every call", () => {
    const userData = join("/", "Users", "me", "Library", "Application Support", "pochimail");
    expect(databasePathFor(userData)).toBe(join(userData, "pochimail.db"));
    expect(databasePathFor(userData)).toBe(databasePathFor(userData));
    expect(databasePathFor(join(userData, "other"))).not.toBe(databasePathFor(userData));
  });
});
