import { openDialog } from "@states/dialog.state.ts";
import { setTheme, theme, themes } from "@states/theme-state.ts";
import { Button } from "@tui/components/button.tsx";
import { Dialog } from "@tui/components/dialog.tsx";
import { Dropdown } from "@tui/components/dropdown.tsx";
import { Marquee } from "@tui/components/marquee.tsx";

export const App = () => {
  return (
    <box width={"100%"} height={"100%"} backgroundColor={theme().background}>
      <box flexDirection={"row"} padding={1} gap={1}>
        <Marquee
          content="PICOBU · headless autonomous coding agent core — component demo: hover this banner to scroll it, open the dropdown to switch themes"
          maxWidth={64}
        />
        <Dropdown
          options={themes.map((name) => ({ name, value: name }))}
          onSelect={(option) => setTheme(String(option.value), "dark")}
          placeholder="Select theme…"
          maxWidth={24}
        />
        <Button
          label="Open dialog"
          onClick={() =>
            openDialog("small", () => (
              <box padding={1} flexDirection={"column"} gap={1}>
                <text>Dialog works!</text>
              </box>
            ))
          }
        />
      </box>
      <Dialog />
    </box>
  );
};
