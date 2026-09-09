import { describe, expect, test } from "bun:test";
import { listMcpServers } from "../../src/integrations/mcp/status.ts";
import { AGENT_ECHO_PREFIX, isConnected, whatsappAuthDir } from "../../src/integrations/whatsapp/connection.ts";

describe("mcp status", () => {
  test("lists servers without manager", async () => {
    const rows = await listMcpServers();
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(typeof row.id).toBe("string");
      expect(typeof row.connected).toBe("boolean");
    }
  });
  test("merges manager snapshot", async () => {
    const rows = await listMcpServers({ snapshot: async () => [] } as never);
    for (const row of rows) {
      expect(typeof row.id).toBe("string");
    }
  });
});

describe("whatsapp connection state", () => {
  test("starts disconnected", () => {
    expect(isConnected()).toBe(false);
  });
  test("auth dir nests under system", () => {
    expect(whatsappAuthDir().endsWith("/whatsapp/auth")).toBe(true);
  });
  test("echo prefix is zero width marker", () => {
    expect(AGENT_ECHO_PREFIX.length).toBe(1);
    expect("msg".startsWith(AGENT_ECHO_PREFIX)).toBe(false);
  });
});
