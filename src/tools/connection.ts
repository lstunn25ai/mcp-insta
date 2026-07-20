import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult } from "./result.js";
import { failure, partial, success } from "../core/contracts.js";
import { InstagramLogin } from "../auth/instagram-login.js";
import type { SecretStore } from "../secrets/windows-credentials.js";
import type { InstagramClient } from "../meta/client.js";
import { MetaApiError } from "../meta/client.js";
import type { CapabilityRegistry } from "../core/capabilities.js";
import type { LocalState } from "../storage/database.js";
import type { PageMessagingClient } from "../meta/messaging.js";

type LoginFlow = Pick<InstagramLogin, "start" | "complete">;
export function registerConnectionTools(server: McpServer, secrets: SecretStore, client: InstagramClient, directClient: Pick<PageMessagingClient, "listConversations">, capabilities: CapabilityRegistry, state: LocalState, injectedLogin?: LoginFlow) {
  const login = injectedLogin ?? new InstagramLogin(secrets, state);
  server.tool("insta_auth_start", "Начать Facebook Login для заранее выбранной отдельной Facebook Page. OAuth не запускается сам по себе.", { page_id: z.string().min(1).optional(), expected_instagram_username: z.string().min(1).optional() }, async ({ page_id, expected_instagram_username }) => {
    try { return asMcpResult(success(await login.start(page_id, expected_instagram_username), "auth")); }
    catch (e) { return asMcpResult(failure(e instanceof Error ? e.message : "Не удалось начать подключение.", "AUTH_START_FAILED")); }
  });
  server.tool("insta_auth_complete", "Завершить OAuth-подключение по коду; токен не выводится и сохраняется только в Credential Manager.", { code: z.string().min(1).optional(), state: z.string().min(1) }, async (input) => {
    try { const completed = await login.complete(input.code, input.state); capabilities.disable("profile", "media", "analytics", "direct", "comments"); return asMcpResult(success(completed, "auth")); }
    catch (e) { return asMcpResult(failure(e instanceof Error ? e.message : "Не удалось завершить подключение.", "AUTH_COMPLETE_FAILED")); }
  });
  server.tool("insta_auth_status", "Проверить статус подключения без раскрытия секретов.", {}, async () => {
    try {
      const binding = await client.accountBinding();
      return asMcpResult(success({ connected: Boolean(await secrets.get("mcp-insta/access-token")) && Boolean(binding), account_bound: Boolean(binding) }, "auth"));
    } catch (e) { return asMcpResult(failure(e instanceof Error ? e.message : "Не удалось проверить подключение.", "AUTH_STATUS_FAILED")); }
  });
  server.tool("insta_diagnose", "Проверить возможности именно привязанного Instagram-аккаунта.", {}, async () => {
    capabilities.disable("profile", "media", "analytics", "direct", "comments");
    try {
      const binding = await client.accountBinding();
      if (!binding) return asMcpResult(success({ profile: "unavailable", media: "unavailable", analytics: "unavailable", direct: "unavailable", comments: "unavailable", reason: "Аккаунт не привязан к Facebook Page." }, "diagnostics"));
      if (binding.accountType !== "professional") return asMcpResult(success({ profile: "unavailable", media: "unavailable", analytics: "unavailable", direct: "unavailable", comments: "unavailable", reason: "Нужен профессиональный Creator или Business аккаунт." }, "diagnostics"));
      await client.get("/me", { fields: "id,username" });
      capabilities.enable("profile");
      let media: "supported" | "unavailable" = "unavailable";
      try { await client.get("/me/media", { fields: "id", limit: 1 }); capabilities.enable("media"); media = "supported"; } catch { /* Keep the gate closed. */ }
      let analytics: "supported" | "unavailable" = "unavailable";
      for (const probe of [{ metric: "views", period: "day" }, { metric: "follower_count", period: "day" }]) {
        try { await client.get("/me/insights", probe); capabilities.enable("analytics"); analytics = "supported"; break; }
        catch (error) { if (error instanceof MetaApiError && error.retryable) break; /* Try the next valid account-level metric. */ }
      }
      let direct: "supported" | "unavailable" = "unavailable";
      try { await directClient.listConversations(1); capabilities.enable("direct"); direct = "supported"; } catch { /* Keep the gate closed. */ }
      const data = { profile: "supported" as const, media, analytics, direct, comments: "unavailable" as const, stories: "unavailable" as const };
      return asMcpResult(media === "supported" && analytics === "supported" && direct === "supported" ? success(data, "diagnostics") : partial(data, "diagnostics"));
    } catch (e) { return asMcpResult(failure(e instanceof Error ? e.message : "Диагностика не выполнена.", "DIAGNOSTICS_FAILED")); }
  });
}
