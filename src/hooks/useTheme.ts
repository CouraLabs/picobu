import { useSelector } from "@xstate/store-react";
import { themeStore } from "../stores/theme-store";

export const useTheme = () => useSelector(themeStore, (s) => s.context);
