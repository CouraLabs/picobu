import { act } from "react";
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createSessionBindings } from "../../../harness/commands/bindings";
import { SessionBindingsProvider } from "../../../providers/SessionBindings";
import { CodingSessionContext, type CodingSession } from "../../../providers/SessionProvider";
import { AskToolCall } from "./AskToolCall";
import { BashToolCall } from "./BashToolCall";

const bindings = createSessionBindings({ sessionId: "test", frontend: "terminal" });

const session = {
  streaming: false,
  onPrompt: () => {},
} as unknown as CodingSession;

const longCommand =
  "grep -n 'name:' src/harness/agent/tool/flow/**/*.ts src/harness/agent/tool/filesystem/**/*.ts | grep -v test; echo '=== wwp tools'; grep -n 'createSessionBindings' src/harness/commands/bindings.ts | head -15";

/**
 * Render-level guard for the marquee headers: a long command/title must mount
 * its scrolling branch (and survive hover + scroll ticks) without tripping
 * OpenTUI's "Text must be created inside of a text node" reconciler guard,
 * which fires when a raw string child lands outside a `<text>` — e.g. JSX
 * same-line whitespace like `/> </box>`.
 */
describe("tool marquee headers", () => {
  test("BashToolCall: long command with cwd renders and survives hover", async () => {
    const setup = await testRender(
      <box width={80} height={3} flexDirection="column">
        <BashToolCall
          status="success"
          command={longCommand}
          cwd="/Users/rodcoura/Projects/CouraLabs/picobu"
          copyText="x"
        />
      </box>,
      { width: 80, height: 3 },
    );
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("BASH");
    // Hover near the right edge of the command: the window should slide
    // rightward, speeding up with edge proximity. Interval updates are queued
    // on macrotasks, so a follow-up `act` scope is needed to flush them into
    // the frame before capturing.
    const before = setup.captureCharFrame();
    await act(async () => {
      await setup.mockMouse.moveTo(30, 0);
      await new Promise((r) => setTimeout(r, 200));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(setup.captureCharFrame()).not.toBe(before);
    // Mouse out: the marquee freezes in place.
    await act(async () => {
      await setup.mockMouse.moveTo(200, 200);
    });
    const frozen = setup.captureCharFrame();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(setup.captureCharFrame()).toBe(frozen);
  });

  test("AskToolCall: long question titles render and survive hover", async () => {
    const setup = await testRender(
      <SessionBindingsProvider bindings={bindings}>
        <CodingSessionContext.Provider value={session}>
          <box width={80} height={10} flexDirection="column">
            <AskToolCall
              status="success"
              partKey="k"
              isPending={true}
              hasFollowingUserMessage={false}
              copyText="x"
              questions={[
                {
                  title: "A very long question title that overflows the tab width easily",
                  question: "Pick one",
                  type: "single",
                  options: [
                    { answer: "yes", answerDescription: "do it" },
                    { answer: "no", answerDescription: "skip it" },
                  ],
                },
              ]}
            />
          </box>
        </CodingSessionContext.Provider>
      </SessionBindingsProvider>,
      { width: 80, height: 10 },
    );
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("question(s)");
    // Hover to start scrolling, hold for a few scroll ticks, then move the
    // mouse out to clear the interval — all inside `act` so no interval tick
    // can fire outside it (macrotasks can't run between the two blocks).
    await act(async () => {
      await setup.mockMouse.moveTo(5, 1);
      await new Promise((r) => setTimeout(r, 250));
    });
    await act(async () => {
      await setup.mockMouse.moveTo(200, 200);
    });
    await setup.flush();
    expect(setup.captureCharFrame()).toBeDefined();
  });
});
