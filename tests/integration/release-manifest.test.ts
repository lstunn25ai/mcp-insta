import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("release manifest references only the local mcp-insta package", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../server.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(manifest.name).toBe("insta");
  expect(manifest.packages[0].identifier).toBe("mcp-insta");
  expect(manifest.packages[0].environmentVariables ?? []).toEqual([]);
  expect(manifest.version).toBe(pkg.version);
  expect(manifest.packages[0].version).toBe(pkg.version);
  expect(pkg.scripts.prepack).toBe("npm run build");
});

it("release bundle excludes removed mutation tool directories", () => {
  expect(existsSync(new URL("../../dist/tools/instagram/messaging.js", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../../dist/tools/threads/publishing.js", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../../dist/tools/meta/auth.js", import.meta.url))).toBe(false);
});

it("npm tarball does not contain mutation code or obsolete instructions", () => {
  const cache = mkdtempSync(join(tmpdir(), "mcp-insta-pack-"));
  try {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("npm_execpath is required to verify the npm tarball.");
    const output = execFileSync(process.execPath, [npmCli, "pack", "--dry-run", "--json", "--cache", cache], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8" });
    const packed = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
    const paths = packed[0]?.files.map((file) => file.path) ?? [];
    expect(paths).toEqual(expect.arrayContaining(["AUDIT.md", "dist/index.js", "dist/index.d.ts", "docs/setup-windows.md", "docs/meta-setup.md", "docs/compatibility-matrix.md"]));
    expect(paths.some((path) => /dist\/(tools\/(instagram|threads|meta)|services|resources|prompts)\//.test(path))).toBe(false);
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).not.toMatch(/ig_publish|threads_publish|ig_send_message/i);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}, 20_000);
