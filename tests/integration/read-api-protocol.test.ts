import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CapabilityRegistry } from "../../src/core/capabilities.js";
import { registerAnalyticsTools } from "../../src/tools/read-analytics.js";
import { registerMediaTools } from "../../src/tools/read-media.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

async function connectedReadServer() {
  const server = new McpServer({ name: "read-api-test", version: "1.0.0" });
  const capabilities = new CapabilityRegistry(); capabilities.enable("media", "analytics");
  const api = { get: vi.fn(async () => ({ data: { data: [] }, rate_limit: undefined })) };
  registerMediaTools(server, api as never, capabilities);
  registerAnalyticsTools(server, api as never, capabilities);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  closers.push(() => client.close(), () => server.close());
  return { client, api };
}

it("MCP SDK отклоняет нечисловой media_id до handler", async () => {
  const { client, api } = await connectedReadServer();
  const media = await client.callTool({ name: "ig_get_media", arguments: { media_id: "../escape" } });
  const insights = await client.callTool({ name: "ig_get_media_insights", arguments: { media_id: "not-an-id", metrics: ["views"] } });
  expect(media).toMatchObject({ isError: true }); expect(insights).toMatchObject({ isError: true });
  expect(media.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Input validation error") });
  expect(api.get).not.toHaveBeenCalled();
});

it("MCP SDK применяет default period analytics и возвращает structuredContent", async () => {
  const { client, api } = await connectedReadServer();
  const response = await client.callTool({ name: "ig_get_account_insights", arguments: { metrics: ["views"] } });
  expect(api.get).toHaveBeenCalledWith("/me/insights", { metric: "views", period: "day" });
  expect(response).toMatchObject({ isError: false, structuredContent: { ok: true, capability: "analytics" } });
});

it("MCP protocol возвращает INVALID_ARGUMENT без Graph-запроса для несовместимой metric-period пары", async () => {
  const { client, api } = await connectedReadServer();
  const response = await client.callTool({ name: "ig_get_account_insights", arguments: { metrics: ["views"], period: "lifetime" } });
  expect(response).toMatchObject({ isError: true });
  expect(response.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("INVALID_ARGUMENT") });
  expect(api.get).not.toHaveBeenCalled();
});
