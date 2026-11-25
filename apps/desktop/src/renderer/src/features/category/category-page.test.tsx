// @vitest-environment jsdom
// Guards: the Alert emails category explains itself instead of saying “will appear here”.
import { setLocale } from "@pochimail/ui/i18n/format.ts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { params } = vi.hoisted(() => ({ params: { categoryId: "notifications" } }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => undefined,
  useParams: () => params,
}));

import { CategoryPage } from "./category-page.tsx";

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("category page", () => {
  it("explains Alert emails: what belongs there, where the mail stays and what appears after approval", () => {
    params.categoryId = "notifications";
    render(<CategoryPage />);
    expect(
      screen.getByText(
        /alert emails from apps and social networks appear here after you approve/iu,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/only label them in your inbox/iu)).toBeTruthy();
  });

  it("keeps the generic copy for other categories (guards Alert emails copy leaking everywhere)", () => {
    params.categoryId = "people";
    render(<CategoryPage />);
    expect(screen.getByText(/already tidy/iu)).toBeTruthy();
  });
});
