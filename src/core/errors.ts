const secretKeys = /(access_token|token|client_secret|code|cookie|sig|signature)=?[^\s&]*/gi;
const signedQuery = /([?&](?:sig|signature|expires|x-amz-[^=]+)=[^&#\s]*)/gi;
export function redact(value: string): string { return value.replace(secretKeys, "[СКРЫТО]").replace(signedQuery, "[СКРЫТО]"); }
export function safeError(error: unknown): string { return redact(error instanceof Error ? error.message : String(error)); }
export function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      /token|secret|cookie|code/i.test(key) ? [key, "[СКРЫТО]"] : [key, redactObject(item)],
    ));
  }
  return typeof value === "string" ? redact(value) : value;
}
