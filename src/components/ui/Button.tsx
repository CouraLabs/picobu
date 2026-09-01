import { useState, type ReactNode } from "react";
import type { BoxProps } from "@opentui/react";
import { TextAttributes, type RGBA } from "@opentui/core";
import { useTheme } from "../../hooks/useTheme";

export type ButtonProps = {
  onPress: () => void;
  children: ReactNode;
  variant?: "default" | "success" | "error" | "info" | "warning";
  fg?: RGBA;
  bordered?: boolean;
} & Omit<BoxProps, "onMouseDown" | "children" | "paddingX">;

export const Button = ({
  onPress,
  children,
  variant = "default",
  bordered = true,
  ...props
}: ButtonProps) => {
  const { theme } = useTheme();
  const [hover, setHover] = useState(false);

  const textColor = () => {
    switch(variant) {
      case "default": return theme.text;
      case "success": return theme.success;
      case "error": return theme.error;
      case "info": return theme.info;
      case "warning": return theme.warning;
    }
  }

  const borderStuff = () => {
    if(bordered) {
      return { 
        border: true, 
        borderStyle: "rounded", 
        borderColor: hover ? theme.borderActive : textColor() } as Partial<BoxProps>
    }

    return {
      backgroundColor: theme.backgroundElement
    } as Partial<BoxProps>
  };

  return (
    <box
      onMouseDown={onPress}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      paddingX={2}
      {...borderStuff()}
      {...props}
    >
      <text fg={textColor()} attributes={hover ? TextAttributes.BOLD : TextAttributes.DIM}>
        {children}
      </text>
    </box>
  );
};
