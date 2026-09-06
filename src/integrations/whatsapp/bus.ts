

export type InboundEvent = {
  source: "whatsapp";
  title: string;
  text: string;
};
type Listener = (event: InboundEvent) => void;
const listeners = new Set<Listener>();
const pending: InboundEvent[] = [];


export const subscribeInbound = (fn: Listener): (() => void) => {
  listeners.add(fn);
  drainInbound(fn);
  return () => {
    listeners.delete(fn);
  };
};


export const emitInbound = (event: InboundEvent): void => {
  const fn = listeners.values().next().value;
  if (!fn) {
    pending.push(event);
    return;
  }
  fn(event);
};


export const drainInbound = (fn: Listener): void => {
  while (pending.length) {
    const event = pending.shift();
    if (event) fn(event);
  }
};
