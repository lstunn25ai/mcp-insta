import { expect, it } from "vitest";
import { redactObject } from "../../src/core/errors.js";
it("очищает сериализованные ошибки", () => expect(JSON.stringify(redactObject({ access_token: "x", url: "https://a/?sig=y" }))).not.toContain("x"));
