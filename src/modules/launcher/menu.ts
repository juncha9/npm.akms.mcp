import { runtimeMenu, runtimeNotice } from "../registration/runtime-menu";
import type { Readable, Writable } from "node:stream";
import type { ClientId, LaunchOptions, McpId } from "../../_types";
import { Prompter, PromptBackError, PromptClosedError } from "./prompter";
import { Registry } from "../registration/registry";
import { registrationMenu, syncMenu } from "../registration/menu";
import { listConfigTargets } from "../registration/targets";
import { CLIENT_LABELS } from "../registration/types";
import type { ConfigTarget } from "../registration/types";

export interface MenuOptions {
    input: Readable;
    output: Writable;
    targetId?: ClientId;
    registryPath?: string;
    targets?: ConfigTarget[];
    runtimeOptions?: Registry["runtimeOptions"];
    launch: (options: LaunchOptions) => Promise<number>;
}

export async function runRegistrationCommand(options: Omit<MenuOptions, "launch"> & { mode: "register" | "sync" }): Promise<number> {
    const prompter = new Prompter(options.input, options.output);
    const registry = new Registry(options.targets ?? listConfigTargets(), options.registryPath, options.runtimeOptions);
    try {
        if(options.mode === "register") await registrationMenu(prompter, registry, options.targetId);
        else await syncMenu(prompter, registry);
        return 0;
    } catch(error) {
        if(error instanceof PromptClosedError || error instanceof PromptBackError) return 0;
        throw error;
    } finally { prompter.close(); }
}

export async function runMenu(options: MenuOptions): Promise<number> {
    const registry = new Registry(options.targets ?? listConfigTargets(), options.registryPath, options.runtimeOptions);
    let defaultValue: McpId | "quit" = "db";
    let failure: string | undefined;
    for(;;) {
        const prompter = new Prompter(options.input, options.output);
        let selected: McpId | "quit" = "quit";
        try {
            if(failure) {
                prompter.write(`\n${failure}\n\n`);
                await prompter.acknowledge();
                failure = undefined;
            }
            for(;;) {
                prompter.clearScreen();
                const state = registry.read();
                const clients = state.clients;
                // Migrate registry lives in Runtime; its row there appears only when it can be applied.
                const runtime = runtimeNotice(registry);
                const picked: McpId | "register" | "sync" | "runtime" | "quit" = await prompter.select<McpId | "register" | "sync" | "runtime" | "quit">("AKMS MCP · Connection setup", [
                    { value: "db", label: "Database", hint: "PostgreSQL connections" },
                    { value: "ssh", label: "SSH", hint: "Remote hosts" },
                    { value: "wsl", label: "WSL", hint: "Local Linux distros · Windows" },
                    { value: "s3", label: "S3", hint: "AWS S3 and S3-compatible buckets" },
                    { separator: true },
                    { value: "register", label: "Register", hint: clients.length ? clients.map((id) => CLIENT_LABELS[id]).join(" · ") : "Choose AI services once" },
                    { value: "sync", label: "Sync", hint: "Review and retry shared settings" },
                    { value: "runtime", label: "Runtime", hint: runtime.hint, notice: runtime.notice },
                    { value: "quit", label: "Quit" },
                ], { defaultValue, cancelValue: "quit" });
                if(picked !== "register" && picked !== "sync" && picked !== "runtime") { selected = picked; break; }
                try {
                    if(picked === "register") await registrationMenu(prompter, registry, options.targetId);
                    else if(picked === "runtime") await runtimeMenu(prompter, registry);
                    else await syncMenu(prompter, registry);
                } catch(error) {
                    if(error instanceof PromptClosedError) throw error;
                    if(!(error instanceof PromptBackError)) {
                        options.output.write(`\n${error instanceof Error ? error.message : "Could not update settings."}\n`);
                        await prompter.acknowledge();
                    }
                }
            }
        } catch(error) {
            if(error instanceof PromptClosedError) return 0;
            throw error;
        } finally { prompter.close(); }
        if(selected === "quit") return 0;
        defaultValue = selected;
        try {
            const code = await options.launch({ mcpId: selected, targetId: options.targetId, pendingInput: prompter.takePendingInput() });
            if(code === 130) return 0;
            if(code !== 0) failure = `Setup exited with code ${code}.`;
        } catch(error) { failure = String(error); }
    }
}
