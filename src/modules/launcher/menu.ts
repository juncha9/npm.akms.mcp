import { runtimeMenu } from "../registration/runtime-menu";
import type { Readable, Writable } from "node:stream";
import type { ClientId, LaunchOptions, McpId } from "../../_types";
import { Prompter, PromptBackError, PromptClosedError } from "./prompter";
import { Registry } from "../registration/registry";
import { registrationMenu, syncMenu, updatesMenu } from "../registration/menu";
import { listConfigTargets } from "../registration/targets";
import { CLIENT_LABELS } from "../registration/types";
import { migrationMenu } from "../registration/migration-menu";
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
                const migration = registry.needsMigration(state);
                if(migration) prompter.write(prompter.paint.warning("Registry update available. Choose Migrate registry to review the changes.\n"));
                const picked: McpId | "register" | "sync" | "runtime" | "updates" | "migrate" | "quit" = await prompter.select<McpId | "register" | "sync" | "runtime" | "updates" | "migrate" | "quit">("AKMS MCP · Connection setup", [
                    { value: "db", label: "Database", hint: "PostgreSQL connections" },
                    { value: "ssh", label: "SSH", hint: "Remote hosts" },
                    { value: "wsl", label: "WSL", hint: "Local Linux distros · Windows" },
                    { value: "s3", label: "S3", hint: "AWS S3 and S3-compatible buckets" },
                    { separator: true },
                    { value: "register", label: "Register", hint: clients.length ? clients.map((id) => CLIENT_LABELS[id]).join(" · ") : "Choose AI services once" },
                    { value: "sync", label: "Sync", hint: "Review and retry shared settings" },
                    { value: "runtime", label: "Runtime", hint: "AKMS installation / replace npx launches" },
                    { value: "updates", label: "Updates", hint: "Check installed MCP releases" },
                    ...(migration ? [{ value: "migrate" as const, key: "migrate", label: "Migrate registry", hint: "Review older registry format and session layout" }] : []),
                    { value: "quit", label: "Quit" },
                ], { defaultValue, cancelValue: "quit" });
                if(picked !== "register" && picked !== "sync" && picked !== "runtime" && picked !== "updates" && picked !== "migrate") { selected = picked; break; }
                try {
                    if(picked === "register") await registrationMenu(prompter, registry, options.targetId);
                    else if(picked === "runtime") await runtimeMenu(prompter, registry);
                    else if(picked === "updates") await updatesMenu(prompter, registry);
                    else if(picked === "migrate") await migrationMenu(prompter, registry);
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
