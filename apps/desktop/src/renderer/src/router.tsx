import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import type { RpcClient } from "#shared/ipc/client.ts";
import { ActivityPage } from "./features/activity/activity-page.tsx";
import { CategoryPage } from "./features/category/category-page.tsx";
import { ConnectPage } from "./features/connect/connect-page.tsx";
import { DocumentsPage } from "./features/documents/documents-page.tsx";
import { OnboardingLayout } from "./features/onboarding/onboarding-layout.tsx";
import { OverviewPage } from "./features/overview/overview-page.tsx";
import { AppearanceControls } from "./features/settings/appearance-controls.tsx";
import { SettingsPage } from "./features/settings/settings-page.tsx";
import { SetupPage } from "./features/setup/setup-page.tsx";
import { AppFrame } from "./features/shell/app-frame.tsx";
import { WelcomePage } from "./features/welcome/welcome-page.tsx";

export type RouterContext = {
  getWorkerClient(): Promise<RpcClient>;
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  // The account selection (switcher) lives in the URL so every screen filters by it.
  validateSearch: (search: Record<string, unknown>): { account?: string } =>
    typeof search.account === "string" && search.account !== "" ? { account: search.account } : {},
});

// Every screen after onboarding shares one frame (sidebar / rail / tabs); it never remounts between them.
// Routes compose features: the frame renders the controls it is given, so features stay independent.
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: () => <AppFrame frameControls={<AppearanceControls />} />,
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
  component: () => <OnboardingLayout controls={<AppearanceControls />} />,
});

const welcomeRoute = createRoute({
  getParentRoute: () => onboardingRoute,
  path: "/welcome",
  component: WelcomePage,
});

const connectRoute = createRoute({
  getParentRoute: () => onboardingRoute,
  path: "/connect",
  component: ConnectPage,
});

const setupRoute = createRoute({
  getParentRoute: () => onboardingRoute,
  path: "/setup",
  component: SetupPage,
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
