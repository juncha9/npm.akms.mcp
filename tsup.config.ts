import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
    // lib/cli.js is the setup menu; lib/<kind>.js is one kind's server, `config` and `--check`.
    // One bundle per entry, so a server loads only its own kind's code and drivers.
    entry: {
        cli: "src/cli.ts",
        db: "src/kinds/db/cli.ts",
        ssh: "src/kinds/ssh/cli.ts",
        wsl: "src/kinds/wsl/cli.ts",
        s3: "src/kinds/s3/cli.ts",
    },
    format: ["esm"],
    target: "node22",
    platform: "node",
    outDir: "lib",
    clean: true,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    shims: true,
    define: {
        __PACKAGE_VERSION__: JSON.stringify(manifest.version),
    },
});
