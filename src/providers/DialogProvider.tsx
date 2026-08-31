import { createContext, useContext, useState, type ReactNode } from "react";
import { Dialog, type DialogProviderType, type DialogSize } from "../components/ui/Dialog";

export const DialogContext = createContext<DialogProviderType | null>(null);

export const DialogProvider = ({ children }: { children: ReactNode }) => {
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    size: DialogSize;
    content: ReactNode | null;
    title?: string
  }>({
    isOpen: false,
    content: null,
    size: "large"
  });

  const close = () => setDialog((a) => ({ ...a, isOpen: false }))

  return (
    <DialogContext.Provider
      value={{
        open: () => setDialog((a) => ({ ...a, isOpen: true })),
        close,
        replace: (content: ReactNode, size: DialogSize, title?: string) =>
          setDialog((a) => ({ ...a, size, content, title })),
      }}
    >
      {children}
      {dialog.isOpen && <Dialog size={dialog.size} close={close} title={dialog.title}>{dialog.content}</Dialog>}
    </DialogContext.Provider>
  );
};
