// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createAppRouter } from "./router.tsx";

const parsedSearch = async (url: string) => {
  const router = createAppRouter(
    { getWorkerClient: () => Promise.reject(new Error("unused")) },
    { initialEntries: [url] },
  );
  await router.load();
  return router.state.matches[0]?.search;
};

describe("Review URL search validation", () => {
  // Guards: a bogus bookmarked Review target surviving parse and looking like a real one.
  it("drops an unknown review value and keeps the account", async () => {
    expect(await parsedSearch("/overview?account=a1&review=bogus")).toEqual({
      account: "a1",
      review: undefined,
    });
  });

  it.each(["waiting", "deadlines", "important", "delete", "archive", "unsubscribe"] as const)(
    "keeps the valid review target %s",
    async (review) => {
      expect(await parsedSearch(`/overview?review=${review}`)).toEqual({ review });
    },
  );
});
