import type { MascotPose } from "@pochimail/ui/components/mascot";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import type { RpcClient } from "#shared/ipc/client.ts";
import { ActivityPage } from "./features/activity/activity-page.tsx";
import { CategoryPage } from "./features/category/category-page.tsx";
import { ConnectPage } from "./features/connect/connect-page.tsx";
import { DocumentsPage } from "./features/documents/documents-page.tsx";
import { OnboardingLayout } from "./features/onboarding/onboarding-layout.tsx";
import type { ReviewTarget } from "./features/overview/overview-figures.ts";
import { OverviewPage } from "./features/overview/overview-page.tsx";
import { useAppearance } from "./features/settings/appearance.tsx";
import { AppearanceControls } from "./features/settings/appearance-controls.tsx";
import { SettingsPage } from "./features/settings/settings-page.tsx";
import { SetupPage } from "./features/setup/setup-page.tsx";
import { AppFrame } from "./features/shell/app-frame.tsx";
import { WelcomePage } from "./features/welcome/welcome-page.tsx";
import { ScanStatusProvider } from "./lib/scan-status.tsx";

export type RouterContext = {
  getWorkerClient(): Promise<RpcClient>;
};

/** Pochi's resting pose follows the theme on screen (System resolved against the OS); active poses are chosen by the screen. */
function useIdlePose(): MascotPose {
  const { resolvedTheme } = useAppearance();
  return resolvedTheme === "dark" ? "night" : "default";
}

function useShellPose(): MascotPose {
  const idle = useIdlePose();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === "/documents" ? "reading" : idle;
}

const REVIEW_VALUES = new Set<string>([
  "waiting",
  "deadlines",
  "important",
  "delete",
  "archive",
  "unsubscribe",
] satisfies ReviewTarget["review"][]);

const isReview = (value: string): value is ReviewTarget["review"] => REVIEW_VALUES.has(value);

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  // The account selection (switcher) and the Review list live in the URL, so neither is kept in component state.
  validateSearch: (
    search: Record<string, unknown>,
  ): { account?: string; review?: ReviewTarget["review"] | undefined } => ({
    ...(typeof search.account === "string" && search.account !== ""
      ? { account: search.account }
      : {}),
    review:
      typeof search.review === "string" && isReview(search.review) ? search.review : undefined,
  }),
});

// Every screen after onboarding shares one frame (sidebar / rail / tabs); it never remounts between them.
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: function ShellRoute() {
    return (
      <ScanStatusProvider>
        <AppFrame pose={useShellPose()} />
      </ScanStatusProvider>
    );
  },
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    const client = await context.getWorkerClient();
    const state = await client.call("app.state");
    throw redirect({ to: state.hasConnectedAccount ? "/overview" : "/welcome" });
  },
  component: () => null,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "onboarding",
  component: function OnboardingRoute() {
    return <OnboardingLayout controls={<AppearanceControls />} pose={useIdlePose()} />;
  },
});

const welcomeRoute = createRoute({
  getParentRoute: () => onboardingRoute,
  path: "/welcome",
  component: WelcomePage,
});

const connectRoute = createRoute({
  getParentRoute: () => onboardingRoute,
  path: "/connect",
  component: function ConnectRoute() {
    return <ConnectPage pose={useIdlePose()} />;
  },
});

const setupRoute = createRoute({
  getParentRoute: () => onboardingRoute,
  path: "/setup",
  component: function SetupRoute() {
    return <SetupPage pose={useIdlePose()} />;
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/overview",
  component: OverviewPage,
});

const categoryRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/category/$categoryId",
  component: CategoryPage,
});

const documentsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/documents",
  component: DocumentsPage,
});

const activityRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/activity",
  component: ActivityPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/settings",
  component: SettingsPage,
});

// Dev and E2E builds only: __POCHIMAIL_GALLERY__ is a build-time literal, so a production bundle drops this branch and the gallery chunk.
const galleryRoutes = __POCHIMAIL_GALLERY__
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/gallery",
        component: lazyRouteComponent(
          () => import("./features/dev-gallery/dev-gallery-page.tsx"),
          "DevGalleryPage",
        ),
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute.addChildren([welcomeRoute, connectRoute, setupRoute]),
  shellRoute.addChildren([
    overviewRoute,
    categoryRoute,
    documentsRoute,
    activityRoute,
    settingsRoute,
  ]),
  ...galleryRoutes,
]);

export type AppRouter = ReturnType<typeof createAppRouter>;

/** Creates the renderer router. File-based loading (file://) has no server, so it uses in-memory history. */
export const createAppRouter = (
  context: RouterContext,
  options: { initialEntries?: string[] } = {},
) =>
  createRouter({
    routeTree,
    context,
    history: createMemoryHistory({ initialEntries: options.initialEntries ?? ["/"] }),
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
