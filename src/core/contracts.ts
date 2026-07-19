import { z } from "zod";

export const StatusSchema = z.enum(["success", "partial", "pending", "unavailable", "error"]);
export type ToolStatus = z.infer<typeof StatusSchema>;
export const ErrorSchema = z.object({
  code: z.string(), message: z.string(), retryable: z.boolean().default(false), external_change: z.boolean().default(false),
  meta_code: z.number().optional(), meta_subcode: z.number().optional(), operation_id: z.string().optional(), next_action: z.string().optional(),
});
export const ToolResultSchema = z.object({
  ok: z.boolean(), status: StatusSchema, data: z.unknown().optional(), error: ErrorSchema.optional(), warnings: z.array(z.string()).default([]),
  capability: z.string().optional(), rate_limit: z.record(z.string(), z.unknown()).optional(),
});
export type ToolResult<T = unknown> = Omit<z.infer<typeof ToolResultSchema>, "data"> & { data?: T };
export const success = <T>(data: T, capability?: string): ToolResult<T> => ({ ok: true, status: "success", data, warnings: [], capability });
export const partial = <T>(data: T, capability?: string): ToolResult<T> => ({ ok: true, status: "partial", data, warnings: [], capability });
export const unavailable = (capability: string, message: string, nextAction = "Запустите insta_diagnose или переподключите аккаунт."): ToolResult => ({ ok: false, status: "unavailable", warnings: [], capability, error: { code: "CAPABILITY_UNAVAILABLE", message, retryable: false, external_change: true, next_action: nextAction } });
export const failure = (message: string, code = "INTERNAL_ERROR", details: Partial<NonNullable<ToolResult["error"]>> = {}): ToolResult => ({ ok: false, status: "error", warnings: [], error: { code, message, retryable: false, external_change: false, ...details } });
