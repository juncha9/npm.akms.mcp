import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_VERSION } from "@/_defs";
import { Prompter, type RegistrationPrompter, type SelectItem } from "@/modules/registration/prompter";
import { registrationMenu, syncMenu } from "@/modules/registration/menu";
import { Registry, formatResults, type SyncResult } from "@/modules/registration/registry";
import type { ConfigTarget, McpKind, McpServerEntry } from "@/modules/registration/types";
import { Prompter as DbPrompter } from "@db/modules/manage/prompter";
import { Prompter as SshPrompter } from "@ssh/modules/manage/prompter";
import { Prompter as WslPrompter } from "@wsl/modules/manage/prompter";
import { Prompter as S3Prompter } from "@s3/modules/manage/prompter";
import { runConfigCommand as dbConfig } from "@db/modules/manage";
import { runConfigCommand as sshConfig } from "@ssh/modules/manage";
import { runConfigCommand as wslConfig } from "@wsl/modules/manage";
import { runConfigCommand as s3Config } from "@s3/modules/manage";
import { removeTempDirectory } from "../support/remove-temp-directory";

type Mode = "tty" | "no-color" | "pipe" | "legacy-windows";
type Screen = RegistrationPrompter & { close(): void };
type Constructor = new(input: Readable, output: Writable) => Screen;
const modes: Mode[] = ["tty", "no-color", "pipe", "legacy-windows"];
const secret = "fixture-private-password";
const captureDirectory = process.env.AKMS_UI_CAPTURE_DIR;
let directory: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "akms-c2-screens-"));
    vi.spyOn(os, "homedir").mockReturnValue(directory);
    vi.stubEnv("AKMS_MCP_HOME", directory);
    vi.stubEnv("AKMS_MCP_MENU", undefined);
});
afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
    await removeTempDirectory(directory, "akms-c2-screens-");
});

function env(mode: Mode): void {
    vi.stubEnv("NO_COLOR", mode === "no-color" ? "1" : undefined);
    for(const key of ["WT_SESSION", "TERMINAL_EMULATOR", "ConEmuTask"]) vi.stubEnv(key, undefined);
    vi.stubEnv("TERM_PROGRAM", mode === "legacy-windows" ? undefined : "vscode");
    if(mode === "legacy-windows") vi.stubGlobal("process", { ...process, platform: "win32" });
}

function streams(mode: Mode) {
    env(mode);
    const tty = mode !== "pipe";
    const input = Object.assign(new PassThrough(), { isTTY: tty, setRawMode: () => {} });
    const output = Object.assign(new PassThrough(), { isTTY: tty, columns: 120 });
    let text = "";
    output.on("data", chunk => { text += chunk; });
    return { input, output, text: () => text };
}

/** Capture the description panel immediately before a prompt, without changing its answers. */
function panel(mode: Mode, select: string[], confirm: boolean[] = [], Ctor: Constructor = Prompter) {
    const io = streams(mode), prompt = new Ctor(io.input, io.output);
    let start = 0;
    const frames = new Map<string, string>();
    vi.spyOn(prompt, "clearScreen").mockImplementation(() => { start = io.text().length; });
    vi.spyOn(prompt, "acknowledge").mockResolvedValue();
    vi.spyOn(prompt, "select").mockImplementation((async <T extends string>(question: string, items: SelectItem<T>[]) => {
        frames.set(question, io.text().slice(start) + `? ${question}\n`);
        const answer = select.shift();
        expect(items.some(item => "value" in item && item.value === answer), `Unexpected ${question} answer ${answer}`).toBe(true);
        return answer as T;
    }) as Screen["select"]);
    vi.spyOn(prompt, "askYesNo").mockImplementation(async (question, fallback) => {
        frames.set(question, io.text().slice(start) + `? ${question} (${fallback ? "Y/n" : "y/N"})\n`);
        const answer = confirm.shift();
        expect(answer, `Unexpected confirmation: ${question}`).not.toBeUndefined();
        return answer!;
    });
    return { prompt, frames };
}

function entry(kind: McpKind): McpServerEntry {
    const values = {
        db: { DB_DRIVER: "postgres", DB_HOST: "database.invalid", DB_NAME: "fixture", DB_USER: "fixture", DB_PASSWORD: secret },
        ssh: { SSH_HOST: "host.invalid", SSH_USER: "fixture", SSH_PASSWORD: secret, SSH_DESCRIPTION: "Saved host" },
        wsl: { WSL_DISTRO: "FixtureLinux" },
        s3: { S3_BUCKET: "fixture-bucket", S3_REGION: "us-east-1" },
    };
    return { command: "npx", args: ["-y", `@akms/mcp-${kind}`], env: { ...values[kind] } };
}

function fixture(counts: Partial<Record<McpKind, number>>, installed = false) {
    const original = Object.fromEntries(Object.entries(counts).flatMap(([kind, count]) => Array.from({ length: count }, (_, index) => [`${kind}_${index + 1}`, entry(kind as McpKind)])));
    const targets: ConfigTarget[] = ["claude-code", "codex"].map(id => {
        let entries: Record<string, McpServerEntry> = structuredClone(original);
        return { id: id as "claude-code" | "codex", label: id === "codex" ? "Codex" : "Claude Code", location: path.join(directory, `${id}.json`), detected: true,
            readEntries: () => structuredClone(entries),
            writeEntry: vi.fn((name, value) => { entries[name] = structuredClone(value); return { status: "written" as const, detail: "fixture" }; }),
            removeEntry: vi.fn(name => { delete entries[name]; return { status: "written" as const, detail: "fixture" }; }),
        };
    });
    const runtimeOptions: Registry["runtimeOptions"] = { find: kind => installed ? { command: process.execPath, args: [path.join(directory, `node_modules/@akms/mcp/lib/${kind}.js`)], version: PACKAGE_VERSION, linked: false } : null };
    const registry = new Registry(targets, path.join(directory, "registry.json"), runtimeOptions);
    const register = () => registry.register(["claude-code", "codex"], [], registry.planRegistration(["claude-code", "codex"]).imports);
    return { registry, targets, runtimeOptions, register };
}

function record(name: string, mode: Mode, text: string): string {
    const plain = stripVTControlCharacters(text);
    expect(plain).not.toContain(secret);
    const styled = /\u001b\[[0-9;]*m/.test(text);
    expect(styled).toBe(mode === "tty" || mode === "legacy-windows");
    if(captureDirectory) {
        fs.mkdirSync(captureDirectory, { recursive: true });
        fs.writeFileSync(path.join(captureDirectory, `${name}.${mode}.ansi.txt`), text);
        fs.writeFileSync(path.join(captureDirectory, `${name}.${mode}.txt`), plain);
    }
    return plain;
}

describe("C2 description panels", () => {
    it("reviews ten connections with kind counts, replacement names and one privacy warning; plain modes preserve every character", async () => {
        const f = fixture({ db: 6, ssh: 4 });
        const initial = f.targets.map(target => target.readEntries());
        let baseline: string | undefined;
        for(const mode of modes) {
            const p = panel(mode, ["claude-code", "codex", "apply", "back"], [false]);
            try {
                await registrationMenu(p.prompt, f.registry);
                const frame = p.frames.get("Apply this registration?")!;
                const plain = record("register-review", mode, frame);
                expect(plain).toMatch(/Services\s+Claude Code · Codex/);
                expect(plain).toMatch(/Connections\s+10\s+\(Database 6 · SSH 4\)/);
                expect(plain).toMatch(/Entries\s+akms_db · akms_ssh\s+in each service/);
                expect(plain).toMatch(/Replaces\s+10 individual entries\s+with akms_db · akms_ssh/);
                expect(plain.split("\n").filter(line => line.startsWith("!"))).toHaveLength(1);
                expect(plain).toContain("registry.json + registry.previous.json. Do not share, sync or commit.");
                expect(plain).not.toContain("Services use one session entry");
                if(baseline === undefined) baseline = plain; else expect(plain).toBe(baseline);
                if(mode === "tty") { expect(frame).toContain("\u001b[2mServices"); expect(frame).toContain("\u001b[36m10"); expect(frame).toContain("\u001b[33m! Plaintext passwords"); }
            } finally { p.prompt.close(); }
        }
        expect(f.targets.map(target => target.readEntries())).toEqual(initial);
        expect(fs.existsSync(f.registry.file)).toBe(false);
    });

    it("marks an externally edited entry for review rather than promising its replacement", async () => {
        const f = fixture({ ssh: 1 }); f.register();
        for(const target of f.targets) target.writeEntry("ssh_1", { ...entry("ssh"), env: { ...entry("ssh").env, SSH_DESCRIPTION: "External version" } });
        const before = f.targets.map(target => target.readEntries());
        const p = panel("pipe", ["apply", "back"], [false]);
        try {
            await registrationMenu(p.prompt, f.registry);
            const plain = stripVTControlCharacters(p.frames.get("Apply this registration?")!);
            expect(plain).toMatch(/Kept\s+1 need a version choice\s+ssh_1/);
            expect(plain).not.toContain("Replaces");
            expect(f.targets.map(target => target.readEntries())).toEqual(before);
        } finally { p.prompt.close(); }
    });

    it("keeps result counts, retained services, warning and error meanings identical without colors", () => {
        const rows: SyncResult[] = [
            { client: "claude-code", name: "akms_ssh", kind: "ssh", status: "pending", waitingFor: "runtime", connections: ["host_1"], detail: "waiting" },
            { client: "claude-code", name: "host_1", kind: "ssh", status: "pending", waitingFor: "session", detail: "kept" },
            { client: "codex", name: "host_2", kind: "ssh", status: "error", detail: "Cannot write this service." },
            { client: "codex", name: "host_3", kind: "ssh", status: "synced", detail: "Applied" },
        ];
        let baseline: string | undefined;
        for(const mode of modes) {
            const io = streams(mode), p = new Prompter(io.input, io.output);
            try {
                p.write(formatResults(rows, "Sync results", { connectionCount: 3, paint: p.paint }));
                const plain = record("sync-results", mode, io.text());
                expect(plain).toContain("Connections: 3"); expect(plain).toContain("1 updated"); expect(plain).toContain("1 failed");
                expect(plain).toContain("Kept in Claude Code until akms_ssh is applied: host_1");
                expect(plain).not.toContain("Kept in Codex");
                if(baseline === undefined) baseline = plain; else expect(plain).toBe(baseline);
                if(mode === "tty") { expect(io.text()).toContain("\u001b[32mupdated"); expect(io.text()).toContain("\u001b[31mfailed"); expect(io.text()).toContain("\u001b[33mWaiting for runtime"); }
            } finally { p.close(); }
        }
    });

    it("shows pending imports and both descriptions while preserving the existing client entries", async () => {
        const f = fixture({ ssh: 1 }); f.register();
        f.targets[1].writeEntry("ssh_1", { ...entry("ssh"), env: { ...entry("ssh").env, SSH_DESCRIPTION: "Changed description" } });
        for(const target of f.targets) target.writeEntry("ssh_note", { ...entry("ssh"), env: { ...entry("ssh").env, SSH_DESCRIPTION: target.label } });
        const initial = f.targets.map(target => target.readEntries());
        let baseline: string | undefined;
        for(const mode of modes) {
            const p = panel(mode, ["0", "back", "back"]);
            try {
                await syncMenu(p.prompt, f.registry);
                const difference = p.frames.get("Which description should be used?")!;
                const plain = record("sync-comparison", mode, difference);
                expect(plain).toContain("Saved host"); expect(plain).toContain("Changed description");
                expect(plain).toMatch(/Server\s+akms_ssh/); expect(plain).toContain("old entry stays until this server is ready");
                const pending = record("sync-imports", mode, p.frames.get("Review differences")!);
                expect(pending).toMatch(/Not imported\s+1 connection\s+different settings/);
                if(baseline === undefined) baseline = plain; else expect(plain).toBe(baseline);
            } finally { p.prompt.close(); }
        }
        expect(f.targets.map(target => target.readEntries())).toEqual(initial);
    });
});

type Config = (options: { input: Readable; output: Writable; targets: ConfigTarget[]; registryPath: string; runtimeOptions: Registry["runtimeOptions"]; listDistros?: () => Promise<[]> }) => Promise<unknown>;
const configs: [McpKind, Constructor, Config][] = [["db", DbPrompter, dbConfig], ["ssh", SshPrompter, sshConfig], ["wsl", WslPrompter, wslConfig], ["s3", S3Prompter, s3Config]];
describe.each(configs)("%s config description panel", (kind, Ctor, run) => {
    it("emphasizes services and server names, keeps one warning line and matches all plain-output modes", async () => {
        const f = fixture({ [kind]: 1 }); f.register();
        const before = f.targets.map(target => target.readEntries());
        let baseline: string | undefined;
        for(const mode of modes) {
            const io = streams(mode);
            const select = vi.spyOn(Ctor.prototype, "select").mockResolvedValue("quit");
            try {
                await run({ input: io.input, output: io.output, targets: f.targets, registryPath: f.registry.file, runtimeOptions: f.runtimeOptions });
                const plain = record(`${kind}-config`, mode, io.text());
                expect(plain).toMatch(/Services\s+Claude Code · Codex/);
                expect(plain).toContain(`akms_${kind}`); expect(plain).toContain("npx -y @akms/mcp@latest");
                expect(plain).not.toContain(`akms-mcp-${kind}`);
                expect(plain.split("\n").filter(line => line.startsWith("!"))).toHaveLength(1);
                if(baseline === undefined) baseline = plain; else expect(plain).toBe(baseline);
            } finally { select.mockRestore(); }
        }
        expect(f.targets.map(target => target.readEntries())).toEqual(before);
    });
    if(kind !== "s3") it("keeps form instructions compact and preserves cancel behavior in every terminal mode", async () => {
        const f = fixture({}, true); f.register();
        const before = f.targets.map(target => target.readEntries());
        let baseline: string | undefined;
        for(const mode of modes) {
            const io = streams(mode), choices = ["add", "cancel", "quit"];
            let frame = "";
            const acknowledge = vi.spyOn(Ctor.prototype, "acknowledge").mockResolvedValue(undefined);
            const select = vi.spyOn(Ctor.prototype, "select").mockImplementation(async (question) => {
                const title = String(question);
                if(title.startsWith("New")) frame = io.text().slice(io.text().lastIndexOf("Select a setting to edit.")) + `? ${title}\n`;
                return choices.shift()!;
            });
            try {
                await run({ input: io.input, output: io.output, targets: f.targets, registryPath: f.registry.file, runtimeOptions: f.runtimeOptions, listDistros: async () => [] });
                const plain = record(`${kind}-form`, mode, frame);
                expect(plain).toMatch(/Text\s+Enter keeps · - clears/);
                expect(plain).toMatch(/Back\s+Esc/);
                expect(choices).toEqual([]);
                if(baseline === undefined) baseline = plain; else expect(plain).toBe(baseline);
            } finally { select.mockRestore(); acknowledge.mockRestore(); }
        }
        expect(f.targets.map(target => target.readEntries())).toEqual(before);
        expect(f.registry.read().connections).toEqual({});
    });
});
