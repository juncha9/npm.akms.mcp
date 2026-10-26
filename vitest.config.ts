import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "src"),
            "@db": path.resolve(import.meta.dirname, "src/kinds/db"),
            "@ssh": path.resolve(import.meta.dirname, "src/kinds/ssh"),
            "@wsl": path.resolve(import.meta.dirname, "src/kinds/wsl"),
            "@s3": path.resolve(import.meta.dirname, "src/kinds/s3"),
        },
    },
    define: {
        __PACKAGE_VERSION__: JSON.stringify(manifest.version),
    },
    test: {
        environment: "node",
        pool: "forks",
        projects: [
            { extends: true, test: { name: "launcher", include: ["tests/launcher/**/*.test.ts", "tests/registration/**/*.test.ts"] } },
            // the server logs to stderr; tests read results, not log lines
            { extends: true, test: { name: "db", include: ["tests/db/**/*.test.ts"], env: { DB_MCP_LOG_LEVEL: "silent" } } },
            { extends: true, test: { name: "ssh", include: ["tests/ssh/**/*.test.ts"] } },
            { extends: true, test: { name: "wsl", include: ["tests/wsl/**/*.test.ts"] } },
            { extends: true, test: { name: "s3", include: ["tests/s3/**/*.test.ts"] } },
        ],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
        },
    },
});
