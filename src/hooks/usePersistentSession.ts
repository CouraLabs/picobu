import { useContext } from "react";
import { PersistentSessionContext, type PersistentSession } from "../providers/PersistentSessionProvider";

export const usePersistentSession = (): PersistentSession => {
  const ctx = useContext(PersistentSessionContext);
  if (!ctx) throw new Error("usePersistentSession must be used within <PersistentSessionProvider>");
  return ctx;
};
