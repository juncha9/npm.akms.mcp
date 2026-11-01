import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_VERSION } from "@/_defs";
import { runAddCommand } from "@/modules/registration/add-command";
import { Registry } from "@/modules/registration/registry";
import { createJsonFileTarget } from "@/modules/registration/targets/json-file";
import type { McpKind } from "@/modules/registration/types";
import type { StartupResult } from "@/modules/registration/startup-check";
import { ADD_FIELDS as SSH_FIELDS } from "@ssh/modules/manage/add-fields";
import { ADD_DEFAULTS as DB_DEFAULTS, ADD_FIELDS as DB_FIELDS } from "@db/modules/manage/add-fields";
import { ADD_FIELDS as WSL_FIELDS } from "@wsl/modules/manage/add-fields";
import { ADD_FIELDS as S3_FIELDS } from "@s3/modules/manage/add-fields";
import { loadHostProfile as loadSshProfile } from "@ssh/modules/config/host-profile";
import { loadDbProfile } from "@db/modules/profile";
import { loadHostProfile as loadWslProfile } from "@wsl/modules/config/host-profile";
import { loadS3Profile } from "@s3/profile";
import { Prompter } from "@ssh/modules/manage/prompter";
import { removeTempDirectory } from "../support/remove-temp-directory";

let directory: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "akms-cli-add-"));
    vi.spyOn(os, "homedir").mockReturnValue(directory);
    vi.stubEnv("AKMS_MCP_HOME", directory);
    for(const kind of ["DB", "SSH", "WSL"]) vi.stubEnv(`${kind}_MCP_LOG_LEVEL`, "silent");
});
afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await removeTempDirectory(directory, "akms-cli-add-");
});

const kinds = {
    ssh: { fields: SSH_FIELDS, validate: loadSshProfile, args: ["--host", "host.invalid", "--user", "tester"] },
    db: { fields: DB_FIELDS, defaults: DB_DEFAULTS, validate: loadDbProfile, args: ["--host", "database.invalid", "--database", "example", "--user", "tester"] },
    wsl: { fields: WSL_FIELDS, validate: loadWslProfile, args: ["--distro", "ExampleLinux"] },
    s3: { fields: S3_FIELDS, validate: loadS3Profile, args: ["--bucket", "example-bucket"] },
};
function fixture(clients: ("cursor" | "codex")[] = ["cursor", "codex"]) {
    const targets = clients.map(id => createJsonFileTarget({ id, label: id, filePath: path.join(directory, `${id}.json`) }));
    const file = path.join(directory, "registry.json");
    const options: Registry["runtimeOptions"] = {
        find: kind => ({ command: process.execPath, args: [path.join(directory, `node_modules/@akms/mcp/lib/${kind}.js`)], version: PACKAGE_VERSION, linked: false }),
        check: vi.fn(async (): Promise<StartupResult> => ({ ok: true, exitCode: 0, stderr: [], server: "fixture", version: PACKAGE_VERSION, tools: 1,
            toolNames: Object.entries(registry.read().connections).filter(([, connection]) => connection.entry).map(([name]) => `${name}__fixture`) })),
    };
    const registry = new Registry(targets, file, options);
    registry.register(clients);
    return { registry, targets, file, options };
}
type Fixture = ReturnType<typeof fixture>;
type Overrides = Partial<Pick<Parameters<typeof runAddCommand>[0], "validate" | "fields" | "defaults">>;
async function run(f: Fixture, argv: string[], kind: McpKind = "ssh", inputText = "", overrides: Overrides = {}) {
    const input = new PassThrough(), output = new PassThrough(), errors = new PassThrough();
    let stdout = "", stderr = "";
    output.on("data", chunk => { stdout += chunk; });
    errors.on("data", chunk => { stderr += chunk; });
    input.end(inputText);
    const prompter = new Prompter(input, errors);
    const code = await runAddCommand({ kind, argv, ...kinds[kind], ...overrides, prompter, output,
        targets: f.targets, registryPath: f.file, runtimeOptions: f.options });
    return { code, stdout, stderr, json: JSON.parse(stdout) };
}
const bytes = (f: Fixture) => [f.file, ...f.targets.map(target => target.location)].map(file => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

describe("non-interactive add", () => {
    it("returns one JSON result and stores credentials only in the catalog, with writable access by default", async () => {
        const f = fixture();
        const result = await run(f, ["example", ...kinds.ssh.args, "--password"], "ssh", "fixture-password\n");
        expect(result.code).toBe(0);
        expect(result.json).toMatchObject({ ok: true, saved: true, kind: "ssh", name: "example", readonly: false, server: "akms_ssh", tool_prefix: "example__", startup: true,
            services: [{ service: "cursor", entry: "akms_ssh", status: "synced" }, { service: "codex", entry: "akms_ssh", status: "synced" }] });
        expect(loadSshProfile(f.registry.read().connections.example.entry!.env)?.policy.readonly).toBe(false);
        expect(f.registry.read().connections.example.entry!.env.SSH_PASSWORD).toBe("fixture-password");
        for(const target of f.targets) {
            expect(target.readEntries().akms_ssh.env).toEqual({ AKMS_MCP_HOME: directory });
            expect(fs.readFileSync(target.location, "utf8")).not.toContain("fixture-password");
        }
        expect(result.stdout + result.stderr).not.toContain("fixture-password");
    });

    it("takes a secret at a hidden terminal prompt: the keys never reach the screen and the terminal is handed back", async () => {
        const f = fixture();
        const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
        const screen = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
        const output = new PassThrough();
        let drawn = "", stdout = "";
        screen.on("data", chunk => { drawn += chunk; });
        output.on("data", chunk => { stdout += chunk; });
        const running = runAddCommand({ kind: "ssh", argv: ["example", ...kinds.ssh.args, "--password"], ...kinds.ssh, prompter: new Prompter(input, screen), output,
            targets: f.targets, registryPath: f.file, runtimeOptions: f.options });
        for(const key of [..."typed-secret", "\r"]) {
            await new Promise(resolve => setImmediate(resolve));
            input.write(key);
        }
        expect(await running).toBe(0);
        expect(f.registry.read().connections.example.entry!.env.SSH_PASSWORD).toBe("typed-secret");
        expect(drawn).toContain("SSH password");
        expect(drawn + stdout).not.toContain("typed-secret");
        expect(input.setRawMode.mock.calls.at(-1)).toEqual([false]);
        expect(JSON.parse(stdout)).toMatchObject({ ok: true, saved: true });
    });

    it.each(["--Canary_Dash_Secret", "--Canary_Dash=Secret"])("does not repeat an unknown option, which may be a mistyped password: %s", async mistyped => {
        const f = fixture(), before = bytes(f);
        const result = await run(f, ["example", ...kinds.ssh.args, "--password", mistyped]);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.stdout + result.stderr).not.toContain("Canary");
        expect(bytes(f)).toEqual(before);
    });

    it("reports saved when a step after the first catalog save fails, and says what to do", async () => {
        const f = fixture();
        const rename = fs.renameSync;
        let catalogSaves = 0;
        const failing = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if(path.resolve(String(to)) === path.resolve(f.file) && ++catalogSaves === 2) throw Object.assign(new Error("injected fixture-password"), { code: "EIO" });
            rename(from, to);
        });
        const result = await run(f, ["example", ...kinds.ssh.args, "--password"], "ssh", "fixture-password\n");
        failing.mockRestore();
        expect(catalogSaves).toBe(2);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: true, kind: "ssh" });
        expect(result.json.next).toContain("akms-mcp sync");
        expect(result.stdout + result.stderr).not.toContain("fixture-password");
        expect(f.registry.read().connections.example.entry!.env.SSH_PASSWORD).toBe("fixture-password");
    });

    it("reports saved false when the first catalog save fails", async () => {
        const f = fixture();
        const rename = fs.renameSync;
        const failing = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if(path.resolve(String(to)) === path.resolve(f.file)) throw Object.assign(new Error("injected"), { code: "EIO" });
            rename(from, to);
        });
        const result = await run(f, ["example", ...kinds.ssh.args]);
        failing.mockRestore();
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.next).toBeUndefined();
        expect(Object.hasOwn(f.registry.read().connections, "example")).toBe(false);
    });

    // The early name check passes, then another process gets in while this one waits for a secret.
    const beforeTheLock = (action: (entry: Parameters<Registry["add"]>[2]) => void) => {
        const add = Registry.prototype.add;
        vi.spyOn(Registry.prototype, "add").mockImplementationOnce(function(this: Registry, kind, name, entry, onSaved) {
            action(entry);
            return add.call(this, kind, name, entry, onSaved);
        });
    };

    it.each([
        ["different", { SSH_HOST: "other.invalid", SSH_USER: "other" }],
        ["identical", { SSH_HOST: "host.invalid", SSH_USER: "tester" }],
    ])("reports saved false when another process saves the name first with %s settings", async (_settings, env) => {
        const f = fixture();
        beforeTheLock(entry => { f.registry.write("ssh", "example", { ...entry, env }); });
        const result = await run(f, ["example", ...kinds.ssh.args]);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.next).toBeUndefined();
        expect(result.json.error).toContain("already in use");
        expect(f.registry.read().connections.example.entry!.env).toEqual(env);
    });

    it("refuses a name that became a pending deletion while waiting, keeping its replacement", async () => {
        const f = fixture();
        beforeTheLock(() => {
            const state = JSON.parse(fs.readFileSync(f.file, "utf8"));
            state.connections.pending = { kind: "ssh", entry: null, replacement: "renamed", applied: { cursor: "a".repeat(64) } };
            fs.writeFileSync(f.file, JSON.stringify(state));
        });
        const result = await run(f, ["pending", ...kinds.ssh.args]);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.next).toBeUndefined();
        expect(f.registry.read().connections.pending).toMatchObject({ entry: null, replacement: "renamed" });
    });

    it("refuses a name waiting for removal, keeping the pending deletion", async () => {
        const f = fixture();
        const state = JSON.parse(fs.readFileSync(f.file, "utf8"));
        state.connections.pending = { kind: "ssh", entry: null, replacement: "renamed", applied: { cursor: "a".repeat(64) } };
        fs.writeFileSync(f.file, JSON.stringify(state));
        const before = bytes(f);
        const result = await run(f, ["pending", ...kinds.ssh.args]);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.error).toContain("still being removed");
        expect(bytes(f)).toEqual(before);
    });

    it("refuses an existing name without changing its credentials or readonly policy", async () => {
        const f = fixture();
        await run(f, ["example", ...kinds.ssh.args, "--readonly", "--password"], "ssh", "original-secret\n");
        const before = bytes(f);
        const result = await run(f, ["example", ...kinds.ssh.args, "--password"], "ssh", "replacement-secret\n");
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.error).toContain("already in use");
        expect(result.stderr).not.toContain("SSH password");
        expect(bytes(f)).toEqual(before);
        expect(f.registry.read().connections.example.entry!.env.SSH_READONLY).toBe("true");
    });

    it.each(["--proxy-command", "--url", "--command", "--args", "--env"])("refuses an option outside the allow-list: %s", async option => {
        const f = fixture(), before = bytes(f);
        const result = await run(f, ["example", ...kinds.ssh.args, option, "unused"]);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.error).toContain("not an option");
        expect(result.json.error).not.toContain(option);
        expect(bytes(f)).toEqual(before);
    });

    it.each(["equals", "separate"])("rejects a command-line password (%s) without echoing or saving the value", async syntax => {
        const f = fixture(), before = bytes(f), secret = "fixture-never-expose-credential";
        const password = syntax === "equals" ? [`--password=${secret}`] : ["--password", secret];
        const result = await run(f, ["example", ...kinds.ssh.args, ...password]);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.stdout + result.stderr + fs.readFileSync(f.file, "utf8")).not.toContain(secret);
        expect(bytes(f)).toEqual(before);
    });

    it.each(["", "\n"])("refuses an absent or empty stdin secret without saving", async input => {
        const f = fixture(), before = bytes(f);
        const result = await run(f, ["example", ...kinds.ssh.args, "--password"], "ssh", input);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(bytes(f)).toEqual(before);
    });

    it("does not save partially supplied secrets when stdin ends", async () => {
        const f = fixture(), before = bytes(f);
        const result = await run(f, ["example", ...kinds.ssh.args, "--password", "--passphrase"], "ssh", "fixture-first-secret\n");
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.stdout + result.stderr).not.toContain("fixture-first-secret");
        expect(bytes(f)).toEqual(before);
    });

    it.each(["ssh", "db", "wsl"] as const)("refuses a whitespace-only required connection value for %s", async kind => {
        const f = fixture(), before = bytes(f);
        const args = [...kinds[kind].args]; args[1] = "   ";
        const result = await run(f, ["example", ...args], kind);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.error).toContain("blank");
        expect(bytes(f)).toEqual(before);
    });

    it.each(["no services", "no runtime", "migration"])("refuses %s before asking for any secret or writing", async reason => {
        const f = fixture(reason === "no services" ? [] : undefined);
        if(reason === "no runtime") f.options.find = () => null;
        if(reason === "migration") fs.writeFileSync(f.file, JSON.stringify({ version: 1, clients: ["cursor"], connections: {} }));
        const before = bytes(f);
        const result = await run(f, ["example", ...kinds.ssh.args, "--password"]);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.error).toMatch(reason === "no services" ? /register/ : reason === "no runtime" ? /Install/ : /migrat/);
        expect(result.stderr).not.toContain("SSH password");
        expect(bytes(f)).toEqual(before);
    });

    it("refuses settings rejected by the real server parser without saving", async () => {
        const f = fixture(), before = bytes(f);
        const result = await run(f, ["example", ...kinds.db.args, "--port", "not-a-port", "--password"], "db", "fixture-parse-secret\n");
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: false });
        expect(result.json.error).toContain("DB_PORT");
        expect(result.stdout + result.stderr).not.toContain("fixture-parse-secret");
        expect(bytes(f)).toEqual(before);
    });

    it("keeps a saved connection but returns failure when its startup check fails, masking the report", async () => {
        const f = fixture();
        f.options.check = vi.fn(async () => ({ ok: false, exitCode: 7, detail: "failure fixture-startup-secret", stderr: ["fixture-startup-secret"] }));
        const result = await run(f, ["example", ...kinds.ssh.args, "--password"], "ssh", "fixture-startup-secret\n");
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: true, startup: false });
        expect(f.registry.read().connections.example.entry).not.toBeNull();
        expect(result.stderr).toContain("FAILED");
        expect(result.stdout + result.stderr).not.toContain("fixture-startup-secret");
    });

    it("reports an AI service conflict as unsuccessful and preserves the external entry", async () => {
        const f = fixture();
        const external = { command: "another-server", args: [], env: { KEEP: "unchanged" } };
        f.targets[0].writeEntry("akms_ssh", external);
        const result = await run(f, ["example", ...kinds.ssh.args]);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ ok: false, saved: true });
        expect(result.json.services).toContainEqual(expect.objectContaining({ service: "cursor", status: "conflict" }));
        expect(f.targets[0].readEntries().akms_ssh).toEqual(external);
    });

    it("reads multiple stdin secrets in option order rather than field-table order", async () => {
        const f = fixture();
        const result = await run(f, ["example", ...kinds.db.args, "--ssh-host", "jump.invalid", "--ssh-user", "tester", "--ssh-password", "--password", "--ssh-passphrase"], "db", "fixture-jump\nfixture-db\nfixture-passphrase\n");
        expect(result.code).toBe(0);
        expect(f.registry.read().connections.example.entry!.env).toMatchObject({ DB_SSH_PASSWORD: "fixture-jump", DB_PASSWORD: "fixture-db", DB_SSH_PASSPHRASE: "fixture-passphrase" });
        for(const secret of ["fixture-jump", "fixture-db", "fixture-passphrase"]) expect(result.stdout + result.stderr).not.toContain(secret);
    });
});

describe("kind option contracts", () => {
    const cases: { kind: McpKind; args: string[]; input?: string; expected: Record<string, string> }[] = [
        { kind: "ssh", args: ["--host", "host.invalid", "--user", "tester", "--port", "2222", "--key", "~/.ssh/example", "--passphrase", "--password", "--host-key", "SHA256:fixture", "--jump-host", "jump.invalid", "--jump-port", "2200", "--jump-user", "jump-user", "--jump-host-key", "SHA256:jump", "--readonly", "--allowed-paths", "/srv,/home/tester", "--description", "Example host"], input: "fixture-key\nfixture-login\n", expected: { SSH_READONLY: "true", SSH_JUMP_PORT: "2200", SSH_PASSWORD: "fixture-login" } },
        { kind: "db", args: ["--host", "database.invalid", "--port", "5433", "--database", "example", "--user", "tester", "--password", "--ssl", "verify", "--ssl-ca", "CA_FILE", "--ssh-host", "jump.invalid", "--ssh-port", "2222", "--ssh-user", "tester", "--ssh-key", "~/.ssh/example", "--ssh-passphrase", "--ssh-password", "--ssh-host-key", "SHA256:fixture", "--readonly", "--no-ddl", "--description", "Example database"], input: "fixture-db\nfixture-key\nfixture-jump\n", expected: { DB_DRIVER: "postgres", DB_READONLY: "true", DB_ALLOW_DDL: "false", DB_PASSWORD: "fixture-db" } },
        { kind: "wsl", args: ["--distro", "ExampleLinux", "--user", "tester", "--readonly", "--allow-windows", "--allowed-paths", "/srv,/home/tester", "--description", "Example distro"], expected: { WSL_DISTRO: "ExampleLinux", WSL_READONLY: "true", WSL_ALLOW_WINDOWS: "true" } },
        { kind: "s3", args: ["--backend", "compatible", "--bucket", "example-bucket", "--region", "us-east-1", "--endpoint", "https://storage.example.com", "--auth", "static", "--access-key-id", "--secret-access-key", "--session-token", "--prefix", "images/", "--readonly", "--local-root", "LOCAL_ROOT", "--description", "Example bucket"], input: "fixture-access\nfixture-secret\nfixture-token\n", expected: { S3_READONLY: "true", S3_AUTH: "static", S3_SESSION_TOKEN: "fixture-token" } },
    ];
    it.each(cases)("passes every $kind option through the real parser and preserves its setting", async ({ kind, args, input, expected }) => {
        const f = fixture();
        const caFile = path.join(directory, "fixture-ca.pem"); fs.writeFileSync(caFile, "synthetic CA fixture");
        const result = await run(f, ["example", ...args.map(value => value === "CA_FILE" ? caFile : value === "LOCAL_ROOT" ? directory : value)], kind, input);
        expect(result.code, result.stdout + result.stderr).toBe(0);
        const env = f.registry.read().connections.example.entry!.env;
        expect(env).toMatchObject(expected);
        const complete = {
            ssh: { SSH_HOST: "host.invalid", SSH_USER: "tester", SSH_PORT: "2222", SSH_KEY: "~/.ssh/example", SSH_PASSPHRASE: "fixture-key", SSH_PASSWORD: "fixture-login", SSH_HOST_KEY: "SHA256:fixture", SSH_JUMP_HOST: "jump.invalid", SSH_JUMP_PORT: "2200", SSH_JUMP_USER: "jump-user", SSH_JUMP_HOST_KEY: "SHA256:jump", SSH_READONLY: "true", SSH_ALLOWED_PATHS: "/srv,/home/tester", SSH_DESCRIPTION: "Example host" },
            db: { DB_DRIVER: "postgres", DB_HOST: "database.invalid", DB_PORT: "5433", DB_NAME: "example", DB_USER: "tester", DB_PASSWORD: "fixture-db", DB_SSL: "verify", DB_SSL_CA: caFile, DB_SSH_HOST: "jump.invalid", DB_SSH_PORT: "2222", DB_SSH_USER: "tester", DB_SSH_KEY: "~/.ssh/example", DB_SSH_PASSPHRASE: "fixture-key", DB_SSH_PASSWORD: "fixture-jump", DB_SSH_HOST_KEY: "SHA256:fixture", DB_READONLY: "true", DB_ALLOW_DDL: "false", DB_DESCRIPTION: "Example database" },
            wsl: { WSL_DISTRO: "ExampleLinux", WSL_USER: "tester", WSL_READONLY: "true", WSL_ALLOW_WINDOWS: "true", WSL_ALLOWED_PATHS: "/srv,/home/tester", WSL_DESCRIPTION: "Example distro" },
            s3: { S3_BACKEND: "compatible", S3_BUCKET: "example-bucket", S3_REGION: "us-east-1", S3_ENDPOINT: "https://storage.example.com", S3_AUTH: "static", S3_ACCESS_KEY_ID: "fixture-access", S3_SECRET_ACCESS_KEY: "fixture-secret", S3_SESSION_TOKEN: "fixture-token", S3_PREFIX: "images/", S3_READONLY: "true", S3_LOCAL_ROOT: directory, S3_DESCRIPTION: "Example bucket" },
        };
        expect(env).toEqual(complete[kind]);
        const fields = kinds[kind].fields.filter(field => !(kind === "s3" && field.flag === "profile"));
        for(const field of fields) {
            expect(args, field.flag).toContain(`--${field.flag}`);
            expect(env, field.env).toHaveProperty(field.env);
        }
        expect(kinds[kind].validate(env)).not.toBeNull();
    });

    it("accepts the S3 profile option with profile authentication", async () => {
        const f = fixture();
        const result = await run(f, ["example", ...kinds.s3.args, "--auth", "profile", "--profile", "example-profile"], "s3");
        expect(result.code).toBe(0);
        expect(f.registry.read().connections.example.entry!.env.S3_PROFILE).toBe("example-profile");
    });

    it("keeps AWS parser defaults and requires explicit authentication for compatible storage", async () => {
        const f = fixture();
        expect((await run(f, ["aws_example", ...kinds.s3.args], "s3")).code).toBe(0);
        expect(loadS3Profile(f.registry.read().connections.aws_example.entry!.env)).toMatchObject({ backend: "aws", auth: "default", readonly: false });
        const before = bytes(f);
        const result = await run(f, ["compatible_example", "--bucket", "example-bucket", "--backend", "compatible", "--endpoint", "https://storage.example.com", "--region", "us-east-1"], "s3");
        expect(result.code).toBe(1);
        expect(result.json.error).toContain("S3_AUTH");
        expect(bytes(f)).toEqual(before);
    });

    it.each(Object.keys(kinds) as McpKind[])("keeps writable access as the server default for %s", async kind => {
        const f = fixture();
        const result = await run(f, ["example", ...kinds[kind].args], kind);
        expect(result.code).toBe(0);
        expect(result.json.readonly).toBe(false);
        const env = f.registry.read().connections.example.entry!.env;
        if(kind === "s3") expect(loadS3Profile(env)?.readonly).toBe(false);
        else if(kind === "db") expect(loadDbProfile(env)?.policy).toMatchObject({ readonly: false, allowDdl: true });
        else if(kind === "wsl") expect(loadWslProfile(env)?.policy.readonly).toBe(false);
        else expect(loadSshProfile(env)?.policy.readonly).toBe(false);
    });

    it.each(Object.keys(kinds) as McpKind[])("has no command, args, proxy-command or URL option in %s and uses secret-only credentials", kind => {
        const fields = kinds[kind].fields;
        expect(new Set(fields.map(field => field.flag)).size).toBe(fields.length);
        for(const field of fields) {
            expect(field.flag).not.toMatch(/^(command|args|env|url|proxy-command)$/);
            expect(field.env).not.toMatch(/^(SSH_PROXY_COMMAND|DB_URL)$/);
            if(/PASSWORD|PASSPHRASE|ACCESS_KEY|SESSION_TOKEN/.test(field.env)) expect(field.type).toBe("secret");
        }
    });
});
