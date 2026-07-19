import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramClient, MetaApiError } from "../../src/meta/client.js";

const token = "test-access-token";
const binding = { accountId: "ig-42", accountType: "professional" };
function secrets(value?: string) {
  const configuredValue = arguments.length === 0 ? token : value;
  return { get: vi.fn(async () => configuredValue), set: vi.fn(), remove: vi.fn() };
}
function state(value?: typeof binding) {
  const configuredValue = arguments.length === 0 ? binding : value;
  return { getAccountBinding: vi.fn(async () => configuredValue) };
}
const json = (body: unknown, options: ResponseInit = {}) => new Response(JSON.stringify(body), { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
afterEach(() => vi.unstubAllGlobals());

describe("InstagramClient", () => {
  it("не делает запрос без токена или закреплённого аккаунта", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(new InstagramClient(secrets(undefined), state() as never).get("/me")).rejects.toThrow(/insta_auth_start/);
    await expect(new InstagramClient(secrets(), state(undefined) as never).get("/me")).rejects.toThrow(/not bound/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("подставляет только закреплённый IG ID, сериализует параметры и читает rate limit", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v25.0/ig-42/media");
      expect(url.searchParams.get("fields")).toBe("id,caption");
      expect(url.searchParams.get("limit")).toBe("5");
      expect(url.searchParams.has("access_token")).toBe(false);
      expect(init?.headers).toEqual({ Authorization: `Bearer ${token}` });
      return json({ data: [{ id: "m-1" }] }, { headers: { "x-app-usage": '{"call_count":3}' } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new InstagramClient(secrets(), state() as never).get("/me/media", { fields: "id,caption", limit: 5 });
    expect(result).toEqual({ data: { data: [{ id: "m-1" }] }, rate_limit: { call_count: 3 } });
  });

  it("не переписывает произвольный resource ID", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(new URL(String(input)).pathname).toBe("/v25.0/media-9/insights");
      return json({ data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await new InstagramClient(secrets(), state() as never).get("/media-9/insights", { metric: "views" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("не раскрывает bearer token из Meta API error и не ломается от некорректного rate header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: 190, error_subcode: 463, message: `Invalid access token: ${token}` } }, { status: 400 })));
    const error = await new InstagramClient(secrets(), state() as never).get("/me").catch((caught) => caught as Error);
    expect(error.message).toContain("code 190/463");
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain("Invalid access token");

    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "ig-42" }, { headers: { "x-app-usage": "not-json" } })));
    await expect(new InstagramClient(secrets(), state() as never).get("/me")).resolves.toEqual({ data: { id: "ig-42" }, rate_limit: undefined });
  });

  it("нормализует HTTP 429 и переносит metadata rate limit в MetaApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: 4, error_subcode: 99, message: "rate limited" } }, { status: 429, headers: { "x-app-usage": '{"call_count":99}' } })));
    const error = await new InstagramClient(secrets(), state() as never).get("/me").catch((caught) => caught as MetaApiError);
    expect(error).toBeInstanceOf(MetaApiError); expect(error.retryable).toBe(true);
    expect(error.metaCode).toBe(4); expect(error.metaSubcode).toBe(99); expect(error.rateLimit).toEqual({ call_count: 99 });
  });
});
