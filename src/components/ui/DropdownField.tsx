import type { SelectProps } from "@opentui/react";
import type { RGBA } from "@opentui/core";
import { useTheme } from "../../hooks/useTheme";

export type DropdownOption = NonNullable<SelectProps["options"]>[number];

export type DropdownFieldProps = {
  /** Label rendered as the box title (spacing added automatically). */
  title: string;
  options: DropdownOption[];
  selectedIndex: number;
  onSelect: (index: number, option: DropdownOption | null) => void;
  /** Height of the select list; the box wraps it automatically. */
  height?: number;
  flexGrow?: number;
  /** 0 makes siblings in a row split space equally (e.g. 50/50 pairs). */
  flexBasis?: number | "auto";
  focusedBorderColor?: string | RGBA;
};

export const DropdownField = ({
  title,
  options,
  selectedIndex,
  onSelect,
  height = 4,
  flexGrow = 1,
  flexBasis = "auto",
  focusedBorderColor,
}: DropdownFieldProps) => {
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
      minWidth={40}
      paddingX={1}
    >
      <select
        height={height}
        options={options}
        selectedIndex={selectedIndex}
        textColor={theme.textMuted}
        showDescription={false}
        focusedTextColor={theme.text}
        selectedTextColor={theme.selectedListItemText}
        descriptionColor={theme.textMuted}
        selectedDescriptionColor={theme.textMuted}
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        selectedBackgroundColor="transparent"
        onSelect={onSelect}
      />
    </box>
  );
};
