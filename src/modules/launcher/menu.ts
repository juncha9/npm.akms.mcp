import type { Readable, Writable } from "node:stream";
import { CLIENT_LABELS } from "../../_defs";
import type { ClientId, LaunchOptions, McpId } from "../../_types";
import { Prompter, PromptClosedError } from "./prompter";
import type { SelectItem } from "./prompter";

export async function runMenu(options: {
    input: Readable;
    output: Writable;
    targetId?: ClientId;
    launch: (options: LaunchOptions) => Promise<number>;
}): Promise<number> {
    let targetId = options.targetId;
    let defaultValue: McpId | "quit" = "db";

    for(;;) {
        const prompter = new Prompter(options.input, options.output);
        let selected: McpId | "quit" = "quit";
        try {
            for(;;) {
                let clientLabel = "Automatically selected by each MCP";
                if(targetId != null) {
                    clientLabel = CLIENT_LABELS[targetId];
                }
                const picked: McpId | "client" | "quit" = await prompter.select<McpId | "client" | "quit">("AKMS MCP · Connection setup", [
                    { value: "db", label: "Database", hint: "PostgreSQL connections" },
                    { value: "ssh", label: "SSH", hint: "Remote hosts" },
                    { value: "wsl", label: "WSL", hint: "Local Linux distros · Windows" },
                    { separator: true },
                    { value: "client", label: "Client", hint: clientLabel },
                    { value: "quit", label: "Quit" },
                ], { defaultValue: defaultValue, cancelValue: "quit" });
                if(picked !== "client") {
                    selected = picked;
                    break;
                }
                const clients: SelectItem<ClientId | "auto" | "back">[] = [
                    { value: "auto", label: "Automatic", hint: "Let each MCP detect the client" },
                    { value: "claude-code", label: CLIENT_LABELS["claude-code"] },
                    { value: "codex", label: CLIENT_LABELS.codex },
                    { value: "claude-desktop", label: CLIENT_LABELS["claude-desktop"] },
                    { value: "cursor", label: CLIENT_LABELS.cursor },
                    { separator: true },
                    { value: "back", label: "Back" },
                ];
                const client = await prompter.select("Client", clients, { defaultValue: targetId ?? "auto", cancelValue: "back" });
                if(client === "auto") {
                    targetId = undefined;
                }
                else if(client !== "back") {
                    targetId = client;
                }
            }
        }
        catch(error) {
            if(error instanceof PromptClosedError) {
                return 0;
            }
            throw error;
        }
        finally {
            prompter.close();
        }

        if(selected === "quit") {
            return 0;
        }
        defaultValue = selected;
        try {
            const code = await options.launch({ mcpId: selected, targetId: targetId, pendingInput: prompter.takePendingInput() });
            if(code === 130) {
                return 0;
            }
            if(code !== 0) {
                options.output.write(`\nSetup exited with code ${code}.\n\n`);
            }
        }
        catch(error) {
            options.output.write(`\n${String(error)}\n\n`);
        }
    }
}
