import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Dialog, type DialogProviderType, type DialogSize } from "../components/ui/Dialog";

export const DialogContext = createContext<DialogProviderType | null>(null);

export const DialogProvider = ({ children }: { children: ReactNode }) => {
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    size: DialogSize;
    content: ReactNode | null;
    title?: string;
    footer?: ReactNode;
  }>({
    isOpen: false,
    content: null,
    size: "large"
  });

  // Stable API: `useDialog()` consumers list these in effect deps.
  const close = useCallback(() => setDialog((a) => ({ ...a, isOpen: false })), []);
  const open = useCallback(() => setDialog((a) => ({ ...a, isOpen: true })), []);
  const replace = useCallback(
    (content: ReactNode, size: DialogSize, title?: string, footer?: ReactNode) =>
      setDialog((a) => ({ ...a, size, content, title, footer })),
    [],
  );
  const value = useMemo<DialogProviderType>(() => ({ open, close, replace }), [open, close, replace]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog.isOpen && <Dialog size={dialog.size} close={close} title={dialog.title} footer={dialog.footer}>{dialog.content}</Dialog>}
    </DialogContext.Provider>
  );
};