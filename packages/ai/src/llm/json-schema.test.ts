import { describe, expect, it } from "vitest";
import { z } from "zod";
import { carryJsonSchema, toJsonSchema } from "./json-schema.ts";

const schema = z.object({ category: z.enum(["people", "records"]), note: z.string().nullable() });

describe("json schema", () => {
  // Guards: decoding constrained to a different shape than the one the caller parses with.
  it("is not changed by crossing the process boundary", () => {
    const sent = toJsonSchema(schema);
    expect(toJsonSchema(carryJsonSchema(JSON.parse(JSON.stringify(sent))))).toEqual(sent);
    expect(sent).not.toHaveProperty("$schema");
  });

  // Guards: the host rejecting a valid answer, or taking a missing one for a value.
  it("accepts any JSON value on the carrying side and nothing when there is none", () => {
    const carried = carryJsonSchema(toJsonSchema(schema));
    expect(carried.safeParse({ anything: [1, null] }).success).toBe(true);
    expect(carried.safeParse(undefined).success).toBe(false);
  });
});
