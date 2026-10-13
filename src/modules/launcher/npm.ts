import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { MCP_PACKAGES } from "../../_defs";
import type { LaunchOptions } from "../../_types";

const execFileAsync = promisify(execFile);

export async function findNpmCli(): Promise<string> {
    const candidates: string[] = [];
    const npmExecPath = process.env.npm_execpath;
    if(npmExecPath != null && ["npm-cli.js", "npx-cli.js"].includes(basename(npmExecPath)) == true) {
        candidates.push(join(dirname(npmExecPath), "npm-cli.js"));
    }
    candidates.push(join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));
    for(const directory of (process.env.PATH ?? "").split(delimiter)) {
        if(directory === "") {
            continue;
        }
        if(process.platform === "win32") {
            candidates.push(join(directory, "node_modules", "npm", "bin", "npm-cli.js"));
        }
        else {
            candidates.push(join(directory, "npm"));
        }
    }
    for(const candidate of candidates) {
        if(existsSync(candidate) == true) {
            const resolved = await realpath(candidate);
            return resolved;
        }
    }
    throw new Error("npm could not be found. Install Node.js with npm, then reopen your terminal.");
}

export async function resolveLatestVersion(options: {
    npmCli: string;
    packageName: string;
    signal?: AbortSignal;
}): Promise<string> {
    // A new metadata cache cannot fall back to a stale latest tag after a network failure.
    const metadataCache = await mkdtemp(join(tmpdir(), "akms-mcp-latest-"));
    try {
        const result = await execFileAsync(process.execPath, [
            options.npmCli, "view", `${options.packageName}@latest`, "version", "--json",
            "--prefer-online", "--prefer-offline=false", "--offline=false",
            "--fetch-retries=0", "--fetch-timeout=15000", "--update-notifier=false",
            "--cache", metadataCache,
        ], { signal: options.signal, timeout: 20000, windowsHide: true });
        const version: unknown = JSON.parse(result.stdout);
        if(typeof version !== "string" || /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) == false) {
            throw new Error("npm returned an invalid latest version.");
        }
        return version;
    }
    finally {
        await rm(metadataCache, { recursive: true, force: true });
    }
}

export async function launchMcp(options: LaunchOptions): Promise<number> {
    const selected = MCP_PACKAGES[options.mcpId];
    if(options.mcpId === "wsl" && process.platform !== "win32") {
        throw new Error("WSL setup must run from Windows.");
    }

    const npmCli = await findNpmCli();
    const cancellation = new AbortController();
    const cancelLookup = (): void => {
        cancellation.abort();
    };
    process.on("SIGINT", cancelLookup);
    process.on("SIGTERM", cancelLookup);
    let version: string;
    try {
        process.stdout.write(`\nChecking the latest ${selected.packageName} release...\n`);
        version = await resolveLatestVersion({ npmCli: npmCli, packageName: selected.packageName, signal: cancellation.signal });
    }
    catch(error) {
        if(cancellation.signal.aborted == true) {
            return 130;
        }
        throw new Error(`Could not check the latest ${selected.packageName} release; setup was not started.\n${String(error)}`, { cause: error });
    }
    finally {
        process.off("SIGINT", cancelLookup);
        process.off("SIGTERM", cancelLookup);
    }

    const argumentsList = [
        npmCli, "exec", "--yes", "--prefer-online", "--prefer-offline=false", "--offline=false",
        `--package=${selected.packageName}@${version}`, "--", selected.command, selected.setupCommand,
    ];
    if(options.targetId != null) {
        argumentsList.push("--target", options.targetId);
    }
    process.stdout.write(`Opening ${selected.packageName} ${version}\n\n`);

    return new Promise<number>((resolve, reject) => {
        const interactiveInput = process.stdin.isTTY === true;
        let inputMode: "inherit" | "pipe" = "pipe";
        if(interactiveInput == true) {
            inputMode = "inherit";
        }
        const child = spawn(process.execPath, argumentsList, {
            stdio: [inputMode, "inherit", "inherit"],
            windowsHide: true,
        });
        const interrupt = (): void => {
            child.kill("SIGINT");
        };
        const terminate = (): void => {
            child.kill("SIGTERM");
        };
        process.on("SIGINT", interrupt);
        process.on("SIGTERM", terminate);

        if(child.stdin != null) {
            child.stdin.on("error", (error: NodeJS.ErrnoException) => {
                if(error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") {
                    reject(error);
                }
            });
            if(options.pendingInput != null) {
                child.stdin.write(options.pendingInput);
            }
            process.stdin.pipe(child.stdin);
        }
        const cleanup = (): void => {
            process.off("SIGINT", interrupt);
            process.off("SIGTERM", terminate);
            if(child.stdin != null) {
                process.stdin.unpipe(child.stdin);
                process.stdin.pause();
            }
        };
        child.once("error", (error) => {
            cleanup();
            reject(error);
        });
        child.once("close", (code, signal) => {
            cleanup();
            if(signal != null) {
                resolve(130);
                return;
            }
            resolve(code ?? 1);
        });
    });
}
