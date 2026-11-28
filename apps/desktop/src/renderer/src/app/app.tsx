import { Toaster } from "@pochimail/ui/components/sonner";
import { I18nProvider } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import type { RpcClient } from "#shared/ipc/client.ts";
import { AppearanceProvider, useAppearance } from "../features/settings/appearance.tsx";
import type { StorageApi } from "../features/storage/storage-api.ts";
import { StoragePrompt } from "../features/storage/storage-prompt.tsx";
import { UpdateNotice } from "../features/updates/update-notice.tsx";
import { type UpdatesApi, UpdatesProvider } from "../features/updates/updates-context.tsx";
import { AppEventsBridge } from "../lib/app-events-bridge.tsx";
import { AppErrorBoundary } from "../lib/error-boundary.tsx";
import { useAppLocale } from "../lib/locale.ts";
import { OptimisticActionProvider } from "../lib/optimistic-context.tsx";
import { createAppQueryClient } from "../lib/query/client.ts";
import { createOptimisticActionRegistry } from "../lib/query/optimistic.ts";
import { useWorkerClient, WorkerClientProvider } from "../lib/worker-context.tsx";
import { type AppRouter, createAppRouter } from "../router.tsx";

function AppShell({ router }: { router: AppRouter }) {
  const client = useWorkerClient();
  return (
    <>
      <AppEventsBridge client={client} />
      <RouterProvider router={router} />
    </>
  );
}

/** The saved language replaces the OS language for every screen below the appearance controller. */
function AppearanceI18n({ children }: { children: ReactNode }) {
  const { locale } = useAppearance();
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}

export type AppProps = {
  queryClient?: QueryClient;
  router?: AppRouter;
  /** Worker client injected via context (useful for tests and stories with a fake IPC). */
  workerClient?: RpcClient | Promise<RpcClient>;
  /** The preload's storage calls: when given, the app asks how local data is protected before anything else (ADR 0005). */
  storage?: StorageApi;
  /** The preload's update calls: when given, a newer release shows one toast and Settings gets an Updates row (#300). */
  updates?: UpdatesApi;
};

/**
 * Renderer application shell: providers, one appearance controller, query client, worker connection,
 * event bridge and router. The viewport wrapper gives the shell a definite height, so the sidebar and
 * main screen scroll inside it instead of being clipped at the minimum window height. Accepts injectable
 * dependencies so behaviour can be tested through this public entry point with fake IPC.
 */
export function App(props: AppProps = {}) {
  const osLocale = useAppLocale();
  const queryClient = useMemo(
    () => props.queryClient ?? createAppQueryClient(),
    [props.queryClient],
  );
  const registry = useMemo(() => createOptimisticActionRegistry(), []);
  const workerClient = props.workerClient;
  const router = useMemo(() => {
    if (props.router !== undefined) return props.router;
    if (workerClient === undefined) throw new Error("App requires a worker client");
    return createAppRouter({ getWorkerClient: () => Promise.resolve(workerClient) });
  }, [props.router, workerClient]);

  return (
    <div data-slot="app-viewport" className="h-dvh min-h-0 w-full">
      <I18nProvider locale={osLocale}>
        <AppErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <OptimisticActionProvider registry={registry}>
              <WorkerClientProvider client={workerClient}>
                <AppearanceProvider>
                  <AppearanceI18n>
                    <UpdatesProvider api={props.updates}>
                      <AppShell router={router} />
                      <UpdateNotice />
                    </UpdatesProvider>
                    {props.storage === undefined ? null : <StoragePrompt storage={props.storage} />}
                    <Toaster />
                  </AppearanceI18n>
                </AppearanceProvider>
              </WorkerClientProvider>
            </OptimisticActionProvider>
          </QueryClientProvider>
        </AppErrorBoundary>
      </I18nProvider>
    </div>
  );
}
