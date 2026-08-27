import { useContext } from "react";
import { CodingSessionContext, type CodingSession } from "../providers/session-provider";

export const useSession = (): CodingSession => {
  const ctx = useContext(CodingSessionContext);
  if (!ctx) throw new Error("useSession must be used within <CodingSessionProvider>");
  return ctx;
};