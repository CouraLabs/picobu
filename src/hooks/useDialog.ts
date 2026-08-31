import { useContext } from "react";
import type { DialogProviderType } from "../components/ui/Dialog";
import { DialogContext } from "../providers/DialogProvider";

export const useDialog = (): DialogProviderType => {
  const dialogContext = useContext(DialogContext);

  if (!dialogContext) {
    throw new Error("useDialog must be used within a dialogContextProvider");
  }

  return dialogContext;
};