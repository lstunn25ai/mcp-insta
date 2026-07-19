import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { registerCommentTools } from "../../src/tools/read-comments.js";
import { registerDirectTools } from "../../src/tools/read-direct.js";
import { registeredToolNames } from "../../src/index.js";

type Handler = (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; structuredContent: unknown; isError: boolean }>;
type RawShape = Record<string, z.ZodTypeAny>;
function toolServer() { const tools = new Map<string, { schema: RawShape; handler: Handler }>(); return { tools, tool: (name: string, _description: string, schema: RawShape, handler: Handler) => tools.set(name, { schema, handler }) }; }
async function call(server: ReturnType<typeof toolServer>, name: string, input: Record<string, unknown>) { const tool = server.tools.get(name)!; return tool.handler(z.object(tool.schema).parse(input)); }
function result(response: Awaited<ReturnType<typeof call>>) { return JSON.parse(response.content[0].text); }

describe("Direct prepare/confirm contract", () => {
  const direct = () => ({ listConversations: vi.fn(async () => ({ data: [{ id: "c1" }] })), listMessages: vi.fn(async () => ({ data: [{ id: "m1" }] })), getMessage: vi.fn(async () => ({ id: "m1" })), prepareReply: vi.fn(() => ({ operation_id: "op-1", text: "reply" })), confirmReply: vi.fn(async () => ({ message_id: "sent-1" })) });
  it("reads only through the Page messaging client", async () => {
    const server = toolServer(); const api = direct(); registerDirectTools(server as never, api as never);
    expect(result(await call(server, "ig_get_conversations", { limit: 25 }))).toMatchObject({ ok: true, capability: "direct" });
    expect(result(await call(server, "ig_get_messages", { conversation_id: "c1", limit: 25 }))).toMatchObject({ ok: true });
    expect(api.listConversations).toHaveBeenCalledWith(25); expect(api.listMessages).toHaveBeenCalledWith("c1", 25);
  });
  it("never sends in prepare and sends only in explicit confirm", async () => {
    const server = toolServer(); const api = direct(); registerDirectTools(server as never, api as never);
    const prepared = result(await call(server, "ig_direct_reply_prepare", { conversation_id: "c1", text: "reply" }));
    expect(prepared).toMatchObject({ ok: true, data: { operation_id: "op-1" } }); expect(api.confirmReply).not.toHaveBeenCalled();
    expect(result(await call(server, "ig_direct_reply_confirm", { operation_id: "op-1" }))).toMatchObject({ ok: true, data: { message_id: "sent-1" } }); expect(api.confirmReply).toHaveBeenCalledWith("op-1");
  });
  it("does not register a one-step send tool", () => { expect(registeredToolNames).not.toContain("ig_send_message"); });
});

describe("comments disabled contract", () => {
  it.each([["ig_get_comments", { media_id: "123" }], ["ig_get_comment", { comment_id: "123" }], ["ig_get_replies", { comment_id: "123" }]])("returns unavailable for %s without a network client", async (name, input) => {
    const server = toolServer(); registerCommentTools(server as never); const response = await call(server, name, input); expect(result(response)).toMatchObject({ status: "unavailable", capability: "comments", error: { next_action: expect.stringContaining("отдельной реализации") } });
  });
  it("declares comments IDs as numeric Graph IDs", () => { const server = toolServer(); registerCommentTools(server as never); expect(() => server.tools.get("ig_get_comment")!.schema.comment_id.parse("../escape")).toThrow(); });
});
