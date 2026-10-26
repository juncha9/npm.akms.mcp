import fs from "node:fs";
import { removeTempDirectory } from "../support/remove-temp-directory";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "@/modules/registration/registry";
import { ManagedSession } from "@/modules/registration/menu";
import { migrationMenu } from "@/modules/registration/migration-menu";
import { runtimeMenu } from "@/modules/registration/runtime-menu";
import { Prompter } from "@/modules/registration/prompter";
import type { McpKind, McpServerEntry, ConfigTarget } from "@/modules/registration/types";

let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "akms-migration-")); vi.stubEnv("AKMS_MCP_HOME", directory); });
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await removeTempDirectory(directory, "akms-migration-");
}, 15_000);
// The bin form is a standard launch that is not tied to a per-kind package, so only the layout steps apply.
const entry = (kind: McpKind = "db"): McpServerEntry => ({ command: `akms-mcp-${kind}`, args: [], env: { [`${kind.toUpperCase()}_PASSWORD`]: "fixture-private-secret" } });
const legacyEntry = (kind: McpKind = "db"): McpServerEntry => ({ command: "npx", args: ["-y", `@akms/mcp-${kind}`], env: { [`${kind.toUpperCase()}_PASSWORD`]: "fixture-private-secret" } });
const runtimeScript = (kind: McpKind) => path.join(directory, "runtime/node_modules/@akms/mcp/lib", `${kind}.js`);
function fixture() {
    const targets: ConfigTarget[] = ["cursor", "codex"].map(id => {
        const file = path.join(directory, id + ".json");
        const read = (): Record<string, McpServerEntry> => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
        return { id: id as "cursor" | "codex", label: id, location: file, detected: true, readEntries: read,
            writeEntry: vi.fn((name, value) => { fs.writeFileSync(file, JSON.stringify({ ...read(), [name]: value })); return { status: "written" as const, detail: file }; }),
            removeEntry: vi.fn(name => { const entries = read(); delete entries[name]; fs.writeFileSync(file, JSON.stringify(entries)); return { status: "written" as const, detail: file }; }) };
    });
    const file = path.join(directory, "registry.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, clients: [], connections: {} }));
    const options: Registry["runtimeOptions"] = {
        find: kind => ({ command: process.execPath, args: [runtimeScript(kind)], version: "1.0.0", linked: false }),
        check: vi.fn(async () => ({ ok: true, server: "fixture", version: "1.0.0", tools: 3, toolNames: ["alpha__db_query", "beta__db_query", "db_catalog_status"], exitCode: 0, stderr: [] })),
    };
    const registry = new Registry(targets, file, options); registry.register(["cursor", "codex"]); registry.write("db", "alpha", entry()); registry.write("db", "beta", entry());
    return { registry, targets, options, backup: path.join(directory, "registry.previous.json") };
}
const clearWrites = (targets: ConfigTarget[]) => targets.forEach(target => { vi.mocked(target.writeEntry).mockClear(); vi.mocked(target.removeEntry).mockClear(); });
async function screen(lines: string[], run: (prompter: Prompter) => Promise<unknown>) {
    const input = new PassThrough(), output = new PassThrough(); let text = "";
    input.end(lines.join("\n") + "\n"); output.on("data", chunk => text += chunk);
    const prompt = new Prompter(input, output); try { await run(prompt); } finally { prompt.close(); }
    return text;
}

describe("ordered registry migration", () => {
    it("previews v1 without writes, migrates all kinds, and retains one complete pre-migration revision", () => {
        const { registry, targets, backup } = fixture(); registry.write("ssh", "host", entry("ssh"));
        const before = fs.readFileSync(registry.file, "utf8"), previous = fs.readFileSync(backup, "utf8"); clearWrites(targets);
        const plan = registry.planMigration();
        expect(plan.steps.map(step => step.id)).toEqual(["v1_to_v2", "catalog_default"]);
        expect(plan.kinds.filter(item => item.status === "convert").map(item => item.kind)).toEqual(["db", "ssh"]);
        expect(fs.readFileSync(registry.file, "utf8")).toBe(before); expect(fs.readFileSync(backup, "utf8")).toBe(previous);
        for(const target of targets) expect(target.writeEntry).not.toHaveBeenCalled();
        registry.applyMigration(plan);
        expect(registry.read()).toMatchObject({ version: 2, defaultMode: "catalog" }); expect(registry.needsMigration()).toBe(false);
        for(const target of targets) expect(Object.keys(target.readEntries()).sort()).toEqual(["akms_db", "akms_ssh"]);
        expect(fs.readFileSync(backup, "utf8")).toBe(before);
    });
    it("adds only the marker to unmarked v2 db/ssh bundles without rewriting clients", () => {
        const { registry, targets, backup } = fixture(); registry.write("ssh", "host", entry("ssh"));
        registry.applySession(registry.planSession("db", "catalog")); registry.applySession(registry.planSession("ssh", "catalog"));
        const before = fs.readFileSync(registry.file, "utf8"), clients = targets.map(target => fs.readFileSync(target.location, "utf8")); clearWrites(targets);
        const plan = registry.planMigration(); expect(plan.steps.map(step => step.id)).toEqual(["catalog_default"]);
        registry.applyMigration(plan);
        expect(registry.read().defaultMode).toBe("catalog"); expect(fs.readFileSync(backup, "utf8")).toBe(before);
        targets.forEach((target, index) => { expect(target.writeEntry).not.toHaveBeenCalled(); expect(target.removeEntry).not.toHaveBeenCalled(); expect(fs.readFileSync(target.location, "utf8")).toBe(clients[index]); });
        registry.target("s3").writeEntry("bucket", entry("s3")); expect(targets[0].readEntries().akms_s3.args.at(-1)).toBe("--catalog");
    });
    it("keeps a kind explicitly switched back to individual entries", () => {
        const { registry, targets } = fixture(); registry.write("ssh", "host", entry("ssh"));
        registry.applySession(registry.planSession("db", "catalog")); registry.applySession(registry.planSession("db", "individual"));
        const plan = registry.planMigration(); expect(plan.kinds.find(item => item.kind === "db")?.status).toBe("individual");
        registry.applyMigration(plan); expect(registry.isSessionMode("db")).toBe(false); expect(registry.isSessionMode("ssh")).toBe(true);
        expect(Object.keys(targets[0].readEntries()).sort()).toEqual(["akms_ssh", "alpha", "beta"]);
    });
    it("does not retry unrelated client repairs during marker-only migration or a default change", () => {
        const { registry, targets } = fixture(); registry.applySession(registry.planSession("db", "catalog"));
        targets[0].removeEntry("akms_db"); clearWrites(targets);
        expect(registry.applyMigration(registry.planMigration())).toEqual([]); registry.setDefaultMode("individual");
        for(const target of targets) { expect(target.writeEntry).not.toHaveBeenCalled(); expect(target.removeEntry).not.toHaveBeenCalled(); }
        expect(targets[0].readEntries().akms_db).toBeUndefined(); registry.sync(); expect(targets[0].readEntries().akms_db).toBeDefined();
    });
    it("preserves missing-runtime legacy entries and lets installation plus Sync finish the conversion", () => {
        const { registry, targets, options, backup } = fixture(); const find = options.find!; options.find = () => null;
        const before = fs.readFileSync(registry.file, "utf8"), clients = targets[0].readEntries(); const plan = registry.planMigration();
        expect(plan.kinds[0]).toMatchObject({ kind: "db", status: "pending-runtime", changes: [{ client: "cursor", add: ["akms_db"], remove: ["alpha", "beta"] }, { client: "codex", add: ["akms_db"], remove: ["alpha", "beta"] }] });
        expect(registry.applyMigration(plan).some(row => row.status === "pending")).toBe(true);
        expect(targets[0].readEntries()).toEqual(clients); expect(fs.readFileSync(backup, "utf8")).toBe(before);
        options.find = find; registry.sync(); expect(Object.keys(targets[0].readEntries())).toEqual(["akms_db"]);
    });
    it("preserves external edits for Sync during migration", () => {
        const { registry, targets } = fixture(); const external = { ...entry(), env: { DB_PASSWORD: "external-private" } }; targets[0].writeEntry("alpha", external);
        const plan = registry.planMigration(); expect(plan.kinds[0].session?.changes[0].review).toContain("alpha");
        registry.applyMigration(plan); expect(targets[0].readEntries().alpha).toEqual(external); expect(targets[0].readEntries().akms_db).toBeDefined();
        registry.resolve("cursor", "alpha", external, true); expect(targets[0].readEntries().alpha).toBeUndefined();
    });
    it("rejects stale previews and changed runtime availability before modifying the registry", () => {
        const { registry, options } = fixture(); const old = registry.planMigration(); registry.write("db", "third", entry());
        expect(() => registry.applyMigration(old)).toThrow(/changed since review/);
        const before = fs.readFileSync(registry.file, "utf8"), find = options.find!; options.find = () => null;
        const missing = registry.planMigration(); options.find = find;
        expect(() => registry.applyMigration(missing)).toThrow(/availability changed/); expect(fs.readFileSync(registry.file, "utf8")).toBe(before);
    });
    it("does nothing when applied again, including after explicitly turning the default off", () => {
        const { registry, targets, backup } = fixture(); registry.applyMigration(registry.planMigration());
        const before = fs.readFileSync(registry.file, "utf8"), previous = fs.readFileSync(backup, "utf8"); clearWrites(targets);
        expect(registry.applyMigration(registry.planMigration())).toEqual([]); expect(fs.readFileSync(registry.file, "utf8")).toBe(before); expect(fs.readFileSync(backup, "utf8")).toBe(previous);
        for(const target of targets) { expect(target.writeEntry).not.toHaveBeenCalled(); expect(target.removeEntry).not.toHaveBeenCalled(); }
        registry.setDefaultMode("individual"); expect(registry.needsMigration()).toBe(false); expect(registry.planMigration().steps).toEqual([]);
    });
    it("shows the config notice and action only for an older format", async () => {
        const { registry, targets, options } = fixture(); const management = new ManagedSession({ kind: "db", targets, registryPath: registry.file, runtimeOptions: options });
        const status = () => screen([], prompt => { management.writeStatus(prompt); return Promise.resolve(); });
        expect(await status()).toContain("Registry update available. Choose Migrate registry in the AKMS MCP menu.");
        registry.applyMigration(registry.planMigration());
        expect(await status()).not.toContain("Registry update available");
    });
    it("defaults the migration preview to No, then probes the approved session tools", async () => {
        const { registry, options, backup } = fixture(); const before = fs.readFileSync(registry.file, "utf8");
        const declined = await screen([""], prompt => migrationMenu(prompt, registry)); expect(declined).toContain("Migrate the registry and apply these changes? (y/N)");
        expect(fs.readFileSync(registry.file, "utf8")).toBe(before); expect(options.check).not.toHaveBeenCalled();
        const applied = await screen(["y"], prompt => migrationMenu(prompt, registry)); expect(applied).toContain("Registry migration saved"); expect(applied).toContain("OK akms_db"); expect(applied).not.toContain("fixture-private-secret");
        expect(options.check).toHaveBeenCalledTimes(1); expect(fs.readFileSync(backup, "utf8")).toBe(before);
    });
    it("turns the future-kind default off and on from Runtime while preserving existing modes", async () => {
        const { registry, targets } = fixture(); expect(() => registry.setDefaultMode("individual")).toThrow(/Migrate registry/); registry.applyMigration(registry.planMigration());
        await screen(["layout", "default", "", "b", "b"], prompt => runtimeMenu(prompt, registry)); expect(registry.read().defaultMode).toBe("catalog");
        await screen(["layout", "default", "y", "b", "b"], prompt => runtimeMenu(prompt, registry)); expect(registry.read().defaultMode).toBe("individual"); expect(registry.isSessionMode("db")).toBe(true);
        registry.target("ssh").writeEntry("host", entry("ssh")); expect(targets[0].readEntries().host).toBeDefined();
        registry.setDefaultMode("catalog"); expect(registry.isSessionMode("ssh")).toBe(false); registry.target("s3").writeEntry("bucket", entry("s3")); expect(targets[0].readEntries().akms_s3).toBeDefined();
    });
    it("blocks invalid-name migration and refuses to change a pending kind's implicit mode", async () => {
        const { registry, options } = fixture(); const state = registry.read(); state.connections["x".repeat(36)] = state.connections.alpha; delete state.connections.alpha;
        fs.writeFileSync(registry.file, JSON.stringify(state)); const before = fs.readFileSync(registry.file, "utf8");
        const plan = registry.planMigration(); expect(plan.kinds[0].status).toBe("blocked"); expect(() => registry.applyMigration(plan)).toThrow(/Resolve blocked/);
        expect(await screen([], prompt => migrationMenu(prompt, registry))).toContain("Resolve blocked kinds"); expect(fs.readFileSync(registry.file, "utf8")).toBe(before);
        delete state.connections["x".repeat(36)]; fs.writeFileSync(registry.file, JSON.stringify(state)); options.find = () => null;
        registry.applyMigration(registry.planMigration()); expect(() => registry.setDefaultMode("individual")).toThrow(/pending runtimes/); expect(registry.read().defaultMode).toBe("catalog");
    });
});

describe("moving 0.3 launches to the single @akms/mcp package", () => {
    const legacyScript = (kind: McpKind) => path.join(directory, "runtime/node_modules/@akms", `mcp-${kind}`, "lib/cli.js");
    /** A 0.3.x catalog: akms_db applied from the per-kind package, plus one saved npx connection. */
    function legacyFixture() {
        const values = fixture();
        const current = values.options.find!;
        values.options.find = kind => ({ command: process.execPath, args: [legacyScript(kind)], version: "0.3.2", linked: false });
        values.registry.applyMigration(values.registry.planMigration());
        values.registry.write("db", "gamma", legacyEntry());
        values.options.find = current;
        clearWrites(values.targets);
        return values;
    }
    it("offers one step, repoints the session and saved npx entries, and lets Sync rewrite the services", () => {
        const { registry, targets } = legacyFixture();
        expect(targets[0].readEntries().akms_db.args[0]).toBe(legacyScript("db"));
        const plan = registry.planMigration();
        expect(plan.steps.map(step => step.id)).toEqual(["single_package"]);
        expect(plan.launches).toEqual([{ kind: "db", names: ["akms_db", "gamma"], ready: true }]);
        expect(plan.kinds).toEqual([]);
        registry.applyMigration(plan);
        expect(registry.needsMigration()).toBe(false);
        expect(registry.read().sessions?.db?.entry.args).toEqual([runtimeScript("db"), "--catalog"]);
        expect(registry.read().connections.gamma.entry).toEqual({ command: process.execPath, args: [runtimeScript("db")], env: legacyEntry().env });
        for(const target of targets) expect(target.readEntries().akms_db.args).toEqual([runtimeScript("db"), "--catalog"]);
        expect(registry.read().connections.alpha.entry).toEqual(entry());
    });
    it("waits for @akms/mcp, and the migration screen installs it before applying", async () => {
        const { registry, options, targets } = legacyFixture();
        const find = options.find!; options.find = () => null;
        options.install = vi.fn(async () => { options.find = find; });
        expect(registry.planMigration().launches).toEqual([{ kind: "db", names: ["akms_db", "gamma"], ready: false }]);
        const declined = await screen(["n"], prompt => migrationMenu(prompt, registry));
        expect(declined).toContain("Install @akms/mcp now? (Y/n)");
        expect(declined).toContain("Nothing can be migrated until @akms/mcp is installed");
        expect(registry.needsMigration()).toBe(true);
        const applied = await screen(["", "y"], prompt => migrationMenu(prompt, registry));
        expect(options.install).toHaveBeenCalledOnce();
        expect(applied).toContain("Registry migration saved");
        expect(registry.needsMigration()).toBe(false);
        expect(targets[1].readEntries().akms_db.args[0]).toBe(runtimeScript("db"));
    });
    it("keeps old packages while anything starts them, then removes only those", async () => {
        const { registry, options } = legacyFixture();
        options.legacy = () => [{ kind: "db", packageName: "@akms/mcp-db", version: "0.3.2", linked: false }];
        options.removeLegacy = vi.fn(async () => {});
        const before = registry.legacyRuntimes()[0].usedBy;
        expect(before).toEqual(expect.arrayContaining(["AKMS catalog: akms_db", "cursor: akms_db", "codex: akms_db"]));
        await expect(registry.removeLegacyRuntimes(["db"])).rejects.toThrow(/Still in use: @akms\/mcp-db/);
        expect(await screen(["b"], prompt => runtimeMenu(prompt, registry))).toContain("In use    @akms/mcp-db 0.3.2 · old packages");
        registry.applyMigration(registry.planMigration());
        expect(registry.legacyRuntimes()[0].usedBy).toEqual([]);
        const text = await screen(["remove", "y", "b"], prompt => runtimeMenu(prompt, registry));
        expect(text).toContain("Remove these packages? (y/N)");
        expect(options.removeLegacy).toHaveBeenCalledExactlyOnceWith(["db"]);
    });
});
