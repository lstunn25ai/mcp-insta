import { unavailable, type ToolResult } from "./contracts.js";
export type Capability = "profile" | "media" | "analytics" | "direct" | "comments";
export class CapabilityRegistry {
  private enabled = new Set<Capability>();
  enable(...items: Capability[]) { items.forEach((item) => this.enabled.add(item)); }
  disable(...items: Capability[]) { items.forEach((item) => this.enabled.delete(item)); }
  has(item: Capability) { return this.enabled.has(item); }
  async run<T>(item: Capability, action: () => Promise<T> | T): Promise<T | ToolResult> {
    if (!this.has(item)) return unavailable(item, `Возможность «${item}» пока не подтверждена диагностикой.`);
    return action();
  }
}
