import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { themeStore } from "../../stores/theme-store";

export type DialogSize = 'small' | 'medium' | 'large';

export type DialogProviderType = {
  open: () => void;
  close: () => void;
  replace: (node: ReactNode, size: DialogSize, title?: string, footer?: ReactNode) => void;
};

export const Dialog = ({ children, size, close, title, footer }: { children: ReactNode; size: DialogSize; close: () => void; title?: string; footer?: ReactNode }) => {
  const theme = useSelector(themeStore, a => a.context.theme);
  const getSize = (): { 
    width: `${number}%`, height: `${number}%`, vertical: `${number}%`, horizontal: `${number}%`
  } => {
    switch (size) {
      case "large": return { width: '90%', height: '80%', vertical: '10%', horizontal: '5%' };
      case "medium": return { width: '70%', height: '60%', vertical: '20%', horizontal: '15%' };
      case "small": return { width: '50%', height: '40%', vertical: '30%', horizontal: '25%' };
    }
  };

  return (
    <box position="absolute" top={0} left={0} bottom={0} right={0} onMouseDown={close}>
      <box
        width={getSize().width}
        height={getSize().height}
        position="absolute"
        top={getSize().vertical}
        bottom={getSize().vertical}
        left={getSize().horizontal}
        right={getSize().horizontal}
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
            {footer ?? <Button variant="error" bordered={false} onPress={close}>close</Button>}
          </box>
        </box>
      </box>
    </box>
  );
};
