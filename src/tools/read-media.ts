import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InstagramClient } from "../meta/client.js";
import { parsePagination } from "../core/pagination.js";
import { asMcpResult } from "./result.js";
import { success, failure } from "../core/contracts.js";
import { unavailable } from "../core/contracts.js"; import type { CapabilityRegistry } from "../core/capabilities.js";
import { readFailure } from "./read-profile.js";
const fields = "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count";
const mediaId = z.string().regex(/^\d+$/, "media_id должен быть числовым Instagram Graph ID.");
const invalidPagination = () => asMcpResult(failure("Некорректная пагинация медиа.", "INVALID_ARGUMENT"));
export function registerMediaTools(server: McpServer, client: InstagramClient, capabilities: CapabilityRegistry) {
 server.tool("ig_get_media_list", "Получить список медиа подключённого аккаунта.", { limit:z.number().int().min(1).max(100).optional(), after:z.string().min(1).optional(), before:z.string().min(1).optional() }, async (input) => { if (!capabilities.has("media")) return asMcpResult(unavailable("media","Медиа не подтверждено диагностикой.")); let p; try { p=parsePagination(input); } catch { return invalidPagination(); } try { const r=await client.get("/me/media", {fields, ...p}); return asMcpResult({...success(r.data,"media"),rate_limit:r.rate_limit}); } catch(e){return asMcpResult(readFailure(e));} });
 server.tool("ig_get_media", "Получить данные одного медиа по ID.", { media_id:mediaId }, async ({media_id}) => { if (!capabilities.has("media")) return asMcpResult(unavailable("media","Медиа не подтверждено диагностикой.")); try { const r=await client.get(`/${media_id}`,{fields}); return asMcpResult({...success(r.data,"media"),rate_limit:r.rate_limit}); } catch(e){return asMcpResult(readFailure(e));} });
}
