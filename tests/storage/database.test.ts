import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalState, safeState } from "../../src/storage/database.js";
const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
describe("безопасное состояние", () => {
  it("не принимает текст Direct и секреты", () => {
    expect(() => safeState({ conversation_id: "1", message: "секрет" })).toThrow("не допускается");
    expect(safeState({ conversation_id: "1", last_message_id: "2" })).toEqual({ conversation_id: "1", last_message_id: "2" });
  });
});

it("заменяет и очищает единственную привязку в настоящем SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mcp-insta-state-")); temporaryDirectories.push(directory);
  const state = new LocalState(directory);
  await expect(state.getAccountBinding()).resolves.toBeUndefined();
  await state.setAccountBinding("ig-old", "professional");
  await state.setAccountBinding("ig-new", "professional");
  await expect(state.getAccountBinding()).resolves.toEqual({ accountId: "ig-new", accountType: "professional" });
  await state.clearAccountBinding();
  await expect(state.getAccountBinding()).resolves.toBeUndefined();
});
