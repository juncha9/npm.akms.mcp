import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { KINDS } from "./types";
import type { McpKind, McpServerEntry } from "./types";

export interface LaunchCommand { command: string; args: string[] }
export interface GlobalRuntime extends LaunchCommand { version: string; linked: boolean }
/** A separate per-kind package left in the runtime directory by 0.3.x or earlier. */
export interface LegacyRuntime { kind: McpKind; packageName: string; version: string; linked: boolean }

/** One package carries the menu and every kind's server since 0.4.0. */
export const PACKAGE_NAME = "@akms/mcp";
/** The separate per-kind packages of 0.3.x and earlier; their entries are still recognized so they can be migrated. */
export const legacyPackageName = (kind: McpKind) => `@akms/mcp-${kind}`;
const binary = (command: string) => command.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
const posixPath = (value: string | undefined) => value?.replace(/\\/g, "/") ?? "";
const isNode = (command: string) => /^(node|nodejs)(\.exe)?$/.test(binary(command));
const isCurrentScript = (script: string | undefined, kind: McpKind) => posixPath(script).endsWith(`/node_modules/@akms/mcp/lib/${kind}.js`);
const isLegacyScript = (script: string | undefined, kind: McpKind) => posixPath(script).endsWith(`/node_modules/@akms/mcp-${kind}/lib/cli.js`);
const isLegacyPackageArgument = (argument: string, kind: McpKind) => new RegExp(`^@akms/mcp-${kind}(?:@[^\\s]+)?$`).test(argument);

export function runtimePrefix(): string {
    return path.join(process.env.AKMS_MCP_HOME ? path.resolve(process.env.AKMS_MCP_HOME) : path.join(os.homedir(), ".akms", "mcp"), "runtime");
}

export function runtimeRoot(prefix = runtimePrefix(), platform = process.platform): string {
    return path.join(prefix, ...(platform === "win32" ? [] : ["lib"]), "node_modules");
}

export const runtimeInstallCommand = () => `npm install --global --prefix "${runtimePrefix()}" ${PACKAGE_NAME}@latest`;

/** Called only from Runtime's "Check for updates", never during menu/server startup. */
export async function latestRuntimeVersion(timeoutMs = 6000): Promise<string | null> {
    try {
        const { stdout } = await promisify(execFile)(process.execPath, [npmCli(), "view", `${PACKAGE_NAME}@latest`, "version", "--json", "--prefer-online", "--fetch-retries=0", "--fetch-timeout=4000"], {
            windowsHide: true, timeout: timeoutMs, maxBuffer: 65_536,
        });
        const version: unknown = JSON.parse(stdout);
        return typeof version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) ? version : null;
    } catch { return null; }
}

/** Semver precedence, ignoring build metadata; unknown versions are not auto-updated. */
export function runtimeIsOlder(installed: string, current: string): boolean {
    const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    const left = parse(installed), right = parse(current);
    if(!left || !right) return false;
    for(let index = 1; index <= 3; index++) {
        if(BigInt(left[index]) !== BigInt(right[index])) return BigInt(left[index]) < BigInt(right[index]);
    }
    if(!left[4] || !right[4]) return Boolean(left[4] && !right[4]);
    const a = left[4].split("."), b = right[4].split(".");
    for(let index = 0; index < Math.max(a.length, b.length); index++) {
        if(a[index] === b[index]) continue;
        if(a[index] === undefined || b[index] === undefined) return a[index] === undefined;
        const numericA = /^\d+$/.test(a[index]), numericB = /^\d+$/.test(b[index]);
        if(numericA && numericB) return BigInt(a[index]) < BigInt(b[index]);
        if(numericA !== numericB) return numericA;
        return a[index] < b[index];
    }
    return false;
}

/** Recognizes saved direct paths even when an installation has since been moved/deleted. */
export function launchKind(entry: McpServerEntry): McpKind | null {
    for(const kind of KINDS) {
        if(new RegExp(`^akms-mcp-${kind}(?:\\.cmd|\\.exe)?$`).test(binary(entry.command))
            || entry.args.some((arg) => isLegacyPackageArgument(arg, kind))) return kind;
        if(isNode(entry.command) && (isCurrentScript(entry.args[0], kind) || isLegacyScript(entry.args[0], kind))) return kind;
    }
    return null;
}

/** Extra flags, shell commands and custom wrappers need individual review. */
export function standardLaunch(entry: McpServerEntry, kind: McpKind): boolean {
    if(launchKind(entry) !== kind) return false;
    const command = binary(entry.command);
    if(isNode(entry.command)) return entry.args.length === 1 && (isCurrentScript(entry.args[0], kind) || isLegacyScript(entry.args[0], kind));
    if(new RegExp(`^akms-mcp-${kind}(?:\\.cmd|\\.exe)?$`).test(command)) return entry.args.length === 0;
    let args = entry.args;
    if(command === "cmd" || command === "cmd.exe") {
        if(args[0]?.toLowerCase() !== "/c" || !/^npx(?:\.cmd)?$/i.test(args[1] ?? "")) return false;
        args = args.slice(2);
    } else if(!/^npx(?:\.cmd)?$/.test(command)) return false;
    return args.length === 2 && ["-y", "--yes"].includes(args[0]) && isLegacyPackageArgument(args[1], kind);
}

export function catalogLaunch(entry: McpServerEntry, kind = launchKind(entry)): boolean {
    return !!kind && entry.args.length === 2 && entry.args[1] === "--catalog"
        && standardLaunch({ ...entry, args: entry.args.slice(0, 1) }, kind);
}

/** A standard launch of a separate per-kind package (npx or its runtime path) — what the 0.4 migration repoints. */
export function legacyLaunch(entry: McpServerEntry, kind = launchKind(entry)): boolean {
    if(!kind) return false;
    const launch = catalogLaunch(entry, kind) ? { ...entry, args: entry.args.slice(0, 1) } : entry;
    if(!standardLaunch(launch, kind)) return false;
    if(isNode(launch.command)) return isLegacyScript(launch.args[0], kind);
    return launch.args.some((arg) => isLegacyPackageArgument(arg, kind));
}

export function npmCli(): string {
    const candidates = [
        path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
        path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ];
    if(process.env.npm_execpath && /^(npm|npx)-cli\.js$/.test(path.basename(process.env.npm_execpath))) {
        candidates.unshift(path.join(path.dirname(process.env.npm_execpath), "npm-cli.js"));
    }
    for(const folder of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
        candidates.push(process.platform === "win32" ? path.join(folder, "node_modules", "npm", "bin", "npm-cli.js") : path.join(folder, "npm"));
    }
    for(const file of candidates) {
        try {
            const resolved = fs.realpathSync(file);
            if(resolved.endsWith(".js") && fs.statSync(resolved).isFile()) return resolved;
        } catch { /* Try the next installation; a version-manager shim is not a JS CLI. */ }
    }
    throw new Error("npm was not found. Install Node.js with npm, then reopen configuration.");
}

export function findGlobalRuntime(kind: McpKind, root?: string): GlobalRuntime | null {
    try {
        const directory = path.join(root ?? runtimeRoot(), "@akms", "mcp");
        const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
        // Kinds have no bin of their own: a 0.3.x package in the same prefix still owns akms-mcp-<kind>.
        const script = path.join(directory, "lib", `${kind}.js`);
        if(metadata.name !== PACKAGE_NAME || typeof metadata.version !== "string" || !fs.statSync(script).isFile()) return null;
        // Preserve the Node alias and package link; the runtime prefix is independent of Node versions.
        return { command: process.execPath, args: [script], version: metadata.version, linked: fs.lstatSync(directory).isSymbolicLink() };
    } catch { return null; }
}

/** Per-kind packages still present in the runtime directory. */
export function findLegacyRuntimes(root?: string): LegacyRuntime[] {
    const found: LegacyRuntime[] = [];
    for(const kind of KINDS) {
        try {
            const directory = path.join(root ?? runtimeRoot(), "@akms", `mcp-${kind}`);
            const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
            if(metadata.name !== legacyPackageName(kind)) continue;
            found.push({ kind, packageName: legacyPackageName(kind), version: typeof metadata.version === "string" ? metadata.version : "unknown", linked: fs.lstatSync(directory).isSymbolicLink() });
        } catch { /* Not installed. */ }
    }
    return found;
}

async function runNpm(argumentsList: string[], failure: string, retry: string): Promise<void> {
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort();
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    try {
        await promisify(execFile)(process.execPath, [npmCli(), ...argumentsList], {
            windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024, signal: cancellation.signal, cwd: os.homedir(),
        });
    } catch(error) {
        if(cancellation.signal.aborted) throw new Error("AKMS runtime installation cancelled.");
        const stderr = (error as { stderr?: unknown }).stderr;
        const detail = stripVTControlCharacters(typeof stderr === "string" ? stderr : error instanceof Error ? error.message : "")
            .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim().split(/\r?\n/).slice(-6).map((line) => line.slice(0, 500)).join("\n");
        throw new Error(`${failure} Run ${retry} in your terminal and retry.${detail ? `\n\n${detail}` : ""}`);
    } finally {
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
    }
}

/** Management-only. No npm process is started by a configured MCP server. */
export async function installGlobalRuntime(): Promise<void> {
    await runNpm(["install", "--global", "--prefix", runtimePrefix(), "--prefer-online", "--no-fund", "--no-audit", `${PACKAGE_NAME}@latest`],
        "AKMS runtime installation failed.", runtimeInstallCommand());
}

/** Removes per-kind packages; a linked one loses only its link, never the checkout it points to. */
export async function removeLegacyRuntimes(kinds: McpKind[]): Promise<void> {
    if(!kinds.length) return;
    const names = kinds.map(legacyPackageName);
    await runNpm(["uninstall", "--global", "--prefix", runtimePrefix(), "--no-fund", "--no-audit", ...names],
        "Removing the old packages failed.", `npm uninstall --global --prefix "${runtimePrefix()}" ${names.join(" ")}`);
}

/** Forms use an installed runtime; the bare command is only a not-yet-installed draft. */
export function launchCommand(kind: McpKind): LaunchCommand {
    const runtime = findGlobalRuntime(kind);
    return runtime ? { command: runtime.command, args: [...runtime.args] } : { command: `akms-mcp-${kind}`, args: [] };
}
