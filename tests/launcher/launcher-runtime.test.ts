import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { launchMcp } from "@/modules/launcher/npm";
import type { GlobalRuntime } from "@/modules/registration/runtime";

const runtime: GlobalRuntime = { command: process.execPath, args: ["/fixture/runtime/lib/cli.js"], version: "1.2.3", linked: false };
function setup() {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => { text += String(chunk); });
    return {
        input, output, text: () => text,
        findRuntime: vi.fn<() => GlobalRuntime | null>(() => runtime),
        installRuntime: vi.fn(async () => {}),
        findNpmCli: vi.fn(async () => "/fixture/npm-cli.js"),
        resolveLatestVersion: vi.fn(async () => "9.8.7"),
        runChild: vi.fn(async (_command: string, _args: string[], _pending?: string) => {
            expect(input.listenerCount("data")).toBe(0);
            expect(input.listenerCount("end")).toBe(0);
            return 0;
        }),
    };
}

describe("installed runtime setup", () => {
    it("uses the installed Node launch command without resolving npm or checking latest", async () => {
        const deps = setup();
        expect(await launchMcp({ mcpId: "db", targetId: "codex", pendingInput: "child\n" }, deps)).toBe(0);
        expect(deps.runChild).toHaveBeenCalledWith(runtime.command, [runtime.args[0], "config", "--target", "codex"], "child\n");
        expect(deps.findNpmCli).not.toHaveBeenCalled();
        expect(deps.resolveLatestVersion).not.toHaveBeenCalled();
        expect(deps.installRuntime).not.toHaveBeenCalled();
        expect(deps.text()).toContain("1.2.3");
    });
    it("opens linked development runtimes directly", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue({ ...runtime, linked: true });
        await launchMcp({ mcpId: "ssh" }, deps);
        expect(deps.text()).toContain("linked development checkout");
        expect(deps.installRuntime).not.toHaveBeenCalled();
        expect(deps.resolveLatestVersion).not.toHaveBeenCalled();
    });
    it("defaults installation to yes, rediscovers the runtime and preserves unread child input", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValueOnce(null);
        await launchMcp({ mcpId: "s3", pendingInput: "\nchild answer\n" }, deps);
        expect(deps.text()).toContain("(Y/n)");
        expect(deps.installRuntime).toHaveBeenCalledWith("s3");
        expect(deps.findRuntime).toHaveBeenCalledTimes(2);
        expect(deps.runChild).toHaveBeenCalledWith(runtime.command, [runtime.args[0], "config"], "child answer\n");
        expect(deps.findNpmCli).not.toHaveBeenCalled();
    });
    it("does nothing when installation is declined", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue(null);
        expect(await launchMcp({ mcpId: "db", pendingInput: "n\n" }, deps)).toBe(0);
        expect(deps.installRuntime).not.toHaveBeenCalled();
        expect(deps.runChild).not.toHaveBeenCalled();
    });
    it("shows the install failure and defaults the npm exec fallback to no", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue(null);
        deps.installRuntime.mockRejectedValue(new Error("Registry permission denied"));
        expect(await launchMcp({ mcpId: "db", pendingInput: "y\n\n" }, deps)).toBe(1);
        expect(deps.text()).toContain("Registry permission denied");
        expect(deps.text()).toContain("npm exec instead? (y/N)");
        expect(deps.findNpmCli).not.toHaveBeenCalled();
        expect(deps.runChild).not.toHaveBeenCalled();
    });
    it("runs a freshly resolved npm setup only after explicit fallback approval", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue(null);
        deps.installRuntime.mockRejectedValue(new Error("Install failed"));
        await launchMcp({ mcpId: "ssh", targetId: "cursor", pendingInput: "y\ny\nchild\n" }, deps);
        expect(deps.resolveLatestVersion).toHaveBeenCalledWith(expect.objectContaining({ packageName: "@akms/mcp-ssh" }));
        expect(deps.runChild).toHaveBeenCalledWith(process.execPath, expect.arrayContaining([
            "/fixture/npm-cli.js", "exec", "--package=@akms/mcp-ssh@9.8.7", "--", "akms-mcp-ssh", "config", "--target", "cursor",
        ]), "child\n");
    });
    it("does not use stale npm setup when the fallback latest lookup fails", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue(null);
        deps.installRuntime.mockRejectedValue(new Error("Install failed"));
        deps.resolveLatestVersion.mockRejectedValue(new Error("Registry unavailable"));
        await expect(launchMcp({ mcpId: "db", pendingInput: "y\ny\n" }, deps)).rejects.toThrow("setup was not started");
        expect(deps.runChild).not.toHaveBeenCalled();
    });
    it("requires fallback approval if a successful install is not discoverable", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue(null);
        expect(await launchMcp({ mcpId: "db", pendingInput: "y\nn\n" }, deps)).toBe(1);
        expect(deps.text()).toContain("could not be found");
        expect(deps.runChild).not.toHaveBeenCalled();
    });
    it("closes prompts on EOF or Esc without assuming the default answer", async () => {
        const eof = setup();
        eof.findRuntime.mockReturnValue(null);
        eof.input.end();
        expect(await launchMcp({ mcpId: "db" }, eof)).toBe(0);
        expect(eof.installRuntime).not.toHaveBeenCalled();
        const back = setup();
        back.findRuntime.mockReturnValue(null);
        expect(await launchMcp({ mcpId: "db", pendingInput: "ESC\n" }, back)).toBe(0);
        expect(back.installRuntime).not.toHaveBeenCalled();
    });
    it("returns a cancelled installation and child failures unchanged", async () => {
        const cancelled = setup();
        cancelled.findRuntime.mockReturnValue(null);
        cancelled.installRuntime.mockRejectedValue(new Error("AKMS runtime installation cancelled."));
        expect(await launchMcp({ mcpId: "db", pendingInput: "y\n" }, cancelled)).toBe(130);
        expect(cancelled.resolveLatestVersion).not.toHaveBeenCalled();
        const failed = setup();
        failed.runChild.mockResolvedValue(7);
        expect(await launchMcp({ mcpId: "db" }, failed)).toBe(7);
    });
});
