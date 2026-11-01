import type { Writable } from "node:stream";
import { PromptBackError, PromptClosedError } from "../prompt-errors";
import type { RegistrationPrompter } from "./prompter";
import { nameInUse, Registry, RegistryError, sessionName } from "./registry";
import { launchCommand, runtimeInstallCommand } from "./runtime";
import { listConfigTargets } from "./targets";
import type { ConfigTarget, McpKind } from "./types";

/**
 * One option of `akms-mcp add <kind>`. The list is an allow-list: a setting without a field
 * cannot be written from the command line, so a kind leaves out what runs local commands.
 */
export interface AddField {
    /** The long option without its dashes: "host" is `--host`. */
    flag: string;
    /** The connection setting this option writes. */
    env: string;
    /** One line in `--help`; for a secret, also the prompt. */
    help: string;
    /**
     * value: `--flag <value>` (default).
     * switch: `--flag` alone writes `set`, or "true".
     * secret: `--flag` alone asks for the value, so it never reaches the command line.
     */
    type?: "value" | "switch" | "secret";
    set?: string;
    required?: boolean;
}

/** A failure the caller can act on; its text is reported as written. */
class AddError extends Error {}

const SECRET_SOURCE = "a hidden prompt in a terminal, or one line on stdin";

function usage(kind: McpKind, fields: AddField[]): string {
    const rows = fields.map(field => [
        field.type === "switch" || field.type === "secret" ? `--${field.flag}` : `--${field.flag} <value>`,
        `${field.help}${field.required ? " (required)" : ""}${field.type === "secret" ? ` — from ${SECRET_SOURCE}` : ""}`,
    ]);
    const width = Math.max(...rows.map(([option]) => option.length));
    return [
        `Usage: akms-mcp add ${kind} <name> [options]`,
        "",
        "Saves a new connection in the AKMS catalog and applies it to every registered AI service.",
        "Prints one JSON object on stdout; exits 0 only when every step succeeded.",
        "An existing name is refused. Edit or remove connections, and set anything not listed here, in the setup menu.",
        "",
        "Options:",
        ...rows.map(([option, help]) => `  ${option.padEnd(width)}  ${help}`),
        `  ${"--help".padEnd(width)}  Print this help`,
    ].join("\n");
}

/** Errors repeat only options from the list, never what was typed: a mistyped command can hold a password, even one starting with --. */
function parseOptions(argv: string[], fields: AddField[]) {
    const name = argv[0];
    if(name == null || name.startsWith("-")) throw new AddError("Give the connection name first: akms-mcp add <kind> <name> [options].");
    const env: Record<string, string> = {};
    const secrets: AddField[] = [];
    const seen = new Set<string>();
    for(let index = 1; index < argv.length; index += 1) {
        const argument = argv[index];
        if(!argument.startsWith("--")) throw new AddError(`Argument ${index + 1} is not an option. Options start with --, and secrets are never given on the command line.`);
        const separator = argument.indexOf("=");
        const flag = separator < 0 ? argument.slice(2) : argument.slice(2, separator);
        const field = fields.find(item => item.flag === flag);
        if(!field) throw new AddError(`Argument ${index + 1} is not an option of this command. Run with --help for the options; anything else is set in the setup menu.`);
        if(seen.has(flag)) throw new AddError(`--${flag} is given twice.`);
        seen.add(flag);
        if(field.type === "secret") {
            if(separator >= 0) throw new AddError(`--${flag} takes no value on the command line: it comes from ${SECRET_SOURCE}.`);
            secrets.push(field);
            continue;
        }
        if(field.type === "switch") {
            if(separator >= 0) throw new AddError(`--${flag} takes no value.`);
            env[field.env] = field.set ?? "true";
            continue;
        }
        let value = separator < 0 ? argv[index + 1] : argument.slice(separator + 1);
        if(separator < 0) index += 1;
        if(!value || (separator < 0 && value.startsWith("--"))) throw new AddError(`--${flag} needs a value.`);
        env[field.env] = value;
    }
    const missing = fields.filter(field => field.required && !seen.has(field.flag));
    if(missing.length) throw new AddError(`Missing required options: ${missing.map(field => `--${field.flag}`).join(", ")}.`);
    return { name, env, secrets };
}

/** Saves one new connection without any menu, for scripts and AI agents. See docs/db/design/registration.md. */
export async function runAddCommand(options: {
    kind: McpKind;
    argv: string[];
    fields: AddField[];
    /** Written unless an option sets them. */
    defaults?: Record<string, string>;
    /** The server's own parser, so a connection it would reject is never saved. Throws on invalid settings; null means not configured. */
    validate(env: Record<string, string>): unknown;
    /** Writes prompts and the startup check's report: give it stderr, because stdout carries the JSON. */
    prompter: RegistrationPrompter & { askSecret(question: string): Promise<string>; close(): void };
    output: Writable;
    targets?: ConfigTarget[];
    registryPath?: string;
    runtimeOptions?: Registry["runtimeOptions"];
}): Promise<number> {
    const { kind, argv, fields, prompter, output } = options;
    const print = (text: string) => new Promise<void>(resolve => { output.write(`${text}\n`, () => resolve()); });
    const typed: string[] = [];
    const hide = (text: string) => typed.reduce((safe, secret) => safe.split(secret).join("(hidden)"), text);
    let saved = false;
    const fail = async (message: string): Promise<number> => {
        const next = saved ? { next: "Run akms-mcp sync to finish, then reconnect your AI clients. Adding the same name again will be refused." } : {};
        await print(JSON.stringify({ ok: false, saved, kind, error: hide(message), ...next }, null, 2));
        return 1;
    };
    try {
        if(argv.includes("--help") || argv.includes("-h")) {
            await print(usage(kind, fields));
            return 0;
        }
        const { name, env: chosen, secrets } = parseOptions(argv, fields);
        const registry = new Registry(options.targets ?? listConfigTargets(), options.registryPath, options.runtimeOptions);
        // Everything that can refuse the command runs before anyone is asked for a password.
        const state = registry.read();
        if(registry.needsMigration(state)) throw new AddError("The registry needs migrating first: open Runtime in the setup menu (akms-mcp) and choose Migrate registry.");
        if(!state.clients.length) throw new AddError("No AI service is registered: run akms-mcp register first.");
        if(!registry.globalRuntime(kind)) throw new AddError(`Install the AKMS runtime first: ${runtimeInstallCommand()}`);
        // Refuse before asking for a secret; Registry.add checks again under the lock, which is what guarantees it.
        if(Object.hasOwn(state.connections, name)) throw new AddError(nameInUse(name));
        const env = { ...options.defaults, ...chosen };
        for(const field of secrets) {
            const secret = await prompter.askSecret(field.help);
            if(!secret) throw new AddError(`--${field.flag} was given an empty value.`);
            typed.push(secret);
            env[field.env] = secret;
        }
        let profile: unknown;
        try { profile = options.validate(env); }
        catch(error) { throw new AddError(error instanceof Error ? error.message : "These settings are not valid."); }
        // The parsers trim first, so `--host "   "` passes the required check and comes back as "not configured".
        if(profile == null) throw new AddError("A required value is blank, so the server would not load this connection. Nothing was saved.");

        const entry = registry.target(kind).prepareEntry!(name, { ...launchCommand(kind), env });
        const rows = registry.add(kind, name, entry, () => { saved = true; }).filter(row => row.kind === kind);
        const startup = await registry.checkSaved(prompter, [name]);
        const ok = startup && rows.every(row => row.status === "synced" || row.status === "removed");
        const readonly = fields.some(field => field.flag === "readonly" && env[field.env] === "true");
        await print(JSON.stringify({
            ok, saved: true, kind, name, readonly,
            server: sessionName(kind),
            tool_prefix: `${name}__`,
            services: rows.map(row => ({ service: row.client, entry: row.name, status: row.status, ...(row.status === "synced" ? {} : { detail: hide(row.detail) }) })),
            startup,
            next: ok ? "Reconnect your AI clients to load this connection." : "The connection is saved, but not every step finished. Run akms-mcp sync and read the messages above before reconnecting.",
        }, null, 2));
        return ok ? 0 : 1;
    } catch(error) {
        if(error instanceof AddError || error instanceof RegistryError) return fail(error.message);
        if(error instanceof PromptClosedError || error instanceof PromptBackError) return fail("A secret was not provided, so nothing was saved. Run this command in a terminal to type it, or pipe one line per secret on stdin, in the order the options are given.");
        return fail(`The command failed ${saved ? "after saving" : "before saving"}; its error is not shown because it may hold settings. Open the setup menu (akms-mcp) to check this connection.`);
    } finally { prompter.close(); }
}
