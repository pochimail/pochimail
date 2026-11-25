// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProviderIcon } from "./provider-icon.tsx";

afterEach(cleanup);

it("falls back to a generic mail icon for a provider it has no mark for (guards a wrong brand on a new provider)", () => {
  const { container } = render(<ProviderIcon provider="imap" />);
  const icon = container.querySelector("[data-slot=provider-icon]");
  expect(icon?.getAttribute("data-provider")).toBe("generic");
  expect(icon?.getAttribute("aria-hidden")).toBe("true");
});
