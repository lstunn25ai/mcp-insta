import { expect, it } from "vitest";
import { registeredToolNames, serverVersion } from "../../src/index.js";
it("регистрирует только согласованные инструменты", () => { expect(registeredToolNames).toContain("ig_get_profile"); expect(registeredToolNames).not.toContain("ig_send_message"); });
it("runtime использует версию опубликованного пакета", () => expect(serverVersion).toBe("2.0.2"));
