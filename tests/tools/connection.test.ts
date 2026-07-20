import { describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../../src/core/capabilities.js";
import { MetaApiError } from "../../src/meta/client.js";
import { registerConnectionTools } from "../../src/tools/connection.js";

type Handler = (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
function toolServer() {
  const handlers = new Map<string, Handler>();
  return { handlers, tool: (name: string, _description: string, _schema: unknown, handler: Handler) => handlers.set(name, handler) };
}
function result(value: Awaited<ReturnType<Handler>>) { return JSON.parse(value.content[0].text); }
function register(options: { binding?: { accountId: string; accountType: string }; token?: string; get?: ReturnType<typeof vi.fn>; listConversations?: ReturnType<typeof vi.fn>; login?: { start: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> } } = {}) {
  const server = toolServer(); const capabilities = new CapabilityRegistry();
  const secrets = { get: vi.fn(async () => options.token), set: vi.fn(), remove: vi.fn() };
  const client = { accountBinding: vi.fn(async () => options.binding), get: options.get ?? vi.fn(async () => ({ data: {}, rate_limit: undefined })) };
  const direct = { listConversations: options.listConversations ?? vi.fn(async () => ({ data: [] })) };
  registerConnectionTools(server as never, secrets, client as never, direct as never, capabilities, {} as never, options.login as never);
  return { server, capabilities, secrets, client, direct };
}

describe("insta_diagnose", () => {
  it("открывает независимые capability gates только после соответствующих успешных probe", async () => {
    const get = vi.fn(async () => ({ data: {}, rate_limit: { call_count: 1 } }));
    const { server, capabilities } = register({ binding: { accountId: "ig-1", accountType: "professional" }, get });
    const output = result(await server.handlers.get("insta_diagnose")!({}));
    expect(output).toMatchObject({ ok: true, status: "success", data: { profile: "supported", media: "supported", analytics: "supported", direct: "supported" } });
    expect(capabilities.has("profile")).toBe(true); expect(capabilities.has("media")).toBe(true); expect(capabilities.has("analytics")).toBe(true); expect(capabilities.has("direct")).toBe(true);
    expect(get.mock.calls).toEqual([
      ["/me", { fields: "id,username" }], ["/me/media", { fields: "id", limit: 1 }], ["/me/insights", { metric: "views", period: "day" }],
    ]);
  });

  it("изолирует частичные отказы и использует запасную метрику analytics", async () => {
    const get = vi.fn(async (path: string, params: Record<string, unknown>) => {
      if (path === "/me/media" || path === "/me/conversations") throw new Error("permission denied");
      if (path === "/me/insights" && params.metric === "views") throw new Error("metric unavailable");
      return { data: {}, rate_limit: undefined };
    });
    const { server, capabilities } = register({ binding: { accountId: "ig-1", accountType: "professional" }, get });
    const output = result(await server.handlers.get("insta_diagnose")!({}));
    expect(output).toMatchObject({ ok: true, status: "partial", data: { profile: "supported", media: "unavailable", analytics: "supported", direct: "supported" } });
    expect(capabilities.has("profile")).toBe(true); expect(capabilities.has("media")).toBe(false); expect(capabilities.has("analytics")).toBe(true); expect(capabilities.has("direct")).toBe(true);
    expect(get).toHaveBeenCalledWith("/me/insights", { metric: "follower_count", period: "day" });
  });

  it("не делает fallback analytics-запрос при retryable rate limit", async () => {
    const get = vi.fn(async (path: string, params: Record<string, unknown>) => {
      if (path === "/me/insights" && params.metric === "views") throw new MetaApiError("Meta API request failed (code 4).", 429, 4);
      return { data: {}, rate_limit: undefined };
    });
    const { server, capabilities } = register({ binding: { accountId: "ig-1", accountType: "professional" }, get });
    const output = result(await server.handlers.get("insta_diagnose")!({}));
    expect(output).toMatchObject({ ok: true, status: "partial", data: { analytics: "unavailable", direct: "supported" } });
    expect(get).toHaveBeenCalledWith("/me/insights", { metric: "views", period: "day" });
    expect(get).not.toHaveBeenCalledWith("/me/insights", { metric: "follower_count", period: "day" });
    expect(capabilities.has("analytics")).toBe(false);
  });

  it("сбрасывает предыдущие gates, когда новая диагностика больше не подтверждает аккаунт", async () => {
    const setup = register({ binding: { accountId: "ig-1", accountType: "professional" } });
    await setup.server.handlers.get("insta_diagnose")!({});
    expect(setup.capabilities.has("profile")).toBe(true);
    setup.client.accountBinding.mockResolvedValue({ accountId: "ig-1", accountType: "personal" });
    const output = result(await setup.server.handlers.get("insta_diagnose")!({}));
    expect(output.data).toMatchObject({ profile: "unavailable", analytics: "unavailable", direct: "unavailable" });
    expect(setup.capabilities.has("profile")).toBe(false); expect(setup.capabilities.has("media")).toBe(false); expect(setup.capabilities.has("analytics")).toBe(false); expect(setup.capabilities.has("direct")).toBe(false);
  });

  it("не делает fetch и закрывает все gates, если привязка исчезла", async () => {
    const setup = register({ binding: { accountId: "ig-1", accountType: "professional" } });
    await setup.server.handlers.get("insta_diagnose")!({});
    setup.client.accountBinding.mockResolvedValue(undefined);
    const output = result(await setup.server.handlers.get("insta_diagnose")!({}));
    expect(output.data).toMatchObject({ profile: "unavailable", reason: "Аккаунт не привязан к Facebook Page." });
    expect(setup.client.get).toHaveBeenCalledTimes(3);
    expect(setup.capabilities.has("profile")).toBe(false); expect(setup.capabilities.has("media")).toBe(false); expect(setup.capabilities.has("analytics")).toBe(false); expect(setup.capabilities.has("direct")).toBe(false);
  });

  it("возвращает структурированную ошибку при фатальном profile probe", async () => {
    const { server, capabilities } = register({ binding: { accountId: "ig-1", accountType: "professional" }, get: vi.fn(async () => { throw new Error("upstream offline"); }) });
    const output = result(await server.handlers.get("insta_diagnose")!({}));
    expect(output).toMatchObject({ ok: false, status: "error", error: { code: "DIAGNOSTICS_FAILED" } });
    expect(capabilities.has("profile")).toBe(false);
  });

  it("оставляет Direct закрытым, если чтение диалогов отклонено Meta", async () => {
    const setup = register({ binding: { accountId: "ig-1", accountType: "professional" }, listConversations: vi.fn(async () => { throw new Error("messaging permission denied"); }) });
    const output = result(await setup.server.handlers.get("insta_diagnose")!({}));
    expect(output).toMatchObject({ ok: true, status: "partial", data: { direct: "unavailable" } });
    expect(setup.capabilities.has("direct")).toBe(false);
  });
});

describe("insta_auth_complete", () => {
  it("инвалидирует capability gates после успешной перепривязки", async () => {
    const login = { start: vi.fn(), complete: vi.fn(async () => ({ account_id: "ig-new" })) };
    const setup = register({ binding: { accountId: "ig-1", accountType: "professional" }, login });
    await setup.server.handlers.get("insta_diagnose")!({});
    expect(setup.capabilities.has("profile")).toBe(true);
    const output = result(await setup.server.handlers.get("insta_auth_complete")!({ code: "code", state: "state" }));
    expect(output).toMatchObject({ ok: true, data: { account_id: "ig-new" } });
    expect(setup.capabilities.has("profile")).toBe(false); expect(setup.capabilities.has("media")).toBe(false); expect(setup.capabilities.has("analytics")).toBe(false); expect(setup.capabilities.has("direct")).toBe(false);
  });
});

describe("insta_auth_status", () => {
  it.each([
    [undefined, undefined, false, false], ["token", undefined, false, false], [undefined, { accountId: "ig-1", accountType: "professional" }, false, true], ["token", { accountId: "ig-1", accountType: "professional" }, true, true],
  ])("reports token=%s binding=%s without exposing either", async (token, binding, connected, accountBound) => {
    const { server } = register({ token, binding });
    const output = result(await server.handlers.get("insta_auth_status")!({}));
    expect(output).toMatchObject({ ok: true, data: { connected, account_bound: accountBound } });
    expect(JSON.stringify(output)).not.toContain("ig-1");
    expect(JSON.stringify(output)).not.toContain("token");
  });
});
