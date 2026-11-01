import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { MCP_PACKAGES, PACKAGE_VERSION } from "../../_defs";
import type { LaunchOptions, McpId } from "../../_types";
import { PACKAGE_NAME, findGlobalRuntime, installGlobalRuntime } from "../registration/runtime";
import type { LaunchCommand } from "../registration/runtime";
import { Prompter, PromptBackError, PromptClosedError } from "./prompter";

export interface LaunchDependencies {
    findRuntime?: typeof findGlobalRuntime;
    installRuntime?: typeof installGlobalRuntime;
    bundledEntry?: typeof bundledEntry;
    runChild?: (command: string, argumentsList: string[], pendingInput?: string) => Promise<number>;
    input?: Readable;
    output?: Writable;
}

/** This launcher's own copy of a kind's entry: lib/<kind>.js in the same @akms/mcp package. */
export function bundledEntry(kind: McpId): LaunchCommand {
    let directory = dirname(fileURLToPath(import.meta.url));
    for(;;) {
        const manifest = join(directory, "package.json");
        if(existsSync(manifest) == true && JSON.parse(readFileSync(manifest, "utf8")).name === PACKAGE_NAME) {
            return { command: process.execPath, args: [join(directory, "lib", `${kind}.js`)] };
        }
        const parent = dirname(directory);
        if(parent === directory) {
            throw new Error("The AKMS MCP package could not be located; setup was not started.");
        }
        directory = parent;
    }
}

export async function launchMcp(options: LaunchOptions, dependencies: LaunchDependencies = {}): Promise<number> {
    const selected = MCP_PACKAGES[options.mcpId];
    if(options.mcpId === "wsl" && process.platform !== "win32") {
        throw new Error("WSL setup must run from Windows.");
    }

    const findRuntime = dependencies.findRuntime ?? findGlobalRuntime;
    const output = dependencies.output ?? process.stdout;
    let runtime = findRuntime(options.mcpId);
    let pendingInput = options.pendingInput;
    if(!runtime) {
        const prompter = new Prompter(dependencies.input ?? process.stdin, output, pendingInput);
        try {
            prompter.write(`\n${PACKAGE_NAME} is not installed in the AKMS runtime directory.\n`);
            if(!await prompter.askYesNo("Install the AKMS runtime before opening setup?", true)) return 0;
            try {
                prompter.write(`Installing ${PACKAGE_NAME}...\n`);
                await (dependencies.installRuntime ?? installGlobalRuntime)();
                runtime = findRuntime(options.mcpId);
                if(!runtime) throw new Error("Installation completed but the AKMS runtime could not be found.");
            } catch(error) {
                if(error instanceof Error && error.message === "AKMS runtime installation cancelled.") return 130;
                prompter.write(`${error instanceof Error ? error.message : "AKMS runtime installation failed."}\n`);
                // Setup still works without the runtime; saved connections wait for it in Sync.
                if(!await prompter.askYesNo("Open setup from this launcher instead?", false)) return 1;
            }
        } catch(error) {
            if(error instanceof PromptClosedError || error instanceof PromptBackError) return 0;
            throw error;
        } finally {
            prompter.close();
            pendingInput = prompter.takePendingInput();
        }
    }
    const launch = runtime ?? (dependencies.bundledEntry ?? bundledEntry)(options.mcpId);
    const argumentsList = [...launch.args, selected.setupCommand];
    if(options.targetId) argumentsList.push("--target", options.targetId);
    if(runtime) output.write(`Opening ${selected.label} setup · ${PACKAGE_NAME} ${runtime.version}${runtime.linked ? " (linked development checkout)" : ""}\n\n`);
    else output.write(`Opening ${selected.label} setup · ${PACKAGE_NAME} ${PACKAGE_VERSION} from this launcher\n\n`);
    return (dependencies.runChild ?? runChild)(launch.command, argumentsList, pendingInput);
}

const ADD_USAGE = "Usage: akms-mcp add <db|ssh|wsl|s3> <name> [options]. Run akms-mcp add <kind> --help for each kind's options.";

/**
 * Runs this launcher's own copy of the kind's `add`, never the installed runtime's: an older runtime
 * has no `add`, ignores the word and starts its MCP server on these pipes.
 */
export async function launchAdd(argumentsList: string[], dependencies: Pick<LaunchDependencies, "bundledEntry" | "runChild" | "output"> = {}): Promise<number> {
    const output = dependencies.output ?? process.stdout;
    const kind = argumentsList[0];
    if(kind === "--help" || kind === "-h") {
        output.write(`${ADD_USAGE}\n`);
        return 0;
    }
    let error: string | undefined;
    if(kind == null || Object.hasOwn(MCP_PACKAGES, kind) == false) error = ADD_USAGE;
    else if(kind === "wsl" && process.platform !== "win32") error = "WSL connections are added from Windows.";
    if(error != null) {
        output.write(`${JSON.stringify({ ok: false, saved: false, error }, null, 2)}\n`);
        return 1;
    }
    const launch = (dependencies.bundledEntry ?? bundledEntry)(kind as McpId);
    return (dependencies.runChild ?? runChild)(launch.command, [...launch.args, "add", ...argumentsList.slice(1)]);
}

async function runChild(command: string, argumentsList: string[], pendingInput?: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const interactiveInput = process.stdin.isTTY === true;
        let inputMode: "inherit" | "pipe" = "pipe";
        if(interactiveInput == true) {
            inputMode = "inherit";
        }
        // AKMS_MCP_MENU: the kind's screen was opened from this menu, so it need not say where the menu is.
        const child = spawn(command, argumentsList, {
            stdio: [inputMode, "inherit", "inherit"],
            windowsHide: true,
            env: { ...process.env, AKMS_MCP_MENU: "1" },
        });
        const interrupt = (): void => {
            child.kill("SIGINT");
        };
        const terminate = (): void => {
            child.kill("SIGTERM");
        };
        process.on("SIGINT", interrupt);
        process.on("SIGTERM", terminate);

        if(child.stdin != null) {
            child.stdin.on("error", (error: NodeJS.ErrnoException) => {
                if(error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") {
                    reject(error);
                }
            });
            if(pendingInput != null) {
                child.stdin.write(pendingInput);
            }
            process.stdin.pipe(child.stdin);
        }
        const cleanup = (): void => {
            process.off("SIGINT", interrupt);
            process.off("SIGTERM", terminate);
            if(child.stdin != null) {
                process.stdin.unpipe(child.stdin);
                process.stdin.pause();
            }
        };
        child.once("error", (error) => {
            cleanup();
            reject(error);
        });
        child.once("close", (code, signal) => {
            cleanup();
            if(signal != null) {
                resolve(130);
                return;
            }
            resolve(code ?? 1);
        });
    });
}
