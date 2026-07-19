import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CapabilityRegistry } from "../../src/core/capabilities.js";
import { createRuntime, registeredToolNames } from "../../src/index.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

function runtime() {
  const secrets = { get: vi.fn(async () => { throw new Error("unexpected credential access"); }), set: vi.fn(), remove: vi.fn() };
  const state = { getAccountBinding: vi.fn(async () => { throw new Error("unexpected state access"); }) };
  const api = { accountBinding: state.getAccountBinding, get: vi.fn(async () => { throw new Error("unexpected Graph access"); }) };
  const login = { start: vi.fn(), complete: vi.fn(), cancel: vi.fn(async () => {}) };
  const value = createRuntime({ secrets, state, api, capabilities: new CapabilityRegistry(), login } as never);
  return { value, secrets, state, api, login };
}

it("production registry публикует только read-only tools и не делает IO", async () => {
  const setup = runtime(); const client = new Client({ name: "test", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
  await setup.value.connect(b); await client.connect(a); closers.push(() => client.close(), () => setup.value.close());
  const listed = await client.listTools();
  expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...registeredToolNames].sort());
  expect(listed.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  expect(setup.secrets.get).not.toHaveBeenCalled(); expect(setup.state.getAccountBinding).not.toHaveBeenCalled(); expect(setup.api.get).not.toHaveBeenCalled();
  const unknown = await client.callTool({ name: "ig_send_message", arguments: {} });
  expect(unknown).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("not found") }] });
  expect(setup.login.start).not.toHaveBeenCalled(); expect(setup.api.get).not.toHaveBeenCalled();
});

it("runtime cleanup отменяет login после закрытия peer и остаётся идемпотентным", async () => {
  const setup = runtime(); const client = new Client({ name: "test", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
  await setup.value.connect(b); await client.connect(a); await client.close(); await vi.waitFor(() => expect(setup.login.cancel).toHaveBeenCalledTimes(1)); await setup.value.close(); expect(setup.login.cancel).toHaveBeenCalledTimes(1);
});
