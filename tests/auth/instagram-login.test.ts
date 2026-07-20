import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramLogin } from "../../src/auth/instagram-login.js";

type Binding = { accountId: string; accountType: string };

function fakeSecrets(options: { failOnTokenWrite?: boolean } = {}) {
  const writes: Array<{ name: string; value: string }> = [];
  return {
    writes,
    async get(name: string) {
      if (name.endsWith("app-id")) return "app-id";
      if (name.endsWith("app-secret")) return "app-secret";
      return undefined;
    },
    async set(name: string, value: string) {
      if (options.failOnTokenWrite && name.endsWith("access-token")) throw new Error("Credential Manager unavailable");
      writes.push({ name, value });
    },
    async remove() {},
  };
}

function fakeState(initial?: Binding) {
  let binding = initial;
  let messagingPageId: string | undefined;
  const history: Array<Binding | undefined> = [];
  return {
    history,
    async getAccountBinding() { return binding; },
    async setAccountBinding(accountId: string, accountType: string) { binding = { accountId, accountType }; history.push(binding); },
    async clearAccountBinding() { binding = undefined; history.push(undefined); },
    async getMessagingPageId() { return messagingPageId; },
    async setMessagingPageId(pageId: string) { messagingPageId = pageId; },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const logins: InstagramLogin[] = [];
function createLogin(secrets: ReturnType<typeof fakeSecrets>, state: ReturnType<typeof fakeState>) {
  const login = new InstagramLogin(secrets, state as never, 0); logins.push(login); return login;
}
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(logins.splice(0).map((login) => login.cancel())); });

describe("InstagramLogin", () => {
  it("закрывает loopback callback после отмены", async () => {
    const login = createLogin(fakeSecrets(), fakeState());
    const started = await login.start();
    await login.cancel();
    await expect(fetch(started.callback)).rejects.toThrow();
  });

  it("выполняет OAuth с PKCE, закрепляет ровно выбранную Page/IG связку и не возвращает токен", async () => {
    const secrets = fakeSecrets();
    const state = fakeState();
    const login = createLogin(secrets, state);
    const started = await login.start("page-target", "@Target_IG");
    const authorization = new URL(started.url);
    expect(authorization.origin).toBe("https://www.facebook.com");
    expect(authorization.searchParams.get("redirect_uri")).toBe(started.callback);
    expect(authorization.searchParams.get("state")).toBe(started.state);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("client_id")).toBe("app-id");
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(new Set(authorization.searchParams.get("scope")?.split(","))).toEqual(new Set(["instagram_basic", "instagram_manage_insights", "instagram_manage_comments", "instagram_manage_messages", "pages_show_list", "pages_read_engagement", "pages_manage_metadata"]));

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes("/oauth/access_token")) {
        expect(String(input)).toBe("https://graph.facebook.com/v25.0/oauth/access_token");
        expect(init?.method).toBe("POST");
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code")).toBe("authorization-code");
        expect(body.get("client_id")).toBe("app-id");
        expect(body.get("client_secret")).toBe("app-secret");
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("redirect_uri")).toBe(started.callback);
        expect(body.get("code_verifier")).toBeTruthy();
        expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(authorization.searchParams.get("code_challenge"));
        return json({ access_token: "access-token-value", expires_in: 3600 });
      }
      const url = new URL(String(input));
      expect(url).toEqual(expect.objectContaining({ hostname: "graph.facebook.com", pathname: "/v25.0/me/accounts" }));
      expect(url.searchParams.get("fields")).toBe("id,access_token,instagram_business_account{id,username}");
      expect(url.searchParams.has("access_token")).toBe(false);
      expect(init?.headers).toEqual({ Authorization: "Bearer access-token-value" });
      return json({ data: [
        { id: "page-other", access_token: "page-other-token", instagram_business_account: { id: "ig-other", username: "other" } },
        { id: "page-target", access_token: "page-target-token", instagram_business_account: { id: "ig-target", username: "target_ig" } },
      ] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await login.complete("authorization-code", started.state);
    expect(result).toEqual({ account_id: "ig-target", page_id: "page-target", username: "target_ig", account_type: "professional", expires_in: 3600 });
    expect(JSON.stringify(result)).not.toContain("access-token-value");
    expect(secrets.writes).toEqual([{ name: "mcp-insta/access-token", value: "access-token-value" }, { name: "mcp-insta/page-access-token", value: "page-target-token" }]);
    expect(state.history).toEqual([{ accountId: "ig-target", accountType: "professional" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("не отменяет действующую сессию при неверном state, но запрещает повторное complete после успеха", async () => {
    const login = createLogin(fakeSecrets(), fakeState());
    const started = await login.start("page-1");
    await expect(login.complete("attacker-code", "wrong-state")).rejects.toThrow("state expired or does not match");

    const realFetch = globalThis.fetch;
    await realFetch(`${started.callback}?state=${started.state}&code=callback-code`);
    const fetchMock = vi.fn(async (input: string | URL) => String(input).includes("/oauth/access_token")
      ? json({ access_token: "token" })
      : json({ data: [{ id: "page-1", access_token: "page-token", instagram_business_account: { id: "ig-1", username: "creator" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(login.complete(undefined, started.state)).resolves.toMatchObject({ account_id: "ig-1" });
    const callsAfterSuccess = fetchMock.mock.calls.length;
    await expect(login.complete("reused", started.state)).rejects.toThrow("state expired or does not match");
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterSuccess);
  });

  it.each([
    ["wrong username", [{ id: "page-1", instagram_business_account: { id: "ig-1", username: "another" } }]],
    ["page without Instagram", [{ id: "page-1" }]],
    ["more than one matching IG without page constraint", [
      { id: "page-1", instagram_business_account: { id: "ig-1", username: "target" } },
      { id: "page-2", instagram_business_account: { id: "ig-2", username: "target" } },
    ]],
  ])("не сохраняет токен при %s", async (_name, pages) => {
    const secrets = fakeSecrets(); const state = fakeState(); const login = createLogin(secrets, state);
    const started = await login.start(undefined, "target");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input).includes("/oauth/access_token")
      ? json({ access_token: "token-must-not-persist" })
      : json({ data: pages })));
    await expect(login.complete("code", started.state)).rejects.toThrow(/matching linked Page|selected Facebook Page/);
    expect(secrets.writes).toEqual([]);
    expect(state.history).toEqual([]);
  });

  it("не сохраняет ничего при отказе Meta и редактирует секрет из ошибки привязки", async () => {
    const secrets = fakeSecrets(); const state = fakeState(); const login = createLogin(secrets, state);
    const started = await login.start("page-1");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input).includes("/oauth/access_token")
      ? json({ access_token: "never-persist" })
      : json({ error: { code: 190, message: "bad access_token=never-persist" } }, 400)));
    const error = await login.complete("code", started.state).catch((caught) => caught as Error);
    expect(error.message).toContain("Could not read Facebook Pages");
    expect(error.message).not.toContain("never-persist");
    expect(error.message).not.toContain("access_token");
    await expect(login.complete("code", started.state)).rejects.toThrow(/state expired or does not match/);
    expect(secrets.writes).toEqual([]);
    expect(state.history).toEqual([]);
  });

  it("откатывает новую привязку, если Credential Manager не принял токен", async () => {
    const secrets = fakeSecrets({ failOnTokenWrite: true });
    const state = fakeState({ accountId: "ig-old", accountType: "professional" }); const login = createLogin(secrets, state);
    const started = await login.start("page-1");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input).includes("/oauth/access_token")
      ? json({ access_token: "token" })
      : json({ data: [{ id: "page-1", access_token: "page-token", instagram_business_account: { id: "ig-1", username: "creator" } }] })));
    await expect(login.complete("code", started.state)).rejects.toThrow("Credential Manager unavailable");
    expect(state.history).toEqual([{ accountId: "ig-1", accountType: "professional" }, { accountId: "ig-old", accountType: "professional" }]);
  });
});
