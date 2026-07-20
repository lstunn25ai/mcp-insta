import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { settings } from "../config/settings.js";
import type { SecretStore } from "../secrets/windows-credentials.js";
import type { LocalState } from "../storage/database.js";

const CALLBACK_TTL_MS = 5 * 60_000;
type Page = { id?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string } };

/** Facebook Login for Business flow. Tokens stay in Credential Manager only. */
export class InstagramLogin {
  private state?: string;
  private verifier?: string;
  private code?: string;
  private callback?: string;
  private listener?: Server;
  private expiry?: NodeJS.Timeout;
  private pageId?: string;
  private expectedUsername?: string;

  constructor(private readonly secrets: SecretStore, private readonly localState: LocalState, private readonly callbackPort = settings.oauthCallbackPort) {}

  private async closeListener() {
    clearTimeout(this.expiry);
    if (!this.listener) return;
    await new Promise<void>((resolve) => this.listener?.close(() => resolve()));
    this.listener = undefined;
  }

  async cancel() {
    await this.closeListener();
    this.state = undefined;
    this.verifier = undefined;
    this.code = undefined;
    this.callback = undefined;
    this.pageId = undefined;
    this.expectedUsername = undefined;
  }

  async start(pageId?: string, expectedUsername?: string) {
    await this.cancel();
    const appId = await this.secrets.get(settings.secretNames.appId);
    if (!appId) throw new Error("Meta App ID is missing from Windows Credential Manager.");
    this.state = randomBytes(24).toString("base64url");
    this.verifier = randomBytes(32).toString("base64url");
    this.pageId = pageId;
    this.expectedUsername = expectedUsername?.replace(/^@/, "").toLowerCase();
    const challenge = createHash("sha256").update(this.verifier).digest("base64url");
    this.listener = createServer((req, res) => {
      const request = new URL(req.url || "/", "http://127.0.0.1");
      if (request.pathname !== "/callback" || request.searchParams.get("state") !== this.state) {
        res.writeHead(400); res.end("Invalid OAuth state."); return;
      }
      this.code = request.searchParams.get("code") || undefined;
      res.end("Authorization received. Return to Codex.");
      void this.closeListener();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.listener?.once("error", reject);
        this.listener?.listen(this.callbackPort, "127.0.0.1", () => { this.listener?.off("error", reject); resolve(); });
      });
    } catch (error) { await this.cancel(); throw error; }
    const port = (this.listener.address() as { port: number }).port;
    this.callback = `http://localhost:${port}/callback`;
    this.expiry = setTimeout(() => { void this.cancel(); }, CALLBACK_TTL_MS);
    const url = new URL(`https://www.facebook.com/${settings.apiVersion}/dialog/oauth`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", this.callback);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "instagram_basic,instagram_manage_insights,instagram_manage_comments,instagram_manage_messages,pages_show_list,pages_read_engagement");
    url.searchParams.set("state", this.state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString(), state: this.state, callback: this.callback };
  }

  async complete(code: string | undefined, state: string) {
    if (!this.state || state !== this.state || !this.verifier || !this.callback) {
      throw new Error("OAuth state expired or does not match. Start authorization again.");
    }
    try {
      const appId = await this.secrets.get(settings.secretNames.appId);
      const secret = await this.secrets.get(settings.secretNames.appSecret);
      if (!appId || !secret) throw new Error("Meta App credentials are missing from Windows Credential Manager.");
      const authorizationCode = code || this.code;
      if (!authorizationCode) throw new Error("OAuth code has not been received yet.");
      const body = new URLSearchParams({ client_id: appId, client_secret: secret, grant_type: "authorization_code", redirect_uri: this.callback, code: authorizationCode, code_verifier: this.verifier });
      const response = await fetch(`${settings.graphBaseUrl}/${settings.apiVersion}/oauth/access_token`, { method: "POST", body });
      const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
      if (!response.ok || !data.access_token) throw new Error("Meta did not issue an access token. Check Facebook Login settings.");
      const binding = await this.resolveAccount(data.access_token);
      const previousBinding = await this.localState.getAccountBinding(); const previousPageId = await this.localState.getMessagingPageId();
      await this.localState.setAccountBinding(binding.id, binding.accountType);
      try { await this.localState.setMessagingPageId(binding.pageId); await this.secrets.set(settings.secretNames.accessToken, data.access_token); await this.secrets.set(settings.secretNames.pageAccessToken, binding.pageAccessToken); }
      catch (error) {
        if (previousBinding) await this.localState.setAccountBinding(previousBinding.accountId, previousBinding.accountType);
        else await this.localState.clearAccountBinding();
        throw error;
      }
      return { account_id: binding.id, page_id: binding.pageId, username: binding.username, account_type: binding.accountType, expires_in: data.expires_in };
    } finally { await this.cancel(); }
  }

  private async resolveAccount(accessToken: string): Promise<{ id: string; pageId: string; pageAccessToken: string; username?: string; accountType: string }> {
    const url = new URL(`${settings.graphBaseUrl}/${settings.apiVersion}/me/accounts`);
    url.searchParams.set("fields", "id,access_token,instagram_business_account{id,username}");
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await response.json().catch(() => ({})) as {
      data?: Page[];
      error?: { code?: number; error_subcode?: number; message?: string };
    };
    if (!response.ok) {
      const detail = payload.error?.code ? ` Meta error code ${payload.error.code}.` : "";
      throw new Error(`Could not read Facebook Pages for Instagram binding.${detail}`);
    }
    const pages = (payload.data || []).filter((page) => !this.pageId || page.id === this.pageId);
    const accounts = pages.filter((page) => Boolean(page.id && page.access_token && page.instagram_business_account?.id)).filter((page) => !this.expectedUsername || page.instagram_business_account?.username?.toLowerCase() === this.expectedUsername);
    if (accounts.length !== 1 || !accounts[0].id || !accounts[0].access_token || !accounts[0].instagram_business_account?.id) {
      throw new Error(this.pageId
        ? "The selected Facebook Page must be linked to exactly one professional Instagram account."
        : "More than one or no matching linked Page was found. Start again with the ID of the separate Facebook Page for the target Instagram account.");
    }
    return { id: accounts[0].instagram_business_account.id, pageId: accounts[0].id, pageAccessToken: accounts[0].access_token, username: accounts[0].instagram_business_account.username, accountType: "professional" };
  }
}
