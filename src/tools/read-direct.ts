import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult } from "./result.js";
import { failure, success } from "../core/contracts.js";
import type { PageMessagingClient } from "../meta/messaging.js";
const id = z.string().min(1).max(256); const limit = z.number().int().min(1).max(100).optional();
export function registerDirectTools(server: McpServer, direct: PageMessagingClient) {
  const read = <T>(fn: () => Promise<T>) => async () => { try { return asMcpResult(success(await fn(), "direct")); } catch { return asMcpResult(failure("Не удалось прочитать Instagram Direct.", "DIRECT_READ_FAILED")); } };
  server.tool("ig_get_conversations", "Получить Instagram Direct-диалоги текущей Page.", { limit }, ({ limit }) => read(() => direct.listConversations(limit))());
  server.tool("ig_get_messages", "Получить сообщения ранее перечисленного Direct-диалога.", { conversation_id: id, limit }, ({ conversation_id, limit }) => read(() => direct.listMessages(conversation_id, limit))());
  server.tool("ig_get_message", "Получить ранее перечисленное Direct-сообщение.", { message_id: id }, ({ message_id }) => read(() => direct.getMessage(message_id))());
  server.tool("ig_direct_reply_prepare", "Подготовить ответ в Direct; сообщение ещё не отправляется.", { conversation_id: id, text: z.string().min(1).max(1000) }, async ({ conversation_id, text }) => { try { return asMcpResult(success(direct.prepareReply(conversation_id, text), "direct")); } catch { return asMcpResult(failure("Не удалось подготовить ответ Direct.", "DIRECT_PREPARE_FAILED")); } });
  server.tool("ig_direct_reply_confirm", "Отправить ранее подготовленный ответ Direct после явного подтверждения.", { operation_id: id }, async ({ operation_id }) => { try { return asMcpResult(success(await direct.confirmReply(operation_id), "direct")); } catch { return asMcpResult(failure("Не удалось отправить ответ Direct.", "DIRECT_CONFIRM_FAILED")); } });
}
