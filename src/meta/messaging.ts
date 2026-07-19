import { randomUUID } from "node:crypto";
import { settings } from "../config/settings.js";
import type { SecretStore } from "../secrets/windows-credentials.js";
import type { LocalState } from "../storage/database.js";

type Conversation = { id: string; updated_time?: string; participants?: { data?: Array<{ id?: string; name?: string }> } };
type Message = { id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string; attachments?: { data?: unknown[] } };
type PendingReply = { conversationId: string; recipientId: string; text: string; expiresAt: number };

export class PageMessagingClient {
  private readonly conversations = new Map<string, string>();
  private readonly messages = new Set<string>();
  private readonly pending = new Map<string, PendingReply>();
  constructor(private readonly secrets: SecretStore, private readonly state: LocalState) {}
  private async page() { const pageId = await this.state.getMessagingPageId(); const token = await this.secrets.get(settings.secretNames.pageAccessToken); if (!pageId || !token) throw new Error("Page Messaging не подключён. Повторите OAuth с правами messaging."); return { pageId, token }; }
  private async request(path: string, init: RequestInit = {}) {
    const { token } = await this.page(); const response = await fetch(`${settings.graphBaseUrl}/${settings.apiVersion}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
    const body = await response.json().catch(() => ({})) as { error?: { code?: number; message?: string } };
    if (!response.ok || body.error) throw new Error(`Meta Messaging API request failed${body.error?.code ? ` (code ${body.error.code})` : ""}.`);
    return body as Record<string, unknown>;
  }
  async listConversations(limit = 25) { const { pageId } = await this.page(); const body = await this.request(`/${pageId}/conversations?platform=instagram&fields=id,updated_time,participants&limit=${limit}`); const data = (body.data as Conversation[] | undefined) ?? []; for (const item of data) { const recipient = item.participants?.data?.find((participant) => participant.id)?.id; if (item.id && recipient) this.conversations.set(item.id, recipient); } return body; }
  async listMessages(conversationId: string, limit = 25) { if (!this.conversations.has(conversationId)) throw new Error("Unknown conversation ID. Call ig_get_conversations first."); const body = await this.request(`/${encodeURIComponent(conversationId)}/messages?fields=id,message,from,created_time,attachments&limit=${limit}`); for (const item of ((body.data as Message[] | undefined) ?? [])) if (item.id) this.messages.add(item.id); return body; }
  async getMessage(messageId: string) { if (!this.messages.has(messageId)) throw new Error("Unknown message ID. Call ig_get_messages first."); return this.request(`/${encodeURIComponent(messageId)}?fields=id,message,from,created_time,attachments`); }
  prepareReply(conversationId: string, text: string) { const recipientId = this.conversations.get(conversationId); if (!recipientId) throw new Error("Unknown conversation ID. Call ig_get_conversations first."); const operationId = randomUUID(); this.pending.set(operationId, { conversationId, recipientId, text, expiresAt: Date.now() + 5 * 60_000 }); return { operation_id: operationId, conversation_id: conversationId, text, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() }; }
  async confirmReply(operationId: string) { const pending = this.pending.get(operationId); if (!pending || pending.expiresAt < Date.now()) { this.pending.delete(operationId); throw new Error("Reply operation expired or was not found. Prepare it again."); } const { pageId } = await this.page(); const body = await this.request(`/${pageId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: pending.recipientId }, message: { text: pending.text } }) }); this.pending.delete(operationId); return body; }
}
