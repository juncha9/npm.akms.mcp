import { Registry, entryHash, entryKind, describeDifferences, sessionName } from "./registry";
import { compareEntries, descriptionOnly, visibleField } from "./comparison";
import { prepareRuntime } from "./runtime-menu";
import { standardLaunch } from "./runtime";
import type { ImportCandidate, SyncResult } from "./registry";
import { CLIENT_LABELS, KINDS, KIND_LABELS } from "./types";
import { countLabel, screenText, writeField, writeHeading, writeHint, writeWarning } from "./display";
import type { ClientId, ConfigTarget, McpKind, McpServerEntry } from "./types";
import { PromptBackError, PromptClosedError, type RegistrationPrompter } from "./prompter";
import type { SelectItem } from "./prompter";

function pendingImports(registry: Registry, kind?: McpKind): { names: string[]; differing: number } {
    const state = registry.read();
    const entries = registry.candidates(kind).entries.filter(candidate => !Object.hasOwn(state.connections, candidate.name));
    const names = [...new Set(entries.map(candidate => candidate.name))];
    return { names, differing: names.filter(name => new Set(entries.filter(item => item.name === name).map(item => entryHash(item.entry))).size > 1).length };
}

export type ManagementMode = "config" | "register" | "sync";

function preview(prompter: RegistrationPrompter, entry: McpServerEntry | null): void {
    if(!entry) { writeField(prompter, "Action", "Remove from service", "", "warning"); return; }
    // Arguments may also contain credentials in imported commands. Only env keys and
    // familiar non-secret endpoint fields are shown in a registration/conflict preview.
    for(const [key, value] of Object.entries(entry.env)) writeField(prompter, key, visibleField.test(key) ? value : "(hidden)", "", visibleField.test(key) ? "accent" : "dim");
}

/** Status lines and the Add guard of each kind's config screen; shared settings live in the AKMS MCP menu. */
export class ManagedSession {
    readonly registry: Registry;
    readonly target: ConfigTarget;
    constructor(readonly options: { kind: McpKind; targets: ConfigTarget[]; registryPath?: string; mode?: ManagementMode; targetId?: string; version?: string; runtimeOptions?: Registry["runtimeOptions"] }) {
        this.registry = new Registry(options.targets, options.registryPath, options.runtimeOptions);
        this.target = this.registry.target(options.kind);
    }

    async initialize(prompter: RegistrationPrompter): Promise<boolean> {
        const { mode = "config", targetId } = this.options;
        if(targetId && !this.registry.targets.some((item) => item.id === targetId)) throw new Error("Unknown AI service. Use claude-code, codex, claude-desktop or cursor.");
        if(mode === "sync") { await syncMenu(prompter, this.registry); return false; }
        if(mode === "register") {
            await registrationMenu(prompter, this.registry, targetId as ClientId | undefined);
            return false;
        }
        this.registry.read();
        return true;
    }

    /**
     * A kind's screen lists only its connections; Register, Sync, Runtime and Migrate live in the
     * AKMS MCP menu, so each status line names that menu.
     */
    writeStatus(prompter: RegistrationPrompter): void {
        const state = this.registry.read();
        const warnings: string[] = [];
        if(!process.env.AKMS_MCP_MENU) writeField(prompter, "Setup", "npx -y @akms/mcp@latest", "Register · Sync · Runtime");
        if(this.registry.needsMigration(state)) warnings.push("Registry update available. Open Runtime in the AKMS MCP menu to migrate.");
        writeField(prompter, "Services", state.clients.map((id) => CLIENT_LABELS[id]).join(" · ") || "none", "", state.clients.length ? "accent" : "warning");
        if(!state.clients.length) warnings.push("No AI services registered. Choose Register in the AKMS MCP menu before adding a connection.");
        if(this.registry.isSessionMode(this.options.kind, state)) writeField(prompter, "Server", sessionName(this.options.kind), "reconnect clients after changing connections");
        const attention = new Set(this.registry.inspect().filter((item) => this.registry.kindForName(item.name, state) === this.options.kind
            && !["synced", "removed"].includes(item.status)).flatMap(item => item.connections ?? [item.name])).size;
        if(attention) warnings.push(`Needs attention: ${countLabel(attention, "connection")}. Open Sync in the AKMS MCP menu.`);
        const pending = pendingImports(this.registry, this.options.kind).names.length;
        if(pending) warnings.push(`Import available: ${countLabel(pending, "connection")}. Open Sync in the AKMS MCP menu.`);
        if(warnings.length) writeWarning(prompter, warnings.join(" "));
    }

    decorate(items: SelectItem<string>[]): void {
        const results = this.registry.inspect();
        for(const item of items) {
            if("separator" in item) continue;
            const separator = item.value.indexOf(":");
            if(separator < 0) continue;
            const name = item.value.slice(separator + 1);
            const rows = results.filter((row) => row.name === name || this.registry.isSessionMode(this.options.kind) && row.name === sessionName(this.options.kind));
            const count = rows.filter((row) => row.status === "synced").length;
            const total = this.registry.read().clients.length;
            const attention = rows.some((row) => !["synced", "removed"].includes(row.status));
            item.hint = [item.hint, total ? `${attention ? "Needs attention" : "Applied"} ${count}/${total}` : "Register to apply"].filter(Boolean).join(" · ");
        }
    }

    async prepareRuntime(prompter: RegistrationPrompter, existing?: McpServerEntry): Promise<boolean> {
        if(existing && !standardLaunch(existing, this.options.kind)) return true;
        return prepareRuntime(prompter, this.registry, this.options.kind, this.options.version);
    }

    async checkSaved(prompter: RegistrationPrompter, name: string, before?: McpServerEntry): Promise<void> {
        const saved = this.registry.read().connections[name]?.entry;
        if(saved && (!before || entryHash(saved) !== entryHash(before))) await this.registry.checkSaved(prompter, [name]);
    }

    async handle(action: string, prompter: RegistrationPrompter): Promise<boolean> {
        if(action !== "add") return false;
        if(!this.registry.read().clients.length) {
            writeWarning(prompter, "Register an AI service first: choose Register in the AKMS MCP menu, select at least one service, then Apply registration.");
            await prompter.acknowledge();
            return true;
        }
        return !await this.prepareRuntime(prompter);
    }
}

export async function registrationMenu(prompter: RegistrationPrompter, registry: Registry, initialClient?: ClientId): Promise<boolean> {
    const initial = registry.read();
    const selected = new Set(initial.clients);
    if(initialClient) selected.add(initialClient);
    const discovered = registry.candidates(undefined, registry.targets.filter((target) => target.id !== "registered").map((target) => target.id as ClientId));
    let cursor = initialClient ?? registry.targets[0]?.id;
    let privacyNoticeShown = false;
    for(;;) {
        try {
            prompter.clearScreen();
            writeHeading(prompter, "Register · AI services");
            writeHint(prompter, "Toggle services, then Apply. Matching connections are imported; differences stay for review.");
            if(discovered.errors.length) writeWarning(prompter, discovered.errors.join(" "));
            const picked = await prompter.select<string>("Register", [
                ...registry.targets.filter((target) => target.id !== "registered").map((target) => ({
                    value: target.id, label: `[${selected.has(target.id as ClientId) ? "x" : " "}] ${target.label}`,
                    hint: `${initial.clients.includes(target.id as ClientId) ? "Registered" : "Not registered"} · ${discovered.entries.filter((entry) => entry.client === target.id).length} existing AKMS · ${target.detected ? "Found" : "Not detected"} · ${target.location}`,
                })),
                { separator: true }, { value: "apply", key: "a", label: "Apply registration" },
                { value: "back", key: "q", label: "Back" },
            ], { defaultValue: cursor, cancelValue: "back" });
            if(picked === "back") return false;
            if(picked !== "apply") {
                const client = picked as ClientId;
                if(selected.has(client)) selected.delete(client); else selected.add(client);
                cursor = client;
                continue;
            }
            const removed = initial.clients.filter((id) => !selected.has(id));
            const current = registry.read();
            const plan = registry.planRegistration([...selected]);
            const importNames = [...new Set(plan.imports.map((entry) => entry.name))];
            const connections = new Map(Object.entries(current.connections).filter(([, item]) => item.entry).map(([name, item]) => [name, item.kind]));
            for(const item of plan.imports) connections.set(item.name, item.kind);
            const kinds = KINDS.filter(kind => [...connections.values()].includes(kind));
            const sessions = kinds.filter(kind => registry.isSessionMode(kind, current)).map(sessionName);
            const individuals = [...connections].filter(([, kind]) => !registry.isSessionMode(kind, current)).map(([name]) => name);
            const imported = new Set(plan.imports.map(item => `${item.client}:${item.name}:${entryHash(item.entry)}`));
            const retiring = discovered.entries.filter(item => selected.has(item.client) && connections.has(item.name) && registry.isSessionMode(item.kind, current));
            const owned = (item: ImportCandidate) => imported.has(`${item.client}:${item.name}:${entryHash(item.entry)}`)
                || (Object.hasOwn(current.connections, item.name) && current.connections[item.name].applied[item.client] === entryHash(item.entry));
            const replaces = [...new Set(retiring.filter(owned).map(item => item.name))];
            const kept = [...new Set([...plan.conflicts, ...retiring.filter(item => !owned(item)).map(item => item.name)])];
            prompter.clearScreen();
            writeHeading(prompter, "Review registration");
            writeField(prompter, "Services", [...selected].map((id) => CLIENT_LABELS[id]).join(" · ") || "none");
            writeField(prompter, "Connections", String(connections.size), kinds.length ? `(${kinds.map(kind => `${KIND_LABELS[kind]} ${[...connections.values()].filter(value => value === kind).length}`).join(" · ")})` : "");
            writeField(prompter, "Entries", [...sessions, ...(individuals.length ? [`${individuals.length} individual entries`] : [])].join(" · ") || "none", "in each service");
            if(replaces.length) writeField(prompter, "Replaces", `${replaces.length} individual entries`, `with ${sessions.join(" · ")}`);
            if(importNames.length) writeField(prompter, "Import", countLabel(importNames.length, "matching connection"));
            if(kept.length) writeField(prompter, "Kept", `${kept.length} need a version choice`, kept.join(", "), "warning");
            if(plan.errors.length) writeField(prompter, "Unavailable", countLabel(plan.errors.length, "service"), plan.errors.join(" "), "error");
            if(initial.defaultMode === "catalog") {
                if(plan.imports.some(item => !registry.globalRuntime(item.kind))) writeField(prompter, "Runtime", "Waiting", "install from Runtime, then Sync; existing entries stay", "warning");
                if(plan.imports.some(item => !standardLaunch(item.entry, item.kind))) writeHint(prompter, "Custom commands are not started; the grouped entry loads their saved settings.");
            }
            if(removed.length) writeField(prompter, "Unregister", removed.map((id) => CLIENT_LABELS[id]).join(" · "), "remove managed entries; keep the catalog");
            if(!privacyNoticeShown) {
                writeWarning(prompter, `Plaintext passwords: ${registry.file} + registry.previous.json. Do not share, sync or commit.`);
                privacyNoticeShown = true;
            }
            if(!await prompter.askYesNo("Apply this registration?", removed.length === 0)) continue;
            const results = registry.register([...selected], initial.clients, plan.imports);
            prompter.clearScreen();
            writeHeading(prompter, "Registration saved.");
            writeField(prompter, "Services", [...selected].map((id) => CLIENT_LABELS[id]).join(" · ") || "none");
            prompter.write(`${registry.formatResults(results, "", prompter.paint)}\n`);
            if(importNames.length) writeField(prompter, "Imported", countLabel(importNames.length, "connection"), "saved in the shared catalog", "success");
            try {
                const conflicts = new Set(results.filter((result) => result.status === "conflict").map((result) => result.name));
                if(conflicts.size && await prompter.askYesNo(`Compare settings for ${conflicts.size} connection(s) now?`, true)) await syncMenu(prompter, registry);
                const current = registry.read();
                const remaining = registry.candidates().entries.filter((candidate) => !Object.hasOwn(current.connections, candidate.name));
                const names = [...new Set(remaining.map((candidate) => candidate.name))];
                if(names.length) {
                    writeField(prompter, "Not imported", countLabel(names.length, "connection"), "choose a version", "warning");
                    for(const name of names) {
                        const copies = remaining.filter((candidate) => candidate.name === name);
                        writeField(prompter, name, copies.map((copy) => CLIENT_LABELS[copy.client]).join(" · "));
                        if(new Set(copies.map((copy) => entryHash(copy.entry))).size > 1) writeHint(prompter, `  ${describeDifferences(copies.map((copy) => copy.entry))}`);
                    }
                    writeHint(prompter, "Existing settings stay. Compare now or open Import existing connections later.");
                    if(await prompter.askYesNo("Compare existing settings and choose which to share?", true)) await importMenu(prompter, registry);
                }
                if(!conflicts.size && !names.length) await prompter.acknowledge();
            } catch(error) {
                // Registration already succeeded. Esc skips the optional review instead
                // of reopening an obsolete registration draft.
                if(!(error instanceof PromptBackError)) throw error;
            }
            return true;
        } catch(error) {
            if(error instanceof PromptClosedError) throw error;
            if(error instanceof PromptBackError) continue;
            writeWarning(prompter, error instanceof Error ? error.message : "Registration could not be saved.");
            await prompter.acknowledge();
        }
    }
}

export async function importMenu(prompter: RegistrationPrompter, registry: Registry, kind?: McpKind): Promise<void> {
    for(;;) {
        prompter.clearScreen();
        writeHeading(prompter, "Import existing connections");
        const { entries, errors } = registry.candidates(kind);
        for(const error of errors) writeWarning(prompter, error);
        const state = registry.read();
        const matching = registry.planRegistration(state.clients, kind);
        const matchingNames = [...new Set(matching.imports.map((entry) => entry.name))];
        const names = [...new Set(entries.filter((candidate) => {
            const current = Object.hasOwn(state.connections, candidate.name) ? state.connections[candidate.name] : undefined;
            return !current?.entry || current.applied[candidate.client] !== entryHash(candidate.entry) || entryHash(current.entry) !== entryHash(candidate.entry);
        }).map((entry) => entry.name))];
        if(!names.length) { writeHint(prompter, "No existing connections need importing."); await prompter.acknowledge(); return; }
        writeField(prompter, "Available", countLabel(names.length, "connection"), `${matchingNames.length} matching`);
        const picked = await prompter.select("Import existing connections", [
            ...names.map((name) => ({ value: `entry:${name}`, key: name, label: name, hint: [...new Set(entries.filter((entry) => entry.name === name).map((entry) => CLIENT_LABELS[entry.client]))].join(" · ") })),
            ...(matchingNames.length ? [{ value: "matching", key: "all", label: "Import all matching connections", hint: `${matchingNames.length} connections; differing versions stay unchanged` }] : []),
            { value: "back", key: "b", label: "Back" },
        ], { cancelValue: "back" });
        if(picked === "back") return;
        try {
            prompter.clearScreen();
            if(picked === "matching") {
                writeHeading(prompter, "Review import");
                writeField(prompter, "Connections", String(matchingNames.length), matchingNames.join(", "));
                writeField(prompter, "Services", state.clients.map(client => CLIENT_LABELS[client]).join(" · ") || "none");
                if(await prompter.askYesNo("Import matching connections and apply them?", true)) {
                    const results = registry.register(state.clients, state.clients, matching.imports);
                    prompter.clearScreen();
                    prompter.write(`${registry.formatResults(results, "Import complete", prompter.paint)}\n`);
                    await prompter.acknowledge();
                }
                continue;
            }
            const name = picked.slice(6);
            const candidates = entries.filter((entry) => entry.name === name);
            let chosen: ImportCandidate = candidates[0];
            if(new Set(candidates.map((candidate) => entryHash(candidate.entry))).size > 1) {
                writeHeading(prompter, `Compare ${name}`);
                writeField(prompter, "Services", state.clients.map(client => CLIENT_LABELS[client]).join(" · ") || "none");
                compareEntries(prompter, candidates.map((candidate) => ({ label: CLIENT_LABELS[candidate.client], entry: candidate.entry })));
                const choice = await prompter.select("Use settings from", [
                    ...candidates.map((candidate, index) => ({ value: String(index), label: `Use ${index + 1}: ${CLIENT_LABELS[candidate.client]}` })),
                    { value: "back", label: "Back" },
                ], { cancelValue: "back" });
                if(choice === "back") continue;
                chosen = candidates[Number(choice)];
            }
            writeField(prompter, "Connection", name);
            writeField(prompter, "Version", CLIENT_LABELS[chosen.client]);
            preview(prompter, chosen.entry);
            const destination = await prompter.askRequired("Shared connection name (change it to keep both)", name);
            writeField(prompter, "Apply to", state.clients.map(client => CLIENT_LABELS[client]).join(" · ") || "none");
            if(!await prompter.askYesNo(`Import ${destination} and apply it?`, true)) continue;
            const results = registry.importEntry(destination, chosen, candidates);
            prompter.clearScreen();
            prompter.write(`\n${registry.formatResults(results, "Import complete", prompter.paint)}\n`);
            if(destination !== name) writeField(prompter, "Kept", name, "original entries retain this name", "warning");
            await prompter.acknowledge();
        } catch(error) {
            if(error instanceof PromptClosedError) throw error;
            if(error instanceof PromptBackError) continue;
            writeWarning(prompter, error instanceof Error ? error.message : "Import failed.");
            await prompter.acknowledge();
        }
    }
}

export async function syncMenu(prompter: RegistrationPrompter, registry: Registry): Promise<void> {
    let pendingResults: SyncResult[] | undefined;
    for(;;) {
        prompter.clearScreen();
        const results = pendingResults ?? registry.sync();
        pendingResults = undefined;
        prompter.write(`\n${registry.formatResults(results, "Sync results", prompter.paint, "Next: choose an item below to compare settings and pick a version.")}\n`);
        const imports = pendingImports(registry);
        if(imports.names.length) writeField(prompter, "Not imported", countLabel(imports.names.length, "connection"), `${imports.differing === imports.names.length ? "different settings · " : ""}choose Import existing connections`, "warning");
        const conflicts = results.filter((result) => result.status === "conflict");
        if(!conflicts.length && !imports.names.length) { await prompter.acknowledge(); return; }
        const picked = await prompter.select("Review differences", [
            ...conflicts.map((item, index) => ({ value: String(index), label: `${CLIENT_LABELS[item.client]} · ${item.name}` })),
            ...(imports.names.length ? [{ value: "import", key: "import", label: "Import existing connections", hint: `${imports.names.length} connection(s) to review` }] : []),
            { value: "back", key: "b", label: "Later — keep existing settings" },
        ], { cancelValue: "back" });
        if(picked === "back") return;
        try {
            if(picked === "import") { await importMenu(prompter, registry); continue; }
            prompter.clearScreen();
            const conflict = conflicts[Number(picked)];
            const state = registry.read();
            const sessionKind = Object.keys(state.sessions ?? {}).find(kind => sessionName(kind as McpKind) === conflict.name) as McpKind | undefined;
            if(sessionKind) {
                const session = state.sessions![sessionKind]!;
                const actual = registry.targets.find(target => target.id === conflict.client)?.readEntries()[conflict.name];
                if(!actual || entryKind(actual) !== sessionKind) {
                    writeWarning(prompter, "This name belongs to another server. Rename its external entry; existing settings stay.");
                    await prompter.acknowledge(); continue;
                }
                const removing = !registry.isSessionMode(sessionKind, state) || !state.clients.includes(conflict.client)
                    || !Object.values(state.connections).some(item => item.kind === sessionKind && item.entry);
                writeHeading(prompter, "Review session launch");
                writeField(prompter, "Server", conflict.name);
                writeField(prompter, "Service", CLIENT_LABELS[conflict.client]);
                compareEntries(prompter, [{ label: "AKMS session launch", entry: session.entry }, { label: "External settings", entry: actual }]);
                const choice = await prompter.select("Resolve session launch", [
                    { value: "apply", label: removing ? "Remove the old session entry" : "Restore the AKMS session launch" },
                    { value: "back", key: "b", label: "Keep external settings for now" },
                ], { cancelValue: "back" });
                if(choice === "apply" && await prompter.askYesNo(removing ? "Remove this session entry?" : "Replace these external launch settings?", false)) pendingResults = registry.resolve(conflict.client, conflict.name, actual, false);
                continue;
            }
            const connection = state.connections[conflict.name];
            if(!connection) throw new Error("This connection changed. Reopen Sync to review its current settings.");
            const actual = registry.targets.find((target) => target.id === conflict.client)?.readEntries()[conflict.name];
            if(!actual || entryKind(actual) !== connection.kind) {
                writeWarning(prompter, "This name belongs to another server. Rename that entry or the shared connection.");
                await prompter.acknowledge();
                continue;
            }
            const client = CLIENT_LABELS[conflict.client];
            const registered = state.clients.includes(conflict.client);
            const sessionMode = registry.isSessionMode(connection.kind, state);
            const removing = !connection.entry || !registered;
            const retiring = sessionMode && !removing;
            const subject = connection.entry && descriptionOnly([connection.entry, actual]) ? "description" : "settings";
            writeHeading(prompter, `Sync / ${conflict.name}`);
            writeField(prompter, "Services", state.clients.map((id) => CLIENT_LABELS[id]).join(" · ") || "none");
            prompter.write("\n");
            if(!removing && connection.entry) {
                if(retiring) {
                    writeField(prompter, "Server", sessionName(connection.kind));
                    writeField(prompter, "Kept in", client, "old entry stays until this server is ready", "warning");
                }
                compareEntries(prompter, [{ label: "Saved in AKMS", entry: connection.entry }, { label: `Currently in ${client}`, entry: actual }]);
            } else {
                writeField(prompter, "Action", !registered ? `${client} unregistered` : "Remove connection", "", "warning");
                writeHint(prompter, `Settings changed in ${client}; choose what to keep.`);
                writeHeading(prompter, `Currently in ${client}`); preview(prompter, actual);
                prompter.write("\n");
            }
            const choices: SelectItem<string>[] = [
                { value: "shared", label: removing ? `Remove from ${client}` : retiring ? "Use 1: keep AKMS settings" : `Use 1: AKMS -> ${client}`, hint: removing ? "finish the pending removal" : retiring ? `use version 1 in ${sessionName(connection.kind)}` : `replace its ${subject} with version 1` },
                ...(registered ? [{ value: "client", label: removing ? `Restore from ${client}` : `Use 2: ${client} -> all ${state.clients.length} services`, hint: retiring ? `save version 2 in AKMS for ${sessionName(connection.kind)}` : "save in AKMS and sync registered services" }] : []),
                { value: "back", key: "b", label: "Back without changes" },
            ];
            const choice = await prompter.select(removing ? (registered ? "Remove or restore this connection?" : `Remove this connection from ${client}?`) : `Which ${subject} should be used?`, choices, { cancelValue: "back" });
            if(choice === "back") continue;
            prompter.write("\n");
            if(choice === "client") {
                writeField(prompter, "Save version", client, "in AKMS");
                writeField(prompter, "Apply to", state.clients.map((id) => CLIENT_LABELS[id]).join(" · "));
            } else writeField(prompter, removing ? "Remove" : "Keep version", removing ? `${conflict.name} in ${client}` : "AKMS", removing ? "" : retiring ? `for ${sessionName(connection.kind)}` : `apply ${subject} to ${client}`);
            if(retiring) writeHint(prompter, `The old ${client} entry stays until ${sessionName(connection.kind)} is ready.`);
            const confirmation = choice === "client" ? `Save in AKMS and sync ${state.clients.length} services?`
                : removing ? `Remove from ${client}?` : retiring ? "Keep version 1 and finish Sync?" : `Update ${client} with version 1?`;
            if(await prompter.askYesNo(confirmation, false)) {
                pendingResults = registry.resolve(conflict.client, conflict.name, actual, choice === "client");
            }
        } catch(error) {
            if(error instanceof PromptClosedError) throw error;
            if(error instanceof PromptBackError) continue;
            prompter.write(`${prompter.paint.error("Failed")} ${screenText(error instanceof Error ? error.message : "Could not resolve the difference.")}\n`);
            await prompter.acknowledge();
        }
    }
}
