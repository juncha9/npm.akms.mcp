import { describe, expect, it } from "vitest";
import { parseArguments } from "../src/modules/launcher/arguments";

describe("CLI arguments", () => {
    it.each([[], ["config"], ["setup"]])("opens the menu for %j", (...argumentsList) => {
        expect(parseArguments(argumentsList as string[]).mcpId).toBeUndefined();
    });

    it.each(["db", "ssh", "wsl", "s3"])("opens %s directly and forwards the selected client", (mcpId) => {
        expect(parseArguments(["config", mcpId, "--target", "codex"])).toMatchObject({ mcpId: mcpId, targetId: "codex" });
        expect(parseArguments([mcpId, "--target=cursor"])).toMatchObject({ mcpId: mcpId, targetId: "cursor" });
    });

    it.each([["--target"], ["--target=other"], ["db", "ssh"], ["--registry=elsewhere"], ["db;echo bad"], ["constructor"]])(
        "rejects unknown inputs %j", (...argumentsList) => {
            expect(() => parseArguments(argumentsList as string[])).toThrow();
        },
    );
});
