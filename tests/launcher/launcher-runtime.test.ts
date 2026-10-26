import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { bundledEntry, launchMcp } from "@/modules/launcher/npm";
import type { GlobalRuntime, LaunchCommand } from "@/modules/registration/runtime";

const runtime: GlobalRuntime = { command: process.execPath, args: ["/fixture/runtime/node_modules/@akms/mcp/lib/db.js"], version: "1.2.3", linked: false };
const bundled = (kind: string): LaunchCommand => ({ command: process.execPath, args: [`/fixture/npx/@akms/mcp/lib/${kind}.js`] });
function setup() {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => { text += String(chunk); });
    return {
        input, output, text: () => text,
        findRuntime: vi.fn<() => GlobalRuntime | null>(() => runtime),
        installRuntime: vi.fn(async () => {}),
        bundledEntry: vi.fn(bundled),
        runChild: vi.fn(async (_command: string, _args: string[], _pending?: string) => {
            expect(input.listenerCount("data")).toBe(0);
            expect(input.listenerCount("end")).toBe(0);
            return 0;
        }),
    };
}

describe("installed runtime setup", () => {
    it("uses the installed Node launch command without installing anything", async () => {
        const deps = setup();
        expect(await launchMcp({ mcpId: "db", targetId: "codex", pendingInput: "child\n" }, deps)).toBe(0);
        expect(deps.runChild).toHaveBeenCalledWith(runtime.command, [runtime.args[0], "config", "--target", "codex"], "child\n");
        expect(deps.installRuntime).not.toHaveBeenCalled();
        expect(deps.bundledEntry).not.toHaveBeenCalled();
        expect(deps.text()).toContain("Opening Database setup · @akms/mcp 1.2.3");
    });
    it("opens linked development runtimes directly", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue({ ...runtime, linked: true });
        await launchMcp({ mcpId: "ssh" }, deps);
        expect(deps.text()).toContain("linked development checkout");
        expect(deps.installRuntime).not.toHaveBeenCalled();
    });
    it("defaults installation to yes, rediscovers the runtime and preserves unread child input", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValueOnce(null);
        await launchMcp({ mcpId: "s3", pendingInput: "\nchild answer\n" }, deps);
        expect(deps.text()).toContain("@akms/mcp is not installed in the AKMS runtime directory.");
        expect(deps.text()).toContain("(Y/n)");
        expect(deps.installRuntime).toHaveBeenCalledExactlyOnceWith();
        expect(deps.findRuntime).toHaveBeenCalledTimes(2);
        expect(deps.runChild).toHaveBeenCalledWith(runtime.command, [runtime.args[0], "config"], "child answer\n");
    });
    it("does nothing when installation is declined", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue(null);
        expect(await launchMcp({ mcpId: "db", pendingInput: "n\n" }, deps)).toBe(0);
        expect(deps.installRuntime).not.toHaveBeenCalled();
        expect(deps.runChild).not.toHaveBeenCalled();
    });
    it("shows the install failure and defaults opening this launcher's own setup to no", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue(null);
        deps.installRuntime.mockRejectedValue(new Error("Registry permission denied"));
        expect(await launchMcp({ mcpId: "db", pendingInput: "y\n\n" }, deps)).toBe(1);
        expect(deps.text()).toContain("Registry permission denied");
        expect(deps.text()).toContain("Open setup from this launcher instead? (y/N)");
        expect(deps.bundledEntry).not.toHaveBeenCalled();
        expect(deps.runChild).not.toHaveBeenCalled();
    });
    it("opens the kind's entry from this launcher's own package only after approval, without npm", async () => {
        const deps = setup();
        deps.findRuntime.mockReturnValue(null);
        deps.installRuntime.mockRejectedValue(new Error("Install failed"));
        await launchMcp({ mcpId: "ssh", targetId: "cursor", pendingInput: "y\ny\nchild\n" }, deps);
        expect(deps.bundledEntry).toHaveBeenCalledExactlyOnceWith("ssh");
        expect(deps.runChild).toHaveBeenCalledWith(process.execPath, ["/fixture/npx/@akms/mcp/lib/ssh.js", "config", "--target", "cursor"], "child\n");
        expect(deps.text()).toContain("from this launcher");
    });
    it("requires approval if a successful install is not discoverable", async () => {
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
        expect(cancelled.runChild).not.toHaveBeenCalled();
        const failed = setup();
        failed.runChild.mockResolvedValue(7);
        expect(await launchMcp({ mcpId: "db" }, failed)).toBe(7);
    });
    it("finds lib/<kind>.js in the package that contains this launcher", () => {
        const entry = bundledEntry("wsl");
        expect(entry.command).toBe(process.execPath);
        expect(entry.args[0].replace(/\\/g, "/")).toMatch(/\/lib\/wsl\.js$/);
    });
});
