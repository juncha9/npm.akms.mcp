import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    for(const directory of temporaryDirectories.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

async function runCli(options: { argumentsList: string[]; input?: string; environment?: NodeJS.ProcessEnv }) {
    const directory = await mkdtemp(join(tmpdir(), "akms-mcp-cli-test-"));
    temporaryDirectories.push(directory);
    const record = join(directory, "calls.jsonl");
    const environment = { ...process.env };
    for(const key of Object.keys(environment)) {
        if(key.toLowerCase() === "npm_execpath" || key.startsWith("AKMS_TEST_") == true) {
            delete environment[key];
        }
    }
    const child = spawn(process.execPath, [resolve("lib/cli.js"), ...options.argumentsList], {
        env: {
            ...environment,
            npm_execpath: resolve("tests/fixtures/npm-cli.js"),
            AKMS_TEST_RECORD: record,
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
    return { code, output, calls };
}

describe("built CLI process boundary", () => {
    it("prints help and version without resolving or launching a package", async () => {
        const help = await runCli({ argumentsList: ["--help"] });
        expect(help.code).toBe(0);
        expect(help.output).toContain("akms-mcp [setup|config]");
        expect(help.calls).toEqual([]);
        const version = await runCli({ argumentsList: ["--version"] });
        expect(version.output.trim()).toBe("0.1.0");
        expect(version.calls).toEqual([]);
    }, 20_000);

    it.each(["db", "ssh"])("launches the resolved %s version with config", async (id) => {
        const result = await runCli({ argumentsList: [id, "--target", "codex"], input: "quit\n" });
        expect(result.code).toBe(0);
        expect(result.calls[0].slice(0, 3)).toEqual(["view", `@akms/mcp-${id}@latest`, "version"]);
        expect(result.calls[1]).toContain(`--package=@akms/mcp-${id}@9.8.7`);
        expect(result.calls[1].slice(-5)).toEqual(["--", `akms-mcp-${id}`, "config", "--target", "codex"]);
        expect(result.output).toContain('CHILD_INPUT:"quit\\n"');
        const cacheIndex = result.calls[0].indexOf("--cache");
        expect(existsSync(result.calls[0][cacheIndex + 1])).toBe(false);
    }, 20_000);

    it("launches WSL on Windows and rejects it elsewhere", async () => {
        const result = await runCli({ argumentsList: ["wsl"], input: "quit\n" });
        if(process.platform === "win32") {
            expect(result.code).toBe(0);
            expect(result.calls[1].slice(-3)).toEqual(["--", "akms-mcp-wsl", "config"]);
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
        const result = await runCli({ argumentsList: ["db"], environment: { AKMS_TEST_FAIL_LOOKUP: "1" } });
        expect(result.code).toBe(1);
        expect(result.calls).toHaveLength(1);
        expect(result.output).toContain("setup was not started");
    }, 20_000);

    it("propagates a setup failure in direct mode", async () => {
        const result = await runCli({ argumentsList: ["ssh"], environment: { AKMS_TEST_EXIT_CODE: "7" } });
        expect(result.code, JSON.stringify(result)).toBe(7);
    }, 20_000);
});
