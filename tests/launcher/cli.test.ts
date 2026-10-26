import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    for(const directory of temporaryDirectories.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

async function runCli(options: { argumentsList: string[]; input?: string; environment?: NodeJS.ProcessEnv; installed?: string[] }) {
    const directory = await mkdtemp(join(tmpdir(), "akms-mcp-cli-test-"));
    temporaryDirectories.push(directory);
    const record = join(directory, "calls.jsonl");
    const runtimeRecord = join(directory, "runtime-calls.jsonl");
    for(const id of options.installed ?? ["db", "ssh", "wsl", "s3"]) {
        const root = join(directory, "runtime", ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@akms", `mcp-${id}`);
        await mkdir(join(root, "lib"), { recursive: true });
        await writeFile(join(root, "package.json"), JSON.stringify({ name: `@akms/mcp-${id}`, version: "1.2.3", type: "module", bin: { [`akms-mcp-${id}`]: "lib/cli.js" } }));
        await writeFile(join(root, "lib/cli.js"), await readFile(new URL("./fixtures/runtime-cli.js", import.meta.url)));
    }
    const environment = { ...process.env };
    for(const key of Object.keys(environment)) {
        if(key.toLowerCase() === "npm_execpath" || key.startsWith("AKMS_TEST_") == true) {
            delete environment[key];
        }
    }
    const child = spawn(process.execPath, [process.env.AKMS_TEST_BUILT_CLI ?? resolve("lib/cli.js"), ...options.argumentsList], {
        env: {
            ...environment,
            npm_execpath: resolve("tests/launcher/fixtures/npm-cli.js"),
            AKMS_TEST_RECORD: record,
            AKMS_TEST_RUNTIME_RECORD: runtimeRecord,
            AKMS_MCP_HOME: directory,
            HOME: directory,
            USERPROFILE: directory,
            CODEX_HOME: join(directory, ".codex"),
            APPDATA: join(directory, "AppData"),
            ...options.environment,
        },
        windowsHide: true,
        stdio: "pipe",
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.stdin.end(options.input ?? "");
    const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
    });
    let calls: string[][] = [];
    if(existsSync(record) == true) {
        const content = await readFile(record, "utf8");
        calls = content.trim().split("\n").map((line) => JSON.parse(line) as string[]);
    }
    const runtimeCalls = existsSync(runtimeRecord) ? (await readFile(runtimeRecord, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]) : [];
    return { code, output, calls, runtimeCalls };
}

describe("built CLI process boundary", () => {
    it("opens Register without resolving or installing another MCP", async () => {
        const result = await runCli({ argumentsList: ["register"], input: "q\n" });
        expect(result.code).toBe(0);
        expect(result.output).toContain("Register");
        expect(result.calls).toEqual([]);
    });
    it("prints help and version without resolving or launching a package", async () => {
        const help = await runCli({ argumentsList: ["--help"] });
        expect(help.code).toBe(0);
        expect(help.output).toContain("akms-mcp [setup|config]");
        expect(help.calls).toEqual([]);
        const version = await runCli({ argumentsList: ["--version"] });
        const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
        expect(version.output.trim()).toBe(manifest.version);
        expect(version.calls).toEqual([]);
    }, 20_000);

    it.each(["db", "ssh", "s3"])("opens installed %s setup without any npm process", async (id) => {
        const result = await runCli({ argumentsList: [id, "--target", "codex"], input: "quit\n" });
        expect(result.code).toBe(0);
        expect(result.calls).toEqual([]);
        expect(result.runtimeCalls).toEqual([["config", "--target", "codex"]]);
        expect(result.output).toContain(`Opening @akms/mcp-${id} 1.2.3`);
        expect(result.output).toContain('CHILD_INPUT:"quit\\n"');
    }, 20_000);

    it("launches WSL on Windows and rejects it elsewhere", async () => {
        const result = await runCli({ argumentsList: ["wsl"], input: "quit\n" });
        if(process.platform === "win32") {
            expect(result.code).toBe(0);
            expect(result.calls).toEqual([]);
            expect(result.runtimeCalls).toEqual([["config"]]);
        }
        else {
            expect(result.code).toBe(1);
            expect(result.calls).toEqual([]);
        }
    }, 20_000);

    it("hands piped answers from the menu to the child without losing read-ahead", async () => {
        const result = await runCli({ argumentsList: [], input: "db\nquit\n" });
        expect(result.code).toBe(0);
        expect(result.output).toContain('CHILD_INPUT:"quit\\n"');
    }, 20_000);

    it("never launches after a failed latest check", async () => {
        const result = await runCli({ argumentsList: ["db"], installed: [], input: "y\ny\n", environment: { AKMS_TEST_FAIL_INSTALL: "1", AKMS_TEST_FAIL_LOOKUP: "1" } });
        expect(result.code).toBe(1);
        expect(result.calls).toHaveLength(2);
        expect(result.calls.map((call) => call[0])).toEqual(["install", "view"]);
        expect(result.runtimeCalls).toEqual([]);
        expect(result.output).toContain("setup was not started");
    }, 20_000);

    it("propagates a setup failure in direct mode", async () => {
        const result = await runCli({ argumentsList: ["ssh"], environment: { AKMS_TEST_EXIT_CODE: "7" } });
        expect(result.code, JSON.stringify(result)).toBe(7);
    }, 20_000);

    it("installs a missing runtime on the default yes and directly opens its config", async () => {
        const result = await runCli({ argumentsList: ["db", "--target", "cursor"], installed: [], input: "\nquit\n" });
        expect(result.code, result.output).toBe(0);
        expect(result.calls.map((call) => call[0])).toEqual(["install"]);
        expect(result.calls[0]).toContain("@akms/mcp-db@latest");
        expect(result.runtimeCalls).toEqual([["config", "--target", "cursor"]]);
        expect(result.output).toContain('CHILD_INPUT:"quit\\n"');
        expect(result.output).toContain("Opening @akms/mcp-db 9.8.7");
    }, 20_000);

    it("preserves menu read-ahead through installation and child handoff", async () => {
        const result = await runCli({ argumentsList: [], installed: [], input: "db\n\nquit\n" });
        expect(result.code, result.output).toBe(0);
        expect(result.calls.map((call) => call[0])).toEqual(["install"]);
        expect(result.output).toContain('CHILD_INPUT:"quit\\n"');
    }, 20_000);

    it("does not open npm exec when installation fails and the fallback answer is blank", async () => {
        const result = await runCli({ argumentsList: ["ssh"], installed: [], input: "y\n\n", environment: { AKMS_TEST_FAIL_INSTALL: "1" } });
        expect(result.code).toBe(1);
        expect(result.calls.map((call) => call[0])).toEqual(["install"]);
        expect(result.output).toContain("registry denied installation");
        expect(result.output).toContain("npm exec instead? (y/N)");
        expect(result.runtimeCalls).toEqual([]);
    }, 20_000);

    it("opens the exact freshly checked npm setup only after fallback approval", async () => {
        const result = await runCli({ argumentsList: ["s3", "--target", "codex"], installed: [], input: "y\ny\nquit\n", environment: { AKMS_TEST_FAIL_INSTALL: "1" } });
        expect(result.code, result.output).toBe(0);
        expect(result.calls.map((call) => call[0])).toEqual(["install", "view", "exec"]);
        expect(result.calls[1].slice(0, 3)).toEqual(["view", "@akms/mcp-s3@latest", "version"]);
        expect(result.calls[2]).toContain("--package=@akms/mcp-s3@9.8.7");
        expect(result.calls[2].slice(-5)).toEqual(["--", "akms-mcp-s3", "config", "--target", "codex"]);
        expect(result.output).toContain('CHILD_INPUT:"quit\\n"');
        const cacheIndex = result.calls[1].indexOf("--cache");
        expect(existsSync(result.calls[1][cacheIndex + 1])).toBe(false);
    }, 20_000);

    it("leaves cleanly when installation is declined", async () => {
        const result = await runCli({ argumentsList: ["db"], installed: [], input: "n\n" });
        expect(result.code).toBe(0);
        expect(result.calls).toEqual([]);
        expect(result.runtimeCalls).toEqual([]);
    }, 20_000);
});
