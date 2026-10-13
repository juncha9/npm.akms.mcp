import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
    entry: ["src/cli.ts"],
    format: ["esm"],
    target: "es2022",
    platform: "node",
    outDir: "lib",
    clean: true,
    splitting: false,
    define: {
        __PACKAGE_VERSION__: JSON.stringify(manifest.version),
    },
});
