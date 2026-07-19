export const settings = {
  apiVersion: "v25.0",
  timezone: "Europe/Moscow",
  graphBaseUrl: "https://graph.facebook.com",
  oauthCallbackPort: 8787,
  secretNames: { appId: "mcp-insta/app-id", appSecret: "mcp-insta/app-secret", accessToken: "mcp-insta/access-token", pageAccessToken: "mcp-insta/page-access-token" },
  mediaRoots: [] as string[],
} as const;
