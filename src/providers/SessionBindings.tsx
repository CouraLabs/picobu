import { createContext, useContext, type ReactNode } from "react";
import type { SessionBindings } from "../harness/commands/bindings";

export const SessionBindingsContext = createContext<SessionBindings | null>(null);

export const SessionBindingsProvider = ({
  bindings,
  children,
}: {
  bindings: SessionBindings;
  children: ReactNode;
}) => {
  return (
    <SessionBindingsContext.Provider value={bindings}>
      {children}
    </SessionBindingsContext.Provider>
  );
};

export const useSessionBindings = (): SessionBindings => {
  const bindings = useContext(SessionBindingsContext);
  if (!bindings) {
    throw new Error("useSessionBindings must be used within a SessionBindingsProvider");
  }
  return bindings;
};