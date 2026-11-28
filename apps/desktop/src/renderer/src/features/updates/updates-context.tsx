import { createContext, type ReactNode, useContext } from "react";

/** The preload's update calls (src/shared/update-calls.ts), passed down so the toast and the Settings row can be tested with a fake. */
export type UpdatesApi = Window["pochimail"]["updates"];

const UpdatesContext = createContext<UpdatesApi | null>(null);

/** Null where no update calls were given (tests, stories): the notice and the Settings row then render nothing. */
export const useUpdates = (): UpdatesApi | null => useContext(UpdatesContext);

export function UpdatesProvider({
  api,
  children,
}: {
  api: UpdatesApi | undefined;
  children: ReactNode;
}) {
  return <UpdatesContext.Provider value={api ?? null}>{children}</UpdatesContext.Provider>;
}
