import { describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../../src/core/capabilities.js";
import { parsePagination } from "../../src/core/pagination.js";

describe("capability gate", () => {
  it("блокирует неподтверждённую возможность без сетевого вызова", async () => {
    const registry = new CapabilityRegistry();
    const request = vi.fn();
    const result = await registry.run("direct", request);
    expect(result.status).toBe("unavailable");
    expect(request).not.toHaveBeenCalled();
  });

  it("отклоняет два курсора", () => {
    expect(() => parsePagination({ after: "a", before: "b" })).toThrow("только один");
  });
});
