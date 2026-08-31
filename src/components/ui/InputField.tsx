import type { RGBA } from "@opentui/core";
import { useTheme } from "../../hooks/useTheme";

export type InputFieldProps = {
  /** Label rendered as the box title (spacing added automatically). */
  title: string;
  value: string;
  placeholder?: string;
  /** When set, shown inside the box under the input in the error color. */
  error?: string;
  /** Wired to both input `onInput` and `onChange`. */
  onChange: (value: string) => void;
  focusedBorderColor?: string | RGBA;
  flexGrow?: number;
  /** 0 makes siblings in a row split space equally (e.g. 50/50 pairs). */
  flexBasis?: number | "auto";
  height?: number;
};

export const InputField = ({
  title,
  value,
  placeholder,
  error,
  onChange,
  focusedBorderColor,
  flexGrow = 1,
  flexBasis = "auto",
  height,
}: InputFieldProps) => {
  const { theme } = useTheme();
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.border}
      focusable={true}
      titleColor={theme.textMuted}
      focusedBorderColor={focusedBorderColor ?? theme.borderActive}
      title={` ${title} `}
      flexGrow={flexGrow}
      flexBasis={flexBasis}
      paddingX={1}
      height={height ?? (error ? 4 : 3)}
    >
      <input
        value={value}
        placeholder={placeholder}
        textColor={theme.text}
        placeholderColor={theme.textMuted}
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        onInput={onChange}
        onChange={onChange}
      />
      {error && <text fg={theme.error}>{error}</text>}
    </box>
  );
};
