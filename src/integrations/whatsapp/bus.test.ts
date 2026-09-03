import { describe, expect, test } from "bun:test";
import { emitInbound, subscribeInbound, type InboundEvent } from "@integrations/whatsapp/bus.ts";

const event: InboundEvent = {
  source: "whatsapp",
  title: "WhatsApp Answer to +15551234567 using wwp-msg",
  text: "hello",
};

describe("inbound bus", () => {
  test("emits immediately while a listener is attached", () => {
    const seen: InboundEvent[] = [];
    const unsub = subscribeInbound((e) => seen.push(e));
    emitInbound(event);
    expect(seen).toEqual([event]);
    unsub();
  });

  test("queues events with no listener and drains them on subscribe", () => {
    // No listener mounted (e.g. user on another page) — the event must queue.
    emitInbound(event);
    const seen: InboundEvent[] = [];
    const unsub = subscribeInbound((e) => seen.push(e));
    expect(seen).toEqual([event]);
    // The queue is drained, not copied: a second subscriber gets nothing.
    const late: InboundEvent[] = [];
    const unsub2 = subscribeInbound((e) => late.push(e));
    expect(late).toEqual([]);
    unsub();
    unsub2();
  });

  test("unsubscribed listeners stop receiving", () => {
    const seen: InboundEvent[] = [];
    const unsub = subscribeInbound((e) => seen.push(e));
    unsub();
    emitInbound(event);
    expect(seen).toEqual([]);
    // Cleanup: consume the queued event so it doesn't leak into other tests.
    const drain: InboundEvent[] = [];
    const unsub2 = subscribeInbound((e) => drain.push(e));
    expect(drain).toEqual([event]);
    unsub2();
  });
});
