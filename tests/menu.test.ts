import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { LaunchOptions } from "../src/_types";
import { runMenu } from "../src/modules/launcher/menu";
import { displayWidth, Prompter, PromptClosedError } from "../src/modules/launcher/prompter";

const ESC = "\u001b";

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
    it("keeps the selected client and gives each setup exclusive stdin ownership", async () => {
        const terminal = createTerminal();
        const launches: LaunchOptions[] = [];
        const menu = runMenu({
            input: terminal.input,
            output: terminal.output,
            launch: async (options) => {
                expect(terminal.input.listenerCount("data")).toBe(0);
                expect(terminal.input.listenerCount("end")).toBe(0);
                expect(terminal.rawModes.at(-1)).toBe(false);
                launches.push(options);
                return 0;
            },
        });
        await press(terminal.input, "4", "\r", "3", "\r", "1", "\r", "2", "\r", ESC);
        expect(await menu).toBe(0);
        expect(launches.map(({ mcpId, targetId }) => ({ mcpId, targetId }))).toEqual([
            { mcpId: "db", targetId: "codex" },
            { mcpId: "ssh", targetId: "codex" },
        ]);
    });

    it("returns to the menu after failure and retains the existing client on Esc", async () => {
        const terminal = createTerminal();
        const menu = runMenu({
            input: terminal.input,
            output: terminal.output,
            targetId: "cursor",
            launch: async (options) => {
                expect(options.targetId).toBe("cursor");
                throw new Error("Registry unavailable");
            },
        });
        await press(terminal.input, "4", "\r", ESC, "1", "\r", ESC);
        expect(await menu).toBe(0);
        expect(terminal.screen()).toContain("Registry unavailable");
    });
});
