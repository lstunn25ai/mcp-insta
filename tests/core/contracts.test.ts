import { describe, expect, it } from "vitest";
import { ToolResultSchema, unavailable } from "../../src/core/contracts.js";
import { redact } from "../../src/core/errors.js";
import { asMcpResult } from "../../src/tools/result.js";

describe("контракт результата", () => {
  it("принимает строковый ID и русскую ошибку", () => {
    const result = ToolResultSchema.parse(unavailable("profile", "Нет доступа к профилю."));
    expect(result.status).toBe("unavailable");
    expect(result.error?.message).toBe("Нет доступа к профилю.");
  });

  it("удаляет токены и параметры URL из ошибок", () => {
    expect(redact("access_token=secret&code=hidden https://x.test/?sig=value")).not.toContain("secret");
  });

  it("передаёт тот же контракт в text и structuredContent MCP", () => {
    const value = unavailable("profile", "Нет доступа к профилю.");
    const response = asMcpResult(value);
    expect(JSON.parse(response.content[0].text)).toEqual(value);
    expect(response.structuredContent).toEqual(value);
    expect(response.isError).toBe(true);
  });
});
