import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { themeStore } from "../../stores/theme-store";

export type DialogSize = 'small' | 'medium' | 'large';

export type DialogProviderType = {
  open: () => void;
  close: () => void;
  replace: (node: ReactNode, size: DialogSize, title?: string) => void;
};

export const Dialog = ({ children, size, close, title }: { children: ReactNode; size: DialogSize; close: () => void; title?: string; }) => {
  const theme = useSelector(themeStore, a => a.context.theme);
  const getSize = (): { size: `${number}%`; borders: `${number}%`; } => {
    switch (size) {
      case "large": return { size: '80%', borders: '10%' };
      case "medium": return { size: '60%', borders: '20%' };
      case "small": return { size: '40%', borders: '30%' };
    }
  };

  return (
    <box position="absolute" top={0} left={0} bottom={0} right={0} onMouseDown={close}>
      <box
        width={getSize().size}
        height={getSize().size}
        position="absolute"
        top={getSize().borders}
        left={getSize().borders}
        bottom={getSize().borders}
        right={getSize().borders}
        backgroundColor={theme.backgroundPanel}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.name === "escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <box flexGrow={1} flexShrink={1} flexDirection="column" paddingY={1} paddingX={2}>
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme.text}>[ {title} ]</text>
            <Button variant="warning" bordered={false} onPress={close}>X</Button>
          </box>
          <scrollbox flexGrow={1} flexShrink={1} backgroundColor={theme.backgroundPanel}>
            {children}
          </scrollbox>
          <box flexDirection="row" justifyContent="flex-end">
            <Button variant="error" bordered={false} onPress={close}>close</Button>
          </box>
        </box>
      </box>
    </box>
  );
};
