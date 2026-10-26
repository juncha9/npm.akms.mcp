import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guard = await import(new URL("../../scripts/release-guard.mjs", import.meta.url).href);
let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "akms-release-test-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@akms/mcp", version: "0.4.0" }));
});
afterEach(() => {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^akms-release-test-/);
    fs.rmSync(root, { recursive: true, force: true });
});

const PACKED = ["package.json", "README.md", "CHANGELOG.md", "LICENSE.md", "lib/cli.js", "lib/db.js"];
const status = (...entries: string[]) => vi.fn(async () => ({ stdout: entries.map((entry) => `${entry}\0`).join(""), stderr: "" }));
const clean = () => ({ execute: status(), latest: vi.fn(async () => "0.3.2"), packedFiles: vi.fn(async () => PACKED) });

describe("release gate", () => {
    it("passes a clean tree with a version above npm latest, without listing packed files", async () => {
        const dependencies = clean();
        const result = await guard.checkRelease(root, dependencies);
        expect(result.passed, JSON.stringify(result)).toBe(true);
        expect(result.checks.map((item: { name: string }) => item.name)).toEqual(["working_tree", "version_vs_latest"]);
        expect(dependencies.packedFiles).not.toHaveBeenCalled();
    });
    it("allows changes that never reach the package, such as tests and notes", async () => {
        const result = await guard.checkRelease(root, { ...clean(), execute: status(" M tests/db/driver.test.ts", "?? notes.md") });
        expect(result.passed, JSON.stringify(result)).toBe(true);
        expect(result.checks[0].detail).toContain("tests/db/driver.test.ts");
    });
    it.each([
        [" M README.md", "README.md"],
        [" M src/kinds/db/cli.ts", "src/kinds/db/cli.ts"],
        ["?? src/modules/new-file.ts", "src/modules/new-file.ts"],
        [" M package-lock.json", "package-lock.json"],
        [" M tsup.config.ts", "tsup.config.ts"],
    ])("blocks %s because it changes what ships", async (entry, file) => {
        const result = await guard.checkRelease(root, { ...clean(), execute: status(entry) });
        expect(result.checks[0].passed).toBe(false);
        expect(result.checks[0].detail).toContain(file);
    });
    it("checks both sides of a rename", async () => {
        expect(guard.statusPaths("R  docs/old.md\0src/kinds/db/new.ts\0 M notes.md\0")).toEqual(["docs/old.md", "src/kinds/db/new.ts", "notes.md"]);
        const result = await guard.checkRelease(root, { ...clean(), execute: vi.fn(async () => ({ stdout: "R  src/kinds/db/old.ts\0docs/moved.ts\0" })) });
        expect(result.checks[0].detail).toContain("src/kinds/db/old.ts");
    });
    it("reports a reused version and a dirty package together", async () => {
        const result = await guard.checkRelease(root, { ...clean(), execute: status(" M README.md"), latest: async () => "0.4.0" });
        expect(result.passed).toBe(false);
        expect(result.checks.filter((item: { passed: boolean }) => !item.passed).map((item: { name: string }) => item.name)).toEqual(["working_tree", "version_vs_latest"]);
    });
    it("blocks registry failures and a source tree without git metadata", async () => {
        const result = await guard.checkRelease(root, {
            execute: async () => { throw new Error("not a git repository"); },
            latest: async () => { throw new Error("registry unavailable"); },
        });
        expect(result.checks.filter((item: { passed: boolean }) => !item.passed).map((item: { name: string }) => item.name)).toEqual(["working_tree", "version_vs_latest"]);
    });
    it("blocks release when the published latest could not be verified", async () => {
        const result = await guard.checkRelease(root, { ...clean(), latest: async () => null });
        expect(result.passed).toBe(false);
        expect(result.checks[1].detail).toContain("could not be verified");
    });
});

describe("SemVer precedence for release versions", () => {
    it.each([
        ["0.2.1", "0.2.1", 0], ["0.2.1+build.2", "0.2.1+build.1", 0],
        ["0.2.1-rc.1", "0.2.1", -1], ["0.2.1", "0.2.1-rc.1", 1],
        ["0.2.1-beta.10", "0.2.1-beta.2", 1], ["0.2.1-beta", "0.2.1-beta.1", -1],
        ["0.2.1-1", "0.2.1-alpha", -1], ["10.0.0", "2.99.99", 1],
    ])("compares %s and %s", (left, right, expected) => expect(guard.compareVersions(left, right)).toBe(expected));
    it.each(["01.2.3", "1.2", "1.2.3-01", "latest"])("rejects malformed version %s", (version) => {
        expect(() => guard.compareVersions(version, "1.0.0")).toThrow("SemVer");
    });
});

describe("fresh registry metadata", () => {
    it("uses package dist-tags and removes its fresh cache", async () => {
        let cache = "";
        const execute = vi.fn(async (_command: string, args: string[]) => {
            expect(args.slice(1, 4)).toEqual(["view", "@akms/mcp", "dist-tags"]);
            expect(args).toContain("--offline=false");
            cache = args[args.indexOf("--cache") + 1];
            expect(fs.readdirSync(cache)).toEqual([]);
            return { stdout: '{"latest":"0.3.2","beta":"0.4.0-beta.1"}' };
        });
        expect(await guard.publishedLatest(root, "@akms/mcp", execute)).toBe("0.3.2");
        expect(fs.existsSync(cache)).toBe(false);
    });
    it("blocks missing packages, missing latest tags and failed authentication", async () => {
        await expect(guard.publishedLatest(root, "@akms/new", async () => { throw { stdout: '{"error":{"code":"E404"}}' }; })).rejects.toThrow("E404");
        await expect(guard.publishedLatest(root, "@akms/no-latest", async () => ({ stdout: '{"beta":"0.2.0"}' }))).rejects.toThrow("no valid latest");
        await expect(guard.publishedLatest(root, "@akms/auth", async () => { throw { stdout: '{"error":{"code":"E401"}}' }; })).rejects.toThrow("release blocked");
    });
    it("lists packed files without running the prepack build", async () => {
        const execute = vi.fn(async (_command: string, args: string[]) => {
            expect(args.slice(1)).toEqual(["pack", "--dry-run", "--json", "--ignore-scripts"]);
            return { stdout: JSON.stringify([{ files: [{ path: "lib/cli.js" }, { path: "README.md" }] }]) };
        });
        expect(await guard.packedFiles(root, execute)).toEqual(["lib/cli.js", "README.md"]);
    });
    it("is wired into this package's prepublishOnly", () => {
        const manifest = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
        expect(manifest.scripts.prepublishOnly).toBe("node scripts/release-guard.mjs");
    });
});
