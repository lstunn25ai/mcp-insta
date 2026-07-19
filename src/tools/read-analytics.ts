import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InstagramClient } from "../meta/client.js";
import { asMcpResult } from "./result.js";
import { failure, success, unavailable } from "../core/contracts.js";
import type { CapabilityRegistry } from "../core/capabilities.js";
import { readFailure } from "./read-profile.js";

const accountMetricPeriods: Record<string, ReadonlySet<"day" | "lifetime">> = {
  views: new Set(["day"]), reach: new Set(["day"]), follower_count: new Set(["day"]),
};
const mediaMetrics = new Set(["views", "reach", "likes", "comments", "shares", "saved"]);
const metricList = (allowed: Set<string>, items: string[]) => {
  const invalid = items.find((metric) => !allowed.has(metric));
  if (invalid) return undefined;
  return items.join(",");
};
const mediaId = z.string().regex(/^\d+$/, "media_id должен быть числовым Instagram Graph ID.");
const invalidMetric = () => asMcpResult(failure("Запрошена неподдерживаемая метрика или период для этого endpoint.", "INVALID_ARGUMENT"));

export function registerAnalyticsTools(server: McpServer, client: InstagramClient, capabilities: CapabilityRegistry) {
  server.tool("ig_get_account_insights", "Получить доступную аналитику аккаунта.", { metrics: z.array(z.string()).min(1), period: z.enum(["day", "lifetime"]).default("day") }, async ({ metrics, period }) => {
    if (!capabilities.has("analytics")) return asMcpResult(unavailable("analytics", "Аналитика не подтверждена диагностикой."));
    const metric = metricList(new Set(Object.keys(accountMetricPeriods)), metrics);
    if (!metric || metrics.some((item) => !accountMetricPeriods[item].has(period))) return invalidMetric();
    try { const r = await client.get("/me/insights", { metric, period }); return asMcpResult({ ...success(r.data, "analytics"), rate_limit: r.rate_limit }); }
    catch (e) { return asMcpResult(readFailure(e)); }
  });
  server.tool("ig_get_media_insights", "Получить доступную аналитику медиа.", { media_id: mediaId, metrics: z.array(z.string()).min(1) }, async ({ media_id, metrics }) => {
    if (!capabilities.has("analytics")) return asMcpResult(unavailable("analytics", "Аналитика не подтверждена диагностикой."));
    const metric = metricList(mediaMetrics, metrics); if (!metric) return invalidMetric();
    try { const r = await client.get(`/${media_id}/insights`, { metric }); return asMcpResult({ ...success(r.data, "analytics"), rate_limit: r.rate_limit }); }
    catch (e) { return asMcpResult(readFailure(e)); }
  });
}
