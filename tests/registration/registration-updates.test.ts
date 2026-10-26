import fs from "node:fs";
import { removeTempDirectory } from "../support/remove-temp-directory";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "@/modules/registration/registry";
import { ManagedSession } from "@/modules/registration/menu";
import { runtimeMenu, runtimeNotice } from "@/modules/registration/runtime-menu";
import { latestRuntimeVersion, type GlobalRuntime } from "@/modules/registration/runtime";
import { Prompter } from "@/modules/registration/prompter";
import type { McpKind } from "@/modules/registration/types";
import { PACKAGE_VERSION } from "@/_defs";

let directory: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "akms updates "));
    vi.stubEnv("AKMS_MCP_HOME", directory);
    fs.writeFileSync(path.join(directory, "registry.json"), JSON.stringify({ version: 2, defaultMode: "catalog", clients: [], connections: {}, sessions: {} }));
});
afterEach(async () => {
    vi.unstubAllEnvs();
    await removeTempDirectory(directory, "akms updates ");
}, 15_000);
async function screen(lines: string[], registry: Registry) {
    const input = new PassThrough(), output = new PassThrough(); let text = "";
    output.on("data", chunk => { text += chunk; }); input.end(lines.join("\n") + "\n");
    const prompter = new Prompter(input, output);
    try { await runtimeMenu(prompter, registry); } finally { prompter.close(); }
    return text;
}
/** One installed @akms/mcp serves every kind; `find` returns that kind's entry in it. */
function fixture(version: string | null = "1.0.0", linked = false) {
    let installed: { version: string; linked: boolean } | null = version == null ? null : { version, linked };
    const find = vi.fn((kind: McpKind): GlobalRuntime | null => installed && { command: process.execPath, args: [path.join(directory, "node_modules", "@akms", "mcp", "lib", `${kind}.js`)], ...installed });
    const latest = vi.fn(async (): Promise<string | null> => "2.0.0");
    const install = vi.fn(async () => { installed = { version: "2.0.0", linked: false }; });
    const check = vi.fn(async () => ({ ok: true, server: "fixture", version: "2.0.0", tools: 3, toolNames: ["db-one__db_query", "db-two__db_query", "ssh-one__ssh_exec"], exitCode: 0, stderr: [] }));
    const options = { find, latest, install, check, legacy: () => [] };
    const registry = new Registry([], path.join(directory, "registry.json"), options);
    registry.register(["cursor"]);
    registry.write("db", "db-one", { command: "akms-mcp-db", args: [], env: { DB_PASSWORD: "private-value" } });
    registry.write("db", "db-two", { command: "akms-mcp-db", args: [], env: { DB_PASSWORD: "private-value" } });
    registry.write("ssh", "ssh-one", { command: "akms-mcp-ssh", args: [], env: { SSH_HOST: "fixture.invalid" } });
    return { registry, options, latest, install, check };
}

describe("Runtime updates", () => {
    it("opens the menu and a kind's config without asking npm", () => {
        const values = fixture();
        new ManagedSession({ kind: "db", targets: [], registryPath: values.registry.file, runtimeOptions: values.options });
        runtimeNotice(values.registry);
        expect(values.latest).not.toHaveBeenCalled();
    });
    it("marks the menu row when the installed runtime is older than this setup, or missing", () => {
        expect(runtimeNotice(fixture("0.0.1").registry)).toEqual({ hint: "@akms/mcp 0.0.1", notice: `Update available ${PACKAGE_VERSION}` });
        expect(runtimeNotice(fixture("999.0.0").registry)).toEqual({ hint: "@akms/mcp 999.0.0" });
        expect(runtimeNotice(fixture("0.0.1", true).registry)).toEqual({ hint: "@akms/mcp 0.0.1 · development link" });
        expect(runtimeNotice(fixture(null).registry)).toEqual({ hint: "@akms/mcp", notice: "Not installed" });
    });
    it("checks npm once on request and then offers the newer release", async () => {
        const values = fixture();
        const text = await screen(["check", "b"], values.registry);
        expect(values.latest).toHaveBeenCalledTimes(1);
        expect(text).toContain("Check for updates");
        expect(text).toContain("Update to 2.0.0");
        expect(values.install).not.toHaveBeenCalled();
        expect(text).not.toContain("\u001b");
    });
    it("reports up to date when npm has nothing newer", async () => {
        const values = fixture("2.0.0");
        const text = await screen(["check", "b"], values.registry);
        expect(text).toContain("Up to date");
        expect(text).not.toContain("Update to");
    });
    it("never offers an update for a development link", async () => {
        const text = await screen(["b"], fixture("1.0.0", true).registry);
        expect(text).toContain("development link");
        expect(text).not.toContain("Check for updates");
        expect(text).not.toContain("Update to");
    });
    it("updates once, checks each grouped entry once and leaves the catalog unchanged", async () => {
        const values = fixture(); const before = fs.readFileSync(values.registry.file, "utf8");
        const text = await screen(["check", "update", "b"], values.registry);
        expect(values.install).toHaveBeenCalledExactlyOnceWith();
        expect(values.latest).toHaveBeenCalledTimes(1);
        expect(values.check).toHaveBeenCalledTimes(2);
        expect(text).toContain("Installed @akms/mcp 2.0.0");
        expect(text).toContain("OK akms_db: fixture@2.0.0, 3 tools");
        expect(text).toContain("Reconnect or restart");
        expect(fs.readFileSync(values.registry.file, "utf8")).toBe(before);
    });
    it("installs a missing runtime from the first row", async () => {
        const values = fixture(null);
        const text = await screen(["install", "b"], values.registry);
        expect(values.install).toHaveBeenCalledOnce();
        expect(text).toContain("not installed");
        expect(text).toContain("Installed @akms/mcp 2.0.0");
    });
    it("masks saved secrets in a failed update", async () => {
        const values = fixture(); values.options.install = vi.fn(async () => { throw new Error("fixture private-value"); });
        const text = await screen(["check", "update", "b"], values.registry);
        expect(text).toContain("Failed");
        expect(text).not.toContain("private-value");
        expect(values.check).not.toHaveBeenCalled();
    });
    it.each(["EBUSY", "EPERM", "EACCES"])("asks users to close AI clients before retrying an npm %s failure", async code => {
        const values = fixture(); values.options.install = vi.fn(async () => { throw new Error(`npm ${code}: fixture file is locked`); });
        const text = await screen(["check", "update", "b"], values.registry);
        expect(text).toContain(code);
        expect(text).toContain("Close your AI clients, then retry");
    });
    it("says npm could not be reached and offers no update when offline", async () => {
        const values = fixture(); values.options.latest = vi.fn(async () => null);
        const text = await screen(["check", "b"], values.registry);
        expect(text).toContain("Could not reach npm");
        expect(text).not.toContain("Update to");
        expect(values.install).not.toHaveBeenCalled();
    });
    it("queries npm for @akms/mcp with bounded fresh metadata and treats errors, invalid output and timeouts as unavailable", async () => {
        const npm = path.join(directory, "npm-cli.js"), calls = path.join(directory, "npm-calls.json");
        fs.writeFileSync(path.join(directory, "package.json"), '{"type":"commonjs"}');
        fs.writeFileSync(npm, `require('fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))); process.stdout.write(JSON.stringify('3.4.5'));`);
        vi.stubEnv("npm_execpath", npm);
        expect(await latestRuntimeVersion()).toBe("3.4.5");
        expect(JSON.parse(fs.readFileSync(calls, "utf8"))).toEqual(["view", "@akms/mcp@latest", "version", "--json", "--prefer-online", "--fetch-retries=0", "--fetch-timeout=4000"]);
        for(const code of ["process.exit(1)", "process.stdout.write('not json')", "setInterval(() => {}, 1000)"]) {
            fs.writeFileSync(npm, code); expect(await latestRuntimeVersion(300)).toBeNull();
        }
    });
});
