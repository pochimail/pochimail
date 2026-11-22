import type { ReactElement } from "react";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

// Renders the real onboarding layout and pages against a fake worker, starting on Welcome.
const fakeWorker = () => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: false }),
      "device.name": () => "Mac" as const,
      "accounts.list": () => [],
      "settings.get": () => ({
        autonomy: "suggest" as const,
        capabilities: {
          "catch-what-matters": true,
          declutter: true,
          organize: true,
          "save-documents": true,
        },
        notifications: true,
      }),
      "settings.update": () => undefined,
    },
    subscriptions: { "app.events": () => undefined, "scan.progress": () => undefined },
  });
  return createRpcClient(fromDomPort(port1));
};

const waitFor = async <T,>(read: () => T | null): Promise<T> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Welcome did not render");
};

const Onboarding = ({ path }: { path: string }) => {
  const client = fakeWorker();
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: [path] },
  );
  return <App workerClient={client} router={router} />;
};

const darkFullscreen = (Story: () => ReactElement) => (
  <div className="dark min-h-screen w-full bg-background text-foreground">
    <Story />
  </div>
);

const round = (value: number) => Math.round(value * 10) / 10;

// The breakpoint is a container query on the frame, not the window; the description fills the
// rendered content box until its 480px max. Deriving both keeps any phone width valid.
const welcomeMetrics = (canvas: HTMLElement) => {
  const mainElement = canvas.querySelector("main");
  const frame = mainElement?.parentElement ?? canvas;
  const frameWidth = frame.getBoundingClientRect().width;
  if (!mainElement) return { phone: frameWidth < 560, descriptionWidth: 0 };
  const style = getComputedStyle(mainElement);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const contentWidth = mainElement.getBoundingClientRect().width - padding;
  return { phone: frameWidth < 560, descriptionWidth: Math.min(480, round(contentWidth)) };
};

/**
 * Guards Welcome against docs/design/screens/html/Main.html (identical geometry in DarkWelcome.html and,
 * with the display step at 32px, PhoneWelcome.html). Runs in a real browser so Tailwind's computed
 * measurements are authoritative. Only viewport-independent gaps/sizes are checked: the reference HTML
 * draws its own 24px window frame, which the real app leaves to Electron.
 */
const assertWelcomeGeometry = (canvas: HTMLElement) => {
  const box = (selector: string) => {
    const element = canvas.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      width: round(rect.width),
      height: round(rect.height),
      top: round(rect.top),
      bottom: round(rect.bottom),
    };
  };
  const css = (selector: string, property: string) => {
    const element = canvas.querySelector(selector);
    return element ? getComputedStyle(element).getPropertyValue(property).trim() : "";
  };
  const px = (selector: string, property: string) => parseFloat(css(selector, property)) || 0;
  const check = (
    label: string,
    actual: string | number | boolean | null | undefined,
    expected: string | number | boolean,
    tolerance = 0,
  ) => {
    const matches =
      typeof actual === "number" && typeof expected === "number"
        ? Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
        : String(actual) === String(expected);
    if (!matches) throw new Error(`Welcome ${label}: ${String(actual)} != ${String(expected)}`);
  };

  const { phone, descriptionWidth } = welcomeMetrics(canvas);
  const mascot = box("[data-slot=mascot]");
  const heading = box("h1");
  const description = box("h1 + p");
  const button = box("a[href='/connect']");
  const footer = box("a[href='/connect'] + p");
  const header = box("header");
  const step = box("[aria-current=step]");

  check("headline size", px("h1", "font-size"), phone ? 32 : 40);
  check("headline leading", px("h1", "line-height"), phone ? 35.2 : 44);
  check("mascot width", mascot?.width, 240, 1);
  check("mascot height", mascot?.height, 204, 1);
  check("description width", description?.width, descriptionWidth, 1);
  check("description leading", px("h1 + p", "line-height"), 24.8);
  check("mascot/title gap", heading && mascot ? round(heading.top - mascot.bottom) : null, 18, 1);
  check(
    "title/description gap",
    description && heading ? round(description.top - heading.bottom) : null,
    18,
    1,
  );
  check(
    "description/button gap",
    button && description ? round(button.top - description.bottom) : null,
    24,
    1,
  );
  check("button/footer gap", footer && button ? round(footer.top - button.bottom) : null, 12, 1);
  check("button width", button?.width, 260, 1);
  check("button height", button?.height, 44, 1);
  check("button radius", px("a[href='/connect']", "border-top-left-radius"), 12);
  check("footer size", px("a[href='/connect'] + p", "font-size"), 13);
  check("footer leading", px("a[href='/connect'] + p", "line-height"), 16);
  check("header height", header?.height, 44, 1);
  check("step width", step?.width, 20, 1);
  check("step height", step?.height, 6, 1);
  check("step offset in header", step && header ? round(step.top - header.top) : null, 19, 1);
  check("content top padding", px("main", "padding-top"), phone ? 8 : 16);
  check("content bottom padding", px("main", "padding-bottom"), phone ? 24 : 48);
  check("content gap", px("main", "row-gap"), 18);

  check("breathing loop", css("[data-slot=mascot-breathe]", "animation-name"), "pochi-breathe");
  const wholeImageBlink = [...canvas.querySelectorAll("[data-slot=mascot] *")].some(
    (element) => getComputedStyle(element).animationName === "pochi-blink",
  );
  check("whole-image blink", wholeImageBlink, false);
  check("title radius", px("h1", "border-top-left-radius"), 0);
  canvas.dataset.welcomeGeometryGuard = "passed";
};

/**
 * Chrome only matches :focus-visible after a trusted key event, which a Storybook play function cannot
 * synthesize. Checking the stylesheet as well lets a restored focus-visible ring rule fail the guard.
 */
const focusVisibleH1Rule = () => {
  const selectors: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSGroupingRule) walk(rule.cssRules);
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText.includes(":focus-visible") &&
        /\bh1\b/.test(rule.selectorText)
      ) {
        selectors.push(rule.selectorText);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Cross-origin sheets cannot affect the app's h1 and are irrelevant to this guard.
    }
  }
  return selectors[0] ?? null;
};

export default { title: "Screens/Onboarding", parameters: { layout: "fullscreen" } };

export const Welcome = {
  render: () => <Onboarding path="/welcome" />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const heading = await waitFor(() => canvasElement.querySelector("h1"));
    assertWelcomeGeometry(canvasElement);

    const addedTabindex = !heading.hasAttribute("tabindex");
    if (addedTabindex) heading.setAttribute("tabindex", "-1");
    heading.focus();
    try {
      if (document.activeElement !== heading) {
        throw new Error("Welcome title ring: h1 did not take focus");
      }
      const boxShadow = getComputedStyle(heading).boxShadow;
      if (boxShadow !== "none") throw new Error(`Welcome title ring while focused: ${boxShadow}`);
      const focusRule = focusVisibleH1Rule();
      if (focusRule) throw new Error(`Welcome title focus-visible rule: ${focusRule}`);
    } finally {
      heading.blur();
      if (addedTabindex) heading.removeAttribute("tabindex");
    }
  },
};

export const WelcomeDark = {
  ...Welcome,
  decorators: [darkFullscreen],
};

export const Connect = { render: () => <Onboarding path="/connect" /> };
export const Setup = { render: () => <Onboarding path="/setup" /> };
export const Settings = { render: () => <Onboarding path="/settings" /> };
