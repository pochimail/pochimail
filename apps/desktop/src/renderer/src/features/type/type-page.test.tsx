// @vitest-environment jsdom
// Guards: the Alert emails type explains itself instead of saying “will appear here”.
import { setLocale } from "@pochimail/ui/i18n/format.ts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { params } = vi.hoisted(() => ({ params: { typeId: "notification" } }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => undefined,
  useParams: () => params,
}));

import { TypePage } from "./type-page.tsx";

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("type page", () => {
  it("explains Alert emails: what belongs there, where the mail stays and what appears after approval", () => {
    params.typeId = "notification";
    render(<TypePage />);
    expect(
      screen.getByText(
        /alert emails from apps and social networks appear here after you approve/iu,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/only label them in your inbox/iu)).toBeTruthy();
  });

  it("keeps the generic copy for other types (guards Alert emails copy leaking everywhere)", () => {
    params.typeId = "personal";
    render(<TypePage />);
    expect(screen.getByText(/already tidy/iu)).toBeTruthy();
  });
});
