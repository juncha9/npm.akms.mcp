import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Packages a bundle imports at its top level — loaded the moment the process starts. */
function staticImports(entry: string): string[] {
    const source = fs.readFileSync(path.resolve(`lib/${entry}.js`), "utf8");
    return [...source.matchAll(/^import\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/gm)].map((match) => match[1]);
}

const DRIVERS: Record<string, RegExp> = {
    db: /^(pg|pg-cursor|libpg-query)$/,
    s3: /^@aws-sdk\/|^@smithy\//,
};

describe("one bundle per kind", () => {
    it.each(["cli", "ssh", "wsl", "s3"])("lib/%s.js does not load the database drivers", (entry) => {
        expect(staticImports(entry).filter((name) => DRIVERS.db.test(name))).toEqual([]);
    });
    it.each(["cli", "db", "ssh", "wsl"])("lib/%s.js does not load the AWS SDK", (entry) => {
        expect(staticImports(entry).filter((name) => DRIVERS.s3.test(name))).toEqual([]);
    });
    it("lib/s3.js still loads the AWS SDK lazily, on first use", () => {
        expect(staticImports("s3").filter((name) => DRIVERS.s3.test(name))).toEqual([]);
        expect(fs.readFileSync(path.resolve("lib/s3.js"), "utf8")).toMatch(/import\(["']@aws-sdk\/client-s3["']\)/);
    });
    it("declares only the akms-mcp bin: a 0.3.x package in the same runtime prefix owns akms-mcp-<kind>, and npm refuses the install (EEXIST)", () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
        expect(manifest.bin).toEqual({ "akms-mcp": "lib/cli.js" });
    });
    it.each(["cli", "db", "ssh", "wsl", "s3"])("lib/%s.js starts with a shebang so it runs on its own", (entry) => {
        expect(fs.readFileSync(path.resolve(`lib/${entry}.js`), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    });
});
