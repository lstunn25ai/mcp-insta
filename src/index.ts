#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { InstagramLogin } from "./auth/instagram-login.js";
import { CapabilityRegistry } from "./core/capabilities.js";
import { InstagramClient } from "./meta/client.js";
import { PageMessagingClient } from "./meta/messaging.js";
import { WindowsCredentialManager, type SecretStore } from "./secrets/windows-credentials.js";
import { LocalState } from "./storage/database.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerProfileTools } from "./tools/read-profile.js";
import { registerMediaTools } from "./tools/read-media.js";
import { registerAnalyticsTools } from "./tools/read-analytics.js";
import { registerDirectTools } from "./tools/read-direct.js";
import { registerCommentTools } from "./tools/read-comments.js";

type LoginFlow = Pick<InstagramLogin, "start" | "complete" | "cancel">;
export type RuntimeDeps = { secrets: SecretStore; state: LocalState; api: InstagramClient; direct: PageMessagingClient; capabilities: CapabilityRegistry; login: LoginFlow };
/** All tools exposed by the production runtime. Only `ig_direct_reply_confirm` can perform an outbound action. */
export const registeredToolNames = ["insta_auth_start","insta_auth_complete","insta_auth_status","insta_diagnose","ig_get_profile","ig_get_media_list","ig_get_media","ig_get_account_insights","ig_get_media_insights","ig_get_conversations","ig_get_messages","ig_get_message","ig_direct_reply_prepare","ig_direct_reply_confirm","ig_get_comments","ig_get_comment","ig_get_replies"] as const;
export const serverVersion = "2.0.2";

export function createProductionDeps(): RuntimeDeps {
  const secrets = new WindowsCredentialManager(); const state = new LocalState();
  return { secrets, state, api: new InstagramClient(secrets, state), direct: new PageMessagingClient(secrets, state), capabilities: new CapabilityRegistry(), login: new InstagramLogin(secrets, state) };
}
export function registerTools(server: McpServer, deps: RuntimeDeps) {
  registerConnectionTools(server, deps.secrets, deps.api, deps.direct, deps.capabilities, deps.state, deps.login);
  registerProfileTools(server, deps.api, deps.capabilities); registerMediaTools(server, deps.api, deps.capabilities); registerAnalyticsTools(server, deps.api, deps.capabilities); registerDirectTools(server, deps.direct); registerCommentTools(server);
}
export function createRuntime(deps: RuntimeDeps = createProductionDeps()) {
  const server = new McpServer({ name: "insta", version: serverVersion }); registerTools(server, deps);
  let closed = false;
  const close = async () => { if (closed) return; closed = true; try { await deps.login.cancel(); } finally { await server.close(); } };
  const connect = async (transport: Transport) => { const onclose = transport.onclose; transport.onclose = () => { onclose?.(); void close(); }; await server.connect(transport); };
  return { server, connect, close };
}
export function createServer() { return createRuntime().server; }
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g,"/")}`).href) { const runtime = createRuntime(); runtime.connect(new StdioServerTransport()).catch(async (err)=>{ await runtime.close(); console.error("Ошибка запуска insta:",err); process.exit(1); }); }
