import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findNpmCli, resolveLatestVersion } from "@/modules/launcher/npm";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("fresh latest lookup through real npm", () => {
    it("observes a moved latest tag and refuses stale metadata after a registry failure", async () => {
        let latestVersion = "1.0.0";
        let unavailable = false;
        let requests = 0;
        const server = createServer((_request, response) => {
            requests += 1;
            if(unavailable == true) {
                response.writeHead(503);
                response.end("Registry unavailable");
                return;
            }
            response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" });
            response.end(JSON.stringify({
                name: "akms-mcp-latest-fixture",
                "dist-tags": { latest: latestVersion },
                versions: {
                    "1.0.0": { name: "akms-mcp-latest-fixture", version: "1.0.0" },
                    "1.1.0": { name: "akms-mcp-latest-fixture", version: "1.1.0" },
                },
            }));
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if(address == null || typeof address === "string") {
            throw new Error("Test registry did not bind");
        }
        vi.stubEnv("npm_config_registry", `http://127.0.0.1:${address.port}`);
        vi.stubEnv("npm_config_offline", "true");
        vi.stubEnv("npm_config_prefer_offline", "true");
        try {
            const npmCli = await findNpmCli();
            const options = { npmCli: npmCli, packageName: "akms-mcp-latest-fixture" };
            expect(await resolveLatestVersion(options)).toBe("1.0.0");
            latestVersion = "1.1.0";
            expect(await resolveLatestVersion(options)).toBe("1.1.0");
            unavailable = true;
            await expect(resolveLatestVersion(options)).rejects.toThrow();
            expect(requests).toBeGreaterThanOrEqual(3);
        }
        finally {
            await new Promise<void>((resolve, reject) => server.close((error) => {
                if(error != null) {
                    reject(error);
                    return;
                }
                resolve();
            }));
        }
    }, 40000);
});
