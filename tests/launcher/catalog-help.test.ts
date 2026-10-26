import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.each(["cli", "db", "ssh", "wsl", "s3"])("lib/%s.js reports the plaintext catalog location in plain help output", (entry) => {
    const result = spawnSync(process.execPath, [path.resolve(`lib/${entry}.js`), "--help"], { encoding: "utf8", windowsHide: true });
    expect(result.status).toBe(0);
    const text = result.stdout + result.stderr;
    expect(text).toContain("Catalog: ~/.akms/mcp/registry.json (or $AKMS_MCP_HOME/registry.json) stores settings and passwords in plaintext.");
    expect(text).not.toContain("\u001b");
});
