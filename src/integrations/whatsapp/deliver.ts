import type { CronAction } from "../../cron/schedule";
import { notifyCompletion } from "../../libs/notify";
import { sendText } from "./connection";
import { emitInbound } from "./bus";

/**
 * Execute a cron action: send a WhatsApp message (level 2+ also fires a
 * desktop notification; level 3+ prefixes an urgent marker), fire a desktop
 * notification, or submit a prompt to the persistent session.
 */
export const deliverCronAction = async (action: CronAction): Promise<void> => {
  switch (action.type) {
    case "whatsapp": {
      const level = action.level ?? 1;
      const text = level >= 3 ? `[ALERT level ${level}] ${action.message}` : action.message;
      await sendText(action.phone, text);
      if (level >= 2) notifyCompletion(`WhatsApp alert: ${action.message}`);
      return;
    }
    case "notification": {
      notifyCompletion(action.message);
      return;
    }
    case "prompt": {
      emitInbound({ source: "cron", title: "Cron job", text: action.text });
      return;
    }
  }
};
