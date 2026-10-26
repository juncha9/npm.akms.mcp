import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findNpmCli } from "../src/modules/launcher/npm";

const files = vi.hoisted(() => new Map<string, string>());
vi.mock("node:fs", async (original) => ({
    ...await original<typeof import("node:fs")>(),
    existsSync: (file: string) => files.has(file),
}));
vi.mock("node:fs/promises", async (original) => ({
    ...await original<typeof import("node:fs/promises")>(),
    realpath: async (file: string) => files.get(file)!,
}));
afterEach(() => { files.clear(); vi.unstubAllGlobals(); });

describe("npm JavaScript CLI discovery", () => {
    it("finds npm under a Unix Node installation prefix", async () => {
        const prefix = path.resolve("test-unix-prefix");
        const script = path.join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js");
        files.set(script, script);
        vi.stubGlobal("process", { ...process, execPath: path.join(prefix, "bin", "node"), env: { PATH: "" }, platform: "linux" });
        expect(await findNpmCli()).toBe(script);
    });

    it("skips Volta/asdf/mise-style non-JavaScript PATH shims", async () => {
        const shim = path.resolve("shims"), real = path.resolve("npm-bin");
        const script = path.resolve("npm-package", "bin", "npm-cli.js");
        files.set(path.join(shim, "npm"), path.join(shim, "npm"));
        files.set(path.join(real, "npm"), script);
        vi.stubGlobal("process", { ...process, execPath: path.resolve("fake-node", "node"), env: { PATH: [shim, real].join(path.delimiter) }, platform: "linux" });
        expect(await findNpmCli()).toBe(script);
        files.delete(path.join(real, "npm"));
        await expect(findNpmCli()).rejects.toThrow(/npm could not be found/);
    });
});
