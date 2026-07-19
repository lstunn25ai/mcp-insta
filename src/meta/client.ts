import { settings } from "../config/settings.js";
import type { SecretStore } from "../secrets/windows-credentials.js";
import type { LocalState } from "../storage/database.js";
export class MetaApiError extends Error {
  constructor(message: string, readonly status: number, readonly metaCode?: number, readonly metaSubcode?: number, readonly rateLimit?: Record<string, unknown>) { super(message); }
  get retryable() { return this.status === 429 || [4, 17, 32, 613].includes(this.metaCode ?? 0); }
}
export class InstagramClient {
  constructor(private readonly secrets: SecretStore, private readonly state: LocalState) {}
  async accountBinding() { return this.state.getAccountBinding(); }
  async get(path: string, params: Record<string, string | number | undefined> = {}) {
    const token = await this.secrets.get(settings.secretNames.accessToken);
    if (!token) throw new Error("Аккаунт не подключён. Запустите insta_auth_start.");
    const binding = await this.state.getAccountBinding();
    if (!binding) throw new Error("Instagram account is not bound to a Facebook Page.");
    const boundPath = path === "/me" ? `/${binding.accountId}` : path.replace(/^\/me(?=\/|$)/, `/${binding.accountId}`);
    const url = new URL(`${settings.graphBaseUrl}/${settings.apiVersion}${boundPath}`);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.set(k, String(v)); });
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}` } });
    const rate = response.headers.get("x-app-usage");
    const body = await response.json().catch(() => ({}));
    let rate_limit: Record<string, unknown> | undefined;
    if (rate) { try { rate_limit = JSON.parse(rate) as Record<string, unknown>; } catch { /* A malformed advisory header must not fail a successful API response. */ } }
    if (!response.ok || body.error) {
      const error = body.error as { code?: number; error_subcode?: number; message?: unknown } | undefined;
      const metadata = error?.code ? ` (code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ""})` : "";
      throw new MetaApiError(`Meta API request failed${metadata}.`, response.status, error?.code, error?.error_subcode, rate_limit);
    }
    return { data: body, rate_limit };
  }
}
