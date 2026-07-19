import { appendFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { redactObject } from "../core/errors.js";
export class AuditLog { constructor(private readonly directory: string) {} write(action: string, status: string, technicalId?: string) { const path = join(this.directory, "audit.log"); if (existsSync(path) && Date.now() - statSync(path).mtimeMs > 7 * 86400000) unlinkSync(path); appendFileSync(path, JSON.stringify(redactObject({ action, status, technical_id: technicalId, at: new Date().toISOString() })) + "\n", "utf8"); } }
