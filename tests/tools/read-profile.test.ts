import { expect, it } from "vitest";
import { profileFields } from "../../src/tools/read-profile.js";
it("использует согласованный и безопасный набор полей профиля", () => {
  expect(profileFields).toBe("id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url");
  expect(profileFields).not.toContain("access_token");
});
