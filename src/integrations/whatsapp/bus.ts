/**
 * Inbound bridge between integrations and the persistent session.
 *
 * Producers (the Baileys `messages.upsert` handler)
 * publish here; `PersistentSessionProvider` subscribes while it is mounted and
 * submits each event as a labeled prompt to the persistent agent. When no
 * subscriber is attached (user on another page), messages queue here and drain
 * on the next subscribe.
 */

export type InboundEvent = {
  /** Where the prompt came from. */
  source: "whatsapp";
  /** Header line describing the origin (shown to the agent). */
  title: string;
  /** The payload text / task description. */
  text: string;
};

type Listener = (event: InboundEvent) => void;

const listeners = new Set<Listener>();
const pending: InboundEvent[] = [];

/** Subscribe to inbound events; returns an unsubscribe function.
 * Registration first drains anything queued while nobody was listening. */
export const subscribeInbound = (fn: Listener): (() => void) => {
  listeners.add(fn);
  drainInbound(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Publish an event; queued when nobody is listening yet.
 * Delivered to a single listener only: in web mode every open tab mounts its
 * own `PersistentSessionProvider`, and fanning out would run the same event as
 * a turn (and possibly a `wwp-*` reply) once per tab. */
export const emitInbound = (event: InboundEvent): void => {
  const fn = listeners.values().next().value;
  if (!fn) {
    pending.push(event);
    return;
  }
  fn(event);
};

/** Called by subscribers on registration so nothing is lost while unmounted. */
export const drainInbound = (fn: Listener): void => {
  while (pending.length) {
    const event = pending.shift();
    if (event) fn(event);
  }
};
