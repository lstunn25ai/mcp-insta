import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { MetaApiError } from "../../src/meta/client.js";
import { CapabilityRegistry } from "../../src/core/capabilities.js";
import { registerAnalyticsTools } from "../../src/tools/read-analytics.js";
import { registerMediaTools } from "../../src/tools/read-media.js";
import { profileFields, registerProfileTools } from "../../src/tools/read-profile.js";

type Handler = (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; structuredContent: unknown; isError: boolean }>;
type RawShape = Record<string, z.ZodTypeAny>;
function toolServer() {
  const tools = new Map<string, { schema: RawShape; handler: Handler }>();
  return { tools, tool: (name: string, _description: string, schema: RawShape, handler: Handler) => tools.set(name, { schema, handler }) };
}
async function call(server: ReturnType<typeof toolServer>, name: string, input: Record<string, unknown>) {
  const tool = server.tools.get(name)!;
  return tool.handler(z.object(tool.schema).parse(input));
}
function result(response: Awaited<ReturnType<typeof call>>) { return JSON.parse(response.content[0].text); }
function setup(enabled: Array<"profile" | "media" | "analytics"> = []) {
  const server = toolServer(); const capabilities = new CapabilityRegistry(); capabilities.enable(...enabled);
  const client = { get: vi.fn(async () => ({ data: { data: [] }, rate_limit: { call_count: 2 } })) };
  registerProfileTools(server as never, client as never, capabilities);
  registerMediaTools(server as never, client as never, capabilities);
  registerAnalyticsTools(server as never, client as never, capabilities);
  return { server, capabilities, client };
}

describe("read-only capability gates", () => {
  it.each([
    ["ig_get_profile", {}], ["ig_get_media_list", {}], ["ig_get_media", { media_id: "123" }], ["ig_get_account_insights", { metrics: ["views"] }], ["ig_get_media_insights", { media_id: "123", metrics: ["views"] }],
  ])("blocks %s before calling Graph", async (name, input) => {
    const { server, client } = setup(); const response = await call(server, name, input);
    expect(result(response)).toMatchObject({ ok: false, status: "unavailable", error: { code: "CAPABILITY_UNAVAILABLE" } });
    expect(response.isError).toBe(true); expect(client.get).not.toHaveBeenCalled();
  });
});

describe("profile and media reads", () => {
  it("uses the exact profile fields and preserves rate limit in both MCP representations", async () => {
    const { server, client } = setup(["profile"]); const response = await call(server, "ig_get_profile", {}); const output = result(response);
    expect(client.get).toHaveBeenCalledWith("/me", { fields: profileFields });
    expect(output).toMatchObject({ ok: true, status: "success", capability: "profile", rate_limit: { call_count: 2 } });
    expect(response.structuredContent).toEqual(output); expect(response.isError).toBe(false);
  });

  it("passes default pagination and opaque cursor to the bound media-list endpoint", async () => {
    const { server, client } = setup(["media"]); await call(server, "ig_get_media_list", { after: "opaque+/cursor=" });
    expect(client.get).toHaveBeenCalledWith("/me/media", { fields: "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count", limit: 25, after: "opaque+/cursor=" });
  });

  it("rejects invalid pagination and non-Graph media IDs before API request", async () => {
    const { server, client } = setup(["media"]);
    const pagination = result(await call(server, "ig_get_media_list", { after: "a", before: "b" }));
    expect(pagination).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(() => server.tools.get("ig_get_media")!.schema.media_id.parse("../other")).toThrow();
    expect(client.get).not.toHaveBeenCalled();
  });

  it("does not expose an upstream secret in read failure", async () => {
    const { server, client } = setup(["profile"]); client.get.mockRejectedValue(new Error("access_token=canary-secret"));
    const output = result(await call(server, "ig_get_profile", {}));
    expect(output).toMatchObject({ ok: false, error: { code: "READ_FAILED" } });
    expect(JSON.stringify(output)).not.toContain("canary-secret");
  });
});

describe("analytics reads", () => {
  it("keeps account and media metrics/endpoints separate", async () => {
    const { server, client } = setup(["analytics"]);
    await call(server, "ig_get_account_insights", { metrics: ["follower_count"], period: "day" });
    await call(server, "ig_get_media_insights", { media_id: "987", metrics: ["likes", "saved"] });
    expect(client.get.mock.calls).toEqual([
      ["/me/insights", { metric: "follower_count", period: "day" }], ["/987/insights", { metric: "likes,saved" }],
    ]);
  });

  it("rejects endpoint-incompatible metrics before API request", async () => {
    const { server, client } = setup(["analytics"]);
    const account = result(await call(server, "ig_get_account_insights", { metrics: ["likes"] }));
    const wrongPeriod = result(await call(server, "ig_get_account_insights", { metrics: ["follower_count"], period: "lifetime" }));
    const media = result(await call(server, "ig_get_media_insights", { media_id: "987", metrics: ["follower_count"] }));
    expect(account).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(wrongPeriod).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(media).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(client.get).not.toHaveBeenCalled();
  });

  it("keeps Meta rate-limit metadata without raw upstream message", async () => {
    const { server, client } = setup(["analytics"]);
    client.get.mockRejectedValue(new MetaApiError("Meta API request failed (code 4).", 429, 4, 99, { call_count: 99 }));
    const output = result(await call(server, "ig_get_account_insights", { metrics: ["views"] }));
    expect(output).toMatchObject({ ok: false, error: { code: "META_API_ERROR", retryable: true, external_change: true, meta_code: 4, meta_subcode: 99 }, rate_limit: { call_count: 99 } });
    expect(JSON.stringify(output)).not.toContain("access_token");
  });
});
