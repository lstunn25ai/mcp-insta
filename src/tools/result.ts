import type { ToolResult } from "../core/contracts.js";
export function asMcpResult(result: ToolResult) { return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: !result.ok }; }
