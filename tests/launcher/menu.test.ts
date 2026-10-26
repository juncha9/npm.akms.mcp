import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "@/modules/registration/registry";
import { createJsonFileTarget } from "@/modules/registration/targets/json-file";
import type { LaunchOptions } from "@/_types";
import { runMenu } from "@/modules/launcher/menu";
import { displayWidth, Prompter, PromptClosedError } from "@/modules/launcher/prompter";
import { PACKAGE_VERSION } from "@/_defs";

const runtimeScreen = vi.hoisted(() => vi.fn(async (_prompter?: unknown, _registry?: unknown) => {}));
vi.mock("@/modules/registration/runtime-menu", async (original) => ({ ...await original<typeof import("@/modules/registration/runtime-menu")>(), runtimeMenu: runtimeScreen }));

const ESC = "\u001b";
let directory: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "akms-launcher-menu-"));
    vi.stubEnv("AKMS_MCP_HOME", directory);
});
afterEach(() => { runtimeScreen.mockClear(); vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });

function createTerminal(columns = 80) {
    const rawModes: boolean[] = [];
    const input = Object.assign(new PassThrough(), {
        isTTY: true,
        setRawMode: (mode: boolean) => rawModes.push(mode),
    });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: columns });
    let screen = "";
    output.on("data", (chunk) => {
        screen += String(chunk);
    });
    return { input, output, rawModes, screen: () => screen };
}

async function press(input: PassThrough, ...keys: string[]): Promise<void> {
    for(const key of keys) {
        input.write(key);
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

describe("selection UI inherited from the MCP packages", () => {
    it("navigates groups, hands off stdin and resumes without duplicate listeners", async () => {
        const terminal = createTerminal();
        const first = new Prompter(terminal.input, terminal.output);
        const items = [
            { value: "db", label: "Database" },
            { separator: true as const },
            { value: "ssh", label: "SSH" },
        ];
        const picked = first.select("Pick", items);
        await press(terminal.input, `${ESC}[B`, "\r");
        expect(await picked).toBe("ssh");
        first.close();
        expect(terminal.input.listenerCount("data")).toBe(0);
        expect(terminal.input.listenerCount("end")).toBe(0);
        expect(terminal.rawModes.at(-1)).toBe(false);
        expect(terminal.screen()).toContain(`${ESC}[?25h`);

        const second = new Prompter(terminal.input, terminal.output);
        const resumed = second.select("Pick", items);
        await press(terminal.input, "\r");
        expect(await resumed).toBe("db");
        second.close();
        expect(terminal.input.listenerCount("data")).toBe(0);
    });

    it("returns on Esc and treats Ctrl+C as a clean close", async () => {
        const terminal = createTerminal();
        const prompter = new Prompter(terminal.input, terminal.output);
        const items = [{ value: "db", label: "Database" }, { value: "quit", label: "Quit" }];
        const back = prompter.select("Pick", items, { cancelValue: "quit" });
        await press(terminal.input, ESC);
        expect(await back).toBe("quit");
        const closed = expect(prompter.select("Pick", items)).rejects.toBeInstanceOf(PromptClosedError);
        await press(terminal.input, "\u0003");
        await closed;
        prompter.close();
        expect(terminal.rawModes.at(-1)).toBe(false);
    });

    it("preserves piped answers read ahead for the child", async () => {
        const input = new PassThrough();
        const prompter = new Prompter(input, new PassThrough());
        const selected = prompter.select("Pick", [{ value: "db", label: "Database" }]);
        input.end("1\nfirst answer\nsecond answer");
        expect(await selected).toBe("db");
        prompter.close();
        expect(prompter.takePendingInput()).toBe("first answer\nsecond answer");
        expect(prompter.takePendingInput()).toBe("");
    });

    it("fits the frame in a narrow terminal with Korean labels", async () => {
        const terminal = createTerminal(30);
        const prompter = new Prompter(terminal.input, terminal.output);
        const picked = prompter.select("연결 설정", [{ value: "db", label: "데이터베이스", hint: "PostgreSQL connection" }]);
        const frame = terminal.screen().split(`${ESC}[J`).at(-1) ?? "";
        for(const line of frame.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").split("\n")) {
            expect(displayWidth(line)).toBeLessThan(30);
        }
        await press(terminal.input, "\r");
        await picked;
        prompter.close();
    });
});

describe("unified menu", () => {
    it.each([false, true])("offers registry migration inside Runtime, not in the main menu, with approval=%s", async approved => {
        const actual = await vi.importActual<typeof import("@/modules/registration/runtime-menu")>("@/modules/registration/runtime-menu");
        runtimeScreen.mockImplementationOnce((prompter, registry) => actual.runtimeMenu(prompter as never, registry as never));
        const file = path.join(directory, "registry.json"), original = JSON.stringify({ version: 2, clients: [], connections: {}, sessions: {} });
        fs.writeFileSync(file, original);
        const input = new PassThrough(), output = new PassThrough(); let text = "";
        output.on("data", chunk => text += chunk); input.end(`Runtime\nmigrate\n${approved ? "y" : ""}\nb\nquit\n`);
        const launch = vi.fn(async () => 0);
        expect(await runMenu({ input, output, registryPath: file, targets: [], launch })).toBe(0);
        expect(text.split("Choice")[0]).not.toContain("Migrate");
        expect(text).toMatch(/Migrate registry +step 2 · one server per kind becomes the default/);
        expect(text).toContain("Migrate the registry and apply these changes? (y/N)"); expect(launch).not.toHaveBeenCalled();
        if(approved) { expect(JSON.parse(fs.readFileSync(file, "utf8")).defaultMode).toBe("catalog"); expect(fs.readFileSync(path.join(directory, "registry.previous.json"), "utf8")).toBe(original); }
        else expect(fs.readFileSync(file, "utf8")).toBe(original);
    });
    it("marks an older runtime beside Runtime in color, offers no Updates row and opens Runtime", async () => {
        const terminal = createTerminal();
        const launch = vi.fn(async () => 0);
        const runtimeOptions: Registry["runtimeOptions"] = { find: () => ({ command: process.execPath, args: [path.join(directory, "db.js")], version: "0.0.1", linked: false }) };
        const menu = runMenu({ input: terminal.input, output: terminal.output, targets: [], launch, runtimeOptions });
        await press(terminal.input, "7", "\r", ESC);
        expect(await menu).toBe(0);
        expect(runtimeScreen).toHaveBeenCalledOnce();
        expect(launch).not.toHaveBeenCalled();
        expect(terminal.screen()).toContain("@akms/mcp 0.0.1");
        expect(terminal.screen()).toContain(`${ESC}[33m  Update available ${PACKAGE_VERSION}${ESC}[39m`);
        expect(terminal.screen()).not.toContain("Updates");
    });
    it("persists multiple registered services and gives each setup exclusive stdin ownership", async () => {
        const terminal = createTerminal();
        const launches: LaunchOptions[] = [];
        const targets = ["cursor", "codex"].map((id) => createJsonFileTarget({ id: id as "cursor" | "codex", label: id, filePath: path.join(directory, id + ".json") }));
        const menu = runMenu({
            input: terminal.input,
            output: terminal.output,
            targets,
            launch: async (options) => {
                expect(terminal.input.listenerCount("data")).toBe(0);
                expect(terminal.input.listenerCount("end")).toBe(0);
                expect(terminal.rawModes.at(-1)).toBe(false);
                launches.push(options);
                return 0;
            },
        });
        await press(terminal.input, "5", "\r", "1", "\r", "2", "\r", "3", "\r", "y", "\r", "\r", "1", "\r", "2", "\r", ESC);
        expect(await menu).toBe(0);
        expect(launches.map(({ mcpId, targetId }) => ({ mcpId, targetId }))).toEqual([
            { mcpId: "db", targetId: undefined },
            { mcpId: "ssh", targetId: undefined },
        ]);
        expect(new Registry(targets).read().clients).toEqual(["cursor", "codex"]);
    });

    it("returns to the menu after failure and retains the existing client on Esc", async () => {
        const terminal = createTerminal();
        const menu = runMenu({
            input: terminal.input,
            output: terminal.output,
            targetId: "cursor",
            targets: [createJsonFileTarget({ id: "cursor", label: "Cursor", filePath: path.join(directory, "cursor.json") })],
            launch: async (options) => {
                expect(options.targetId).toBe("cursor");
                throw new Error("Registry unavailable");
            },
        });
        await press(terminal.input, "5", "\r", ESC, "1", "\r", "\r", ESC);
        expect(await menu).toBe(0);
        expect(terminal.screen()).toContain("Registry unavailable");
    });
});
