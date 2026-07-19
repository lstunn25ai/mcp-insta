import { z } from "zod";
const schema = z.object({ limit: z.number().int().min(1).max(100).default(25), after: z.string().min(1).optional(), before: z.string().min(1).optional() }).superRefine((v, ctx) => { if (v.after && v.before) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Можно указать только один курсор: after или before." }); });
export type Pagination = z.infer<typeof schema>;
export function parsePagination(value: unknown): Pagination { return schema.parse(value ?? {}); }
