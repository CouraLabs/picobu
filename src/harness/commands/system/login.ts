import type { Command } from "../types";
import { loopStore } from "../../../stores/loop-store";
import { oauthAuthById, startLogin } from "../../../auth";

/**
 * `/login` — OAuth login for subscription providers. No argument opens the
 * provider picker; `/login openai|anthropic|copilot [enterprise-domain]` runs
 * the flow directly (`copilot` accepts a GitHub Enterprise domain/URL).
 */
export const login: Command = {
  kind: "system",
  name: "login",
  aliases: ["auth"],
  flags: ["code", "web"],
  title: "login",
  description: "Log in to OpenAI, Anthropic, or GitHub Copilot (/login <provider>)",
  path: "",
  handler: (args) => {
    const [id = "", ...rest] = args.trim().split(/\s+/);
    if (id && oauthAuthById(id)) {
      void startLogin(id, rest.join(" ").trim());
      return;
    }
    loopStore.trigger.openAuthPicker({ mode: "login" });
  },
};