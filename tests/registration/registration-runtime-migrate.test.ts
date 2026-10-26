import fs from "node:fs";
import { removeTempDirectory } from "../support/remove-temp-directory";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "@/modules/registration/registry";
import { runtimeMenu, runtimeNotice } from "@/modules/registration/runtime-menu";
import { migrationStatus } from "@/modules/registration/migration-menu";
import { Prompter } from "@/modules/registration/prompter";
import type { GlobalRuntime } from "@/modules/registration/runtime";
import type { ConfigTarget, McpKind, McpServerEntry } from "@/modules/registration/types";

const ESC = "\u001b";
/** The selectable row in line mode ("  2) Migrate registry"), not the upgrade step that names it. */
const MIGRATE_ROW = /\d\) Migrate registry/;
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "akms-runtime-migrate-")); vi.stubEnv("AKMS_MCP_HOME", directory); });
afterEach(async () => {
    vi.unstubAllEnvs();
    await removeTempDirectory(directory, "akms-runtime-migrate-");
}, 15_000);

const legacyScript = (kind: McpKind) => path.join(directory, "runtime/node_modules/@akms", `mcp-${kind}`, "lib/cli.js");
const runtimeScript = (kind: McpKind) => path.join(directory, "runtime/node_modules/@akms/mcp/lib", `${kind}.js`);
/** A 0.3.x catalog: akms_db applied from @akms/mcp-db 0.3.2, before @akms/mcp is installed. */
function fixture() {
    const targets: ConfigTarget[] = ["cursor", "codex"].map(id => {
        const file = path.join(directory, id + ".json");
        const read = (): Record<string, McpServerEntry> => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
        return { id: id as "cursor" | "codex", label: id, location: file, detected: true, readEntries: read,
            writeEntry: (name, value) => { fs.writeFileSync(file, JSON.stringify({ ...read(), [name]: value })); return { status: "written" as const, detail: file }; },
            removeEntry: name => { const entries = read(); delete entries[name]; fs.writeFileSync(file, JSON.stringify(entries)); return { status: "written" as const, detail: file }; } };
    });
    const file = path.join(directory, "registry.json");
    fs.writeFileSync(file, JSON.stringify({ version: 2, defaultMode: "catalog", clients: [], connections: {}, sessions: {} }));
    let installed: string | null = null;
    const options: Registry["runtimeOptions"] = {
        find: (kind): GlobalRuntime => ({ command: process.execPath, args: [legacyScript(kind)], version: "0.3.2", linked: false }),
        check: vi.fn(async () => ({ ok: true, server: "fixture", version: "1.0.0", tools: 1, exitCode: 0, stderr: [] })),
        legacy: () => [{ kind: "db", packageName: "@akms/mcp-db", version: "0.3.2", linked: false }],
    };
    const registry = new Registry(targets, file, options);
    registry.register(["cursor", "codex"]);
    registry.write("db", "pg_main", { command: "akms-mcp-db", args: [], env: { DB_HOST: "db.example" } });
    // From here on, `find` is the merged package: missing until install() is called.
    options.find = (kind) => installed ? { command: process.execPath, args: [runtimeScript(kind)], version: installed, linked: false } : null;
    return { registry, options, install: (version: string) => { installed = version; } };
}
async function screen(lines: string[], registry: Registry) {
    const input = new PassThrough(), output = new PassThrough(); let text = "";
    input.end(lines.join("\n") + "\n"); output.on("data", chunk => text += chunk);
    const prompter = new Prompter(input, output); try { await runtimeMenu(prompter, registry); } finally { prompter.close(); }
    return text;
}

describe("Migrate registry inside Runtime", () => {
    it("waits for @akms/mcp, saying why, and shows no Migrate row until it is installed", async () => {
        const { registry } = fixture();
        expect(migrationStatus(registry)).toEqual({ status: "waiting", detail: "Install @akms/mcp first." });
        const text = await screen(["b"], registry);
        expect(text).toContain("Upgrade steps");
        expect(text).toMatch(/1 {2}Install @akms\/mcp +next +one package for every kind/);
        expect(text).toMatch(/2 {2}Migrate registry +later +moves akms_db to @akms\/mcp/);
        expect(text).toMatch(/3 {2}Remove old packages +later/);
        expect(text).toContain("In use    @akms/mcp-db 0.3.2 · old packages");
        expect(text).not.toMatch(MIGRATE_ROW);
        expect(runtimeNotice(registry)).toEqual({ hint: "@akms/mcp", notice: "Not installed" });
    });
    it("offers Migrate first once installed, with the old and new versions, and the menu row says so", async () => {
        const { registry, install } = fixture(); install("0.4.0");
        expect(migrationStatus(registry).status).toBe("ready");
        expect(runtimeNotice(registry).notice).toContain("Registry update available");
        const text = await screen(["", "", "b"], registry);
        expect(text).toMatch(/Migrate registry +step 2 · @akms\/mcp-db 0\.3\.2 → {2}@akms\/mcp 0\.4\.0/);
        expect(text).toMatch(/1 {2}Install @akms\/mcp +done +0\.4\.0/);
        expect(text).toMatch(/2 {2}Migrate registry +next +@akms\/mcp-db 0\.3\.2 → @akms\/mcp 0\.4\.0/);
        expect(text).toContain("Choice (2)");
        expect(text).toContain("Servers   @akms/mcp-db 0.3.2 → @akms/mcp 0.4.0");
        expect(text).toContain("Migrate the registry and apply these changes? (y/N)");
    });
    it("hides the row after migrating", async () => {
        const { registry, install } = fixture(); install("0.4.0");
        await screen(["migrate", "y", "b"], registry);
        expect(migrationStatus(registry).status).toBe("none");
        const text = await screen(["b"], registry);
        expect(text).not.toMatch(MIGRATE_ROW);
        // The old package is no longer used: step 3 is next and its row starts under the cursor.
        expect(text).toMatch(/2 {2}Migrate registry +done/);
        expect(text).toMatch(/3 {2}Remove old packages +next +then restart your AI clients/);
        expect(text).toContain("Remove old packages  step 3 · @akms/mcp-db");
        expect(runtimeNotice(registry)).toEqual({ hint: "@akms/mcp 0.4.0" });
    });
    it("hides the row and names the reason when a connection blocks the format upgrade", async () => {
        const { registry, install } = fixture(); install("0.4.0");
        fs.writeFileSync(registry.file, JSON.stringify({ version: 1, clients: ["cursor"], connections: { ["x".repeat(36)]: { kind: "db", entry: { command: "akms-mcp-db", args: [], env: {} }, applied: {} } } }));
        expect(migrationStatus(registry).status).toBe("blocked");
        const text = await screen(["b"], registry);
        expect(text).toMatch(/2 {2}Migrate registry +blocked +Connection names must use/);
        expect(text).not.toMatch(MIGRATE_ROW);
        expect(runtimeNotice(registry).notice).toBe("Registry update blocked");
    });
    it("draws the destination version in green on a terminal", async () => {
        vi.stubEnv("NO_COLOR", undefined);
        const { registry, install } = fixture(); install("0.4.0");
        const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {} });
        const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100 });
        let text = ""; output.on("data", chunk => text += chunk);
        const prompter = new Prompter(input, output);
        const running = runtimeMenu(prompter, registry);
        await new Promise(resolve => setImmediate(resolve));
        input.write(ESC);
        await running; prompter.close();
        expect(text).toContain(`${ESC}[32m  @akms/mcp 0.4.0${ESC}[39m`);
        expect(text).toContain(`${ESC}[33m@akms/mcp-db 0.3.2${ESC}[39m`);
    });
});
