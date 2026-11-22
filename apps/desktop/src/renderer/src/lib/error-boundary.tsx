import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { PAGE_TITLE_CLASS } from "./screen-heading.tsx";

type Props = { children: ReactNode };
type State = { error: Error | null };

function ErrorState() {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-8 text-center">
      <h1 className={PAGE_TITLE_CLASS}>{t("shell.error.title")}</h1>
      <p className="mt-3 text-ui text-muted-foreground">{t("shell.error.body")}</p>
    </main>
  );
}

/** Catches render failures and shows the shared error state instead of a blank window. */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Structured, no mail data. The console is local-only in the desktop app.
    console.error(
      JSON.stringify({
        event: "renderer-error",
        message: error.message,
        componentStack: info.componentStack,
      }),
    );
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <ErrorState />;
    }
    return this.props.children;
  }
}
