// Development-only release checks, run by prepublishOnly.
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

/** Paths the build reads: a change here changes lib/ even though the path itself is not packed. */
const BUILD_INPUTS = [/^src\//, /^package\.json$/, /^package-lock\.json$/, /^tsup\.config\.ts$/, /^tsconfig\.json$/];

function parseVersion(value) {
    if(typeof value !== "string") throw new Error("Version must be a SemVer string.");
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
    if(!match || match[4]?.split(".").some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0")) {
        throw new Error(`Invalid SemVer: ${value}`);
    }
    return { numbers: match.slice(1, 4).map(BigInt), prerelease: match[4]?.split(".") };
}

export function compareVersions(left, right) {
    const a = parseVersion(left), b = parseVersion(right);
    for(let index = 0; index < 3; index++) {
        if(a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1;
    }
    if(!a.prerelease || !b.prerelease) return a.prerelease ? -1 : b.prerelease ? 1 : 0;
    for(let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
        const x = a.prerelease[index], y = b.prerelease[index];
        if(x === y) continue;
        if(x === undefined || y === undefined) return x === undefined ? -1 : 1;
        const numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y);
        if(numericX && numericY) return BigInt(x) < BigInt(y) ? -1 : 1;
        if(numericX !== numericY) return numericX ? -1 : 1;
        return x < y ? -1 : 1;
    }
    return 0;
}

function npmCli() {
    const candidates = [
        path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
        path.join(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ];
    if(/^(npm|npx)-cli\.js$/.test(path.basename(process.env.npm_execpath ?? ""))) {
        candidates.unshift(path.join(path.dirname(process.env.npm_execpath), "npm-cli.js"));
    }
    for(const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
        candidates.push(path.join(directory, process.platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "npm"));
    }
    for(const candidate of candidates) {
        try {
            const resolved = realpathSync(candidate);
            if(resolved.endsWith(".js")) return resolved;
        } catch { /* Try the next npm installation. */ }
    }
    throw new Error("npm was not found; the release could not be checked.");
}

export async function publishedLatest(packageDirectory, name, execute = executeFile) {
    const temporaryRoot = path.resolve(os.tmpdir());
    const cache = await fs.mkdtemp(path.join(temporaryRoot, "akms-release-meta-"));
    try {
        let output;
        try {
            output = await execute(process.execPath, [npmCli(), "view", name, "dist-tags", "--json",
                "--prefer-online", "--prefer-offline=false", "--offline=false", "--fetch-retries=0",
                "--fetch-timeout=15000", "--update-notifier=false", "--cache", cache], {
                cwd: packageDirectory, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024,
            });
        } catch(error) {
            let code;
            try { code = JSON.parse(error.stdout).error?.code; } catch { /* Non-JSON registry failure. */ }
            throw new Error(`npm latest lookup failed${code ? ` (${code})` : ""}; release blocked.`);
        }
        const tags = JSON.parse(output.stdout);
        if(typeof tags?.latest !== "string") throw new Error("The package exists but has no valid latest dist-tag; release blocked.");
        parseVersion(tags.latest);
        return tags.latest;
    } finally {
        if(path.dirname(cache) !== temporaryRoot || !path.basename(cache).startsWith("akms-release-meta-")) {
            throw new Error("Refusing to remove an unexpected metadata-cache directory.");
        }
        await fs.rm(cache, { recursive: true, force: true });
    }
}

/** Files `npm pack` would include, without running the prepack build. */
export async function packedFiles(packageDirectory, execute = executeFile) {
    const output = await execute(process.execPath, [npmCli(), "pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: packageDirectory, windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    });
    const files = JSON.parse(output.stdout)?.[0]?.files;
    if(!Array.isArray(files)) throw new Error("npm pack --dry-run returned no file list.");
    return files.map((file) => file.path.replaceAll("\\", "/"));
}

/** `git status --porcelain -z` → changed paths; a rename reports both sides. */
export function statusPaths(stdout) {
    const fields = stdout.split("\0").filter(Boolean);
    const paths = [];
    for(let index = 0; index < fields.length; index++) {
        const status = fields[index].slice(0, 2);
        paths.push(fields[index].slice(3));
        if(status[0] === "R" || status[0] === "C") paths.push(fields[++index]);
    }
    return paths;
}

export async function checkRelease(packageDirectory, dependencies = {}) {
    const directory = path.resolve(packageDirectory);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
    const execute = dependencies.execute ?? executeFile;
    const checks = [];
    const check = async (name, inspect) => {
        try { checks.push({ name, passed: true, detail: await inspect() }); }
        catch(error) { checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) }); }
    };
    await check("working_tree", async () => {
        const status = await execute("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: directory, windowsHide: true, timeout: 10000 });
        const changed = statusPaths(status.stdout);
        if(changed.length === 0) return "git status is empty.";
        const packed = new Set(await (dependencies.packedFiles ?? packedFiles)(directory, execute));
        const blocking = changed.filter((file) => packed.has(file) || BUILD_INPUTS.some((pattern) => pattern.test(file)));
        if(blocking.length) {
            throw new Error(`Uncommitted changes reach the package: ${blocking.join(", ")}. Commit them before the version commit.`);
        }
        return `Only paths outside the package changed: ${changed.join(", ")}.`;
    });
    await check("version_vs_latest", async () => {
        parseVersion(manifest.version);
        const latest = await (dependencies.latest ?? publishedLatest)(directory, manifest.name);
        if(typeof latest !== "string") throw new Error("npm latest could not be verified; release blocked.");
        if(compareVersions(manifest.version, latest) <= 0) throw new Error(`package.json ${manifest.version} is not greater than npm latest ${latest}.`);
        return `package.json ${manifest.version} > npm latest ${latest}.`;
    });
    return { packageName: manifest.name, checks, passed: checks.every((item) => item.passed) };
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const result = await checkRelease(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
        console.log(`Release guard: ${result.packageName}`);
        for(const check of result.checks) console.log(`[${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.detail}`);
        process.exitCode = result.passed ? 0 : 1;
    } catch(error) {
        console.error(`Release guard failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}
