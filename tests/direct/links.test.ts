import { expect, it } from "vitest";
import { extractLinks } from "../../src/direct/links.js";
it("выделяет ссылку и предупреждает о http", () => expect(extractLinks("http://example.test/a?q=1")[0]).toMatchObject({ domain: "example.test", warning: expect.stringContaining("http") }));
