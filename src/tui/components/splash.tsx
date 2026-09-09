import { theme } from "@states/theme-state.ts";
import { PicobuLogo } from "@tui/components/picobu-logo.tsx";
import { Spinner } from "@tui/components/spinner.tsx";

export const Splash = () => {
  return (
    <box width="100%" height="100%" flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
      <PicobuLogo />
      <box flexDirection="row" gap={1}>
        <Spinner color={theme().textMuted} />
        <text fg={theme().textMuted}>loading…</text>
      </box>
    </box>
  );
};
