import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InstagramClient } from "../meta/client.js";
import { asMcpResult } from "./result.js";
import { success, failure } from "../core/contracts.js";
import { unavailable } from "../core/contracts.js";
import type { CapabilityRegistry } from "../core/capabilities.js";
import { MetaApiError } from "../meta/client.js";
export const profileFields = "id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url";
export function readFailure(error: unknown) {
  if (!(error instanceof MetaApiError)) return failure("Не удалось получить данные Instagram.", "READ_FAILED", { external_change: true });
  const result = failure(error.message, "META_API_ERROR", { retryable: error.retryable, external_change: true, meta_code: error.metaCode, meta_subcode: error.metaSubcode });
  if (error.rateLimit) result.rate_limit = error.rateLimit;
  return result;
}
export function registerProfileTools(server: McpServer, client: InstagramClient, capabilities: CapabilityRegistry) { server.tool("ig_get_profile", "Получить профиль подключённого Instagram-аккаунта.", {}, async () => { if (!capabilities.has("profile")) return asMcpResult(unavailable("profile", "Профиль не подтверждён диагностикой.")); try { const r = await client.get("/me", { fields: profileFields }); return asMcpResult({ ...success(r.data, "profile"), rate_limit: r.rate_limit }); } catch (e) { return asMcpResult(readFailure(e)); } }); }
