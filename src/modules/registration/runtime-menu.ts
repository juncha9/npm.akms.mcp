import { PACKAGE_VERSION } from "../../_defs";
import { Registry, entryHash, sessionName } from "./registry";
import type { SyncResult } from "./registry";
import { CLIENT_LABELS, KIND_LABELS, KINDS } from "./types";
import type { McpKind } from "./types";
import { PACKAGE_NAME, runtimeIsOlder, runtimePrefix } from "./runtime";
import { plainText, writeWrapped } from "./comparison";
import { redactStartupText } from "./startup-check";
import { migrationMenu, migrationStatus, migrationVersions } from "./migration-menu";
import { PromptBackError, PromptClosedError, type RegistrationPrompter, type SelectItem } from "./prompter";

export async function prepareRuntime(prompter: RegistrationPrompter, registry: Registry, kind: McpKind, version = PACKAGE_VERSION): Promise<boolean> {
    const installed = registry.globalRuntime(kind);
    if(installed) {
        if(installed.linked || !runtimeIsOlder(installed.version, version)) return true;
        prompter.clearScreen();
        writeWrapped(prompter, `Installed runtime: ${installed.version}. This setup: ${version}.`);
        if(!await prompter.askYesNo("Update the AKMS runtime to the latest release before continuing?", true)) return true;
    }
    prompter.clearScreen();
    writeWrapped(prompter, `Installing ${PACKAGE_NAME}@latest in ${runtimePrefix()}...`);
    prompter.write("Installation runs during setup. Saved connections will start Node directly.\n");
    try {
        await registry.installRuntime(kind);
        prompter.clearScreen();
        return true;
    } catch(error) {
        prompter.write(`${error instanceof Error ? error.message : "AKMS runtime installation failed."}\n`);
        // A failed npm update may have removed files; only continue with a runtime
        // that is still discoverable, never with a stale pre-install snapshot.
        const available = installed ? registry.globalRuntime(kind) : null;
        if(available) writeWrapped(prompter, `Continuing with installed runtime ${available.version}. You can retry the update from Runtime.`);
        await prompter.acknowledge();
        return Boolean(available);
    }
}

/** The newest version known to be ahead of the installed one: this setup's own, or npm's latest once checked. */
function updateTarget(installed: string, latest: string | null | undefined): string | null {
    let target: string | null = null;
    for(const candidate of [PACKAGE_VERSION, latest]) {
        if(typeof candidate !== "string" || !runtimeIsOlder(installed, candidate)) continue;
        if(target == null || runtimeIsOlder(target, candidate)) target = candidate;
    }
    return target;
}

/** Notice for the menu row that opens Runtime — read from disk only, so the menu opens at once. */
export function runtimeNotice(registry: Registry): { hint: string; notice?: string } {
    const installed = registry.installedRuntime();
    if(!installed) return { hint: PACKAGE_NAME, notice: "Not installed" };
    const notices: string[] = [];
    const migration = migrationStatus(registry).status;
    if(migration === "ready") notices.push("Registry update available");
    else if(migration === "blocked") notices.push("Registry update blocked");
    const target = installed.linked ? null : updateTarget(installed.version, undefined);
    if(target) notices.push(`Update available ${target}`);
    const hint = `${PACKAGE_NAME} ${installed.version}${installed.linked ? " · development link" : ""}`;
    return notices.length ? { hint, notice: notices.join(" · ") } : { hint };
}

function connectionNames(registry: Registry, kind?: McpKind): string[] {
    return Object.entries(registry.read().connections).filter(([, item]) => item.entry && (!kind || item.kind === kind)).map(([name]) => name);
}

/** Kinds whose akms_<kind> entry no longer starts the installed runtime, e.g. after Node or the runtime folder moved. */
function outdatedKinds(registry: Registry): McpKind[] {
    return KINDS.filter(kind => {
        if(!registry.isSessionMode(kind) || !registry.globalRuntime(kind)) return false;
        const saved = registry.read().sessions?.[kind]?.entry;
        try { return saved != null && entryHash(saved) !== entryHash(registry.sessionEntry(kind)); }
        catch { return false; }
    });
}

async function installOrUpdate(prompter: RegistrationPrompter, registry: Registry): Promise<void> {
    const paint = prompter.paint;
    prompter.clearScreen();
    prompter.write(`Installing ${paint.accent(`${PACKAGE_NAME}@latest`)} into ${plainText(runtimePrefix())}...\n`);
    try {
        const runtime = await registry.installRuntime();
        prompter.write(`${paint.success("Installed")} ${PACKAGE_NAME} ${paint.accent(runtime.version)}.\n`);
        const names = connectionNames(registry);
        if(names.length) await registry.checkSaved(prompter, names);
        prompter.write("Reconnect or restart your AI clients to load it.\n");
        if(migrationStatus(registry).status === "ready") prompter.write(paint.warning("! Registry update available. Choose Migrate registry below.\n"));
    } catch(error) {
        let detail = error instanceof Error ? error.message : "Installation failed.";
        for(const item of Object.values(registry.read().connections)) if(item.entry) detail = redactStartupText(detail, item.entry);
        prompter.write(`${paint.error("Failed")} ${plainText(detail)}\n`);
        if(/\b(?:EBUSY|EPERM|EACCES)\b/i.test(detail)) prompter.write("Close your AI clients, then retry. A running server may have locked its files.\n");
    }
    await prompter.acknowledge();
}

/** Install, update and clean up @akms/mcp. How connections are listed in AI services is one level down. */
export async function runtimeMenu(prompter: RegistrationPrompter, registry: Registry): Promise<void> {
    // undefined: not checked in this visit; null: npm could not be reached
    let latest: string | null | undefined;
    for(;;) {
        try {
            prompter.clearScreen();
            const paint = prompter.paint;
            const installed = registry.installedRuntime();
            const target = installed && !installed.linked ? updateTarget(installed.version, latest) : null;

            // (1) Where the runtime stands: the package, its folder, and any 0.3.x packages beside it
            const legacy = registry.legacyRuntimes();
            const removable = legacy.filter(item => !item.usedBy.length);
            const inUse = legacy.filter(item => item.usedBy.length);
            const migration = migrationStatus(registry);
            // "@akms/mcp-db, @akms/mcp-ssh 0.3.2": names sharing a version are listed once with it.
            const packages = (list: typeof legacy) => [...new Set(list.map(item => item.runtime.version))]
                .map(version => `${list.filter(item => item.runtime.version === version).map(item => item.runtime.packageName).join(", ")} ${version}`).join("; ");
            const row = (label: string, value: string) => prompter.write(`  ${paint.dim(label.padEnd(10))}${value}\n`);
            prompter.write(`${paint.bold("Runtime")}   ${PACKAGE_NAME} ${installed ? paint.accent(installed.version) : paint.warning("not installed")}${installed?.linked ? paint.dim("  development link") : ""}\n`);
            row("Location", plainText(runtimePrefix()));
            if(inUse.length) row("In use", `${paint.warning(packages(inUse))} ${paint.dim("· old packages")}`);
            if(removable.length) row("Unused", `${packages(removable)} ${paint.dim("· old packages")}`);
            if(latest === null) prompter.write(paint.warning("! Could not reach npm to check for updates.\n"));
            else if(latest !== undefined && installed && !target) prompter.write(`${paint.success("Up to date")} ${paint.dim(`· latest ${latest}`)}\n`);

            // (2) While an upgrade from the per-kind packages is unfinished: what is done and what comes next
            const upgrading = legacy.length > 0 || migration.status !== "none";
            let next: "install" | "migrate" | "remove" | null = null;
            if(upgrading) {
                const plan = migration.status === "none" ? null : registry.planMigration();
                const sessions = (plan?.launches ?? []).flatMap(item => item.names.filter(name => /^akms_/.test(name)));
                const pairs = migration.status === "ready" ? migrationVersions(registry, plan ?? undefined) : [];
                const moves = pairs.map(pair => pair.label === "Registry" ? `registry ${pair.from} → ${pair.to}` : `${pair.from} → ${pair.to}`).join(" · ");
                const steps = [
                    { id: "install" as const, label: `Install ${PACKAGE_NAME}`, done: installed != null, blocked: false,
                        detail: installed ? installed.version : "one package for every kind" },
                    { id: "migrate" as const, label: "Migrate registry", done: migration.status === "none", blocked: migration.status === "blocked",
                        detail: migration.status === "none" ? "" : migration.status === "blocked" ? plainText(migration.detail ?? "")
                            : moves || (sessions.length ? `moves ${sessions.join(", ")} to ${PACKAGE_NAME}` : "one akms_<kind> entry per kind") },
                    { id: "remove" as const, label: "Remove old packages", done: legacy.length === 0, blocked: false,
                        detail: inUse.length && migration.status === "none" ? "run Sync first: an AI service still starts them" : "then restart your AI clients" },
                ];
                prompter.write(`\n${paint.bold("Upgrade steps")}\n`);
                for(const [index, step] of steps.entries()) {
                    let state = paint.dim("later  ");
                    if(step.done) state = paint.success("done   ");
                    else if(step.blocked) state = paint.error("blocked");
                    else if(next == null) { state = paint.warning("next   "); next = step.id; }
                    const label = step.done ? paint.dim(step.label.padEnd(22)) : step.id === next ? paint.bold(step.label.padEnd(22)) : step.label.padEnd(22);
                    prompter.write(`  ${paint.dim(`${index + 1}`)}  ${label}${state}  ${step.id === next ? step.detail : paint.dim(step.detail)}\n`);
                }
            }
            prompter.write("\n");

            // (3) Only what can be done now; the next upgrade step starts under the cursor
            const items: SelectItem<string>[] = [];
            if(!installed) items.push({ value: "install", key: "install", label: `Install ${PACKAGE_NAME}`, hint: upgrading ? "step 1" : "one package for every kind" });
            else if(target) items.push({ value: "update", key: "update", label: `Update to ${target}`, hint: `installed ${installed.version}` });
            else if(!installed.linked) items.push({ value: "check", key: "check", label: "Check for updates", hint: "asks npm for the latest release" });
            if(migration.status === "ready") {
                // "step 2 · @akms/mcp-db 0.3.2 →" dimmed, then the destination in green.
                const pairs = migrationVersions(registry).map(pair => pair.label === "Registry" ? { from: `registry ${pair.from}`, to: pair.to } : pair);
                const last = pairs.at(-1);
                items.push({ value: "migrate", key: "migrate", label: "Migrate registry",
                    hint: last ? ["step 2", ...pairs.slice(0, -1).map(pair => `${pair.from} → ${pair.to}`), `${last.from} →`].join(" · ") : "step 2 · one akms_<kind> entry per kind",
                    ...(last ? { notice: last.to, noticeTone: "success" as const } : {}) });
            }
            // An old launch is the migration's job while it is pending; only after it does this row appear.
            const outdated = migration.status === "none" ? outdatedKinds(registry) : [];
            if(outdated.length) items.push({ value: "relaunch", key: "relaunch", label: "Update launch commands", hint: outdated.map(sessionName).join(", "), notice: "out of date" });
            if(removable.length) {
                items.push({ value: "remove", key: "remove", label: inUse.length ? "Remove unused packages" : "Remove old packages",
                    hint: `${inUse.length ? "" : "step 3 · "}${removable.map(item => item.runtime.packageName).join(", ")}` });
            }
            items.push({ value: "back", key: "b", label: "Back" });
            const defaultValue = next === "migrate" && migration.status === "ready" ? "migrate" : next === "remove" && removable.length && !inUse.length ? "remove" : undefined;
            const picked = await prompter.select("Runtime", items, { cancelValue: "back", ...(defaultValue ? { defaultValue } : {}) });

            if(picked === "back") return;
            if(picked === "migrate") { await migrationMenu(prompter, registry); continue; }
            if(picked === "install" || picked === "update") { await installOrUpdate(prompter, registry); latest = undefined; continue; }
            if(picked === "check") {
                prompter.write(`Checking the latest ${PACKAGE_NAME} release...\n`);
                latest = await registry.latestRuntime();
                continue;
            }
            if(picked === "relaunch") { await updateLaunchCommands(prompter, registry, outdated); continue; }
            if(picked === "remove") {
                prompter.clearScreen();
                prompter.write(`${paint.bold("Remove old packages")}\n`);
                for(const item of removable) prompter.write(`  ${item.runtime.packageName} ${paint.dim(`${item.runtime.version}${item.runtime.linked ? " · development link (the checkout stays)" : ""}`)}\n`);
                prompter.write(paint.dim("No AI service starts them any more; every kind now runs from @akms/mcp.\n"));
                if(!await prompter.askYesNo("Remove these packages?", false)) continue;
                await registry.removeLegacyRuntimes(removable.map(item => item.runtime.kind));
                prompter.write(`${paint.success("Removed")} ${removable.map(item => item.runtime.packageName).join(", ")}.\n`);
                await prompter.acknowledge();
            }
        } catch(error) {
            if(error instanceof PromptClosedError) throw error;
            if(error instanceof PromptBackError) continue;
            prompter.write(`${error instanceof Error ? plainText(error.message) : "Could not configure the AKMS runtime."}\n`);
            await prompter.acknowledge();
        }
    }
}

/** Point each out-of-date akms_<kind> entry at the installed runtime; connection settings stay in the catalog. */
async function updateLaunchCommands(prompter: RegistrationPrompter, registry: Registry, kinds: McpKind[]): Promise<void> {
    const paint = prompter.paint;
    prompter.clearScreen();
    prompter.write(`${paint.bold("Update launch commands")}\n`);
    for(const kind of kinds) prompter.write(`  ${paint.dim(sessionName(kind).padEnd(10))}${paint.accent(plainText(registry.sessionEntry(kind).args[0]))} --catalog\n`);
    prompter.write(paint.dim("Only the command that starts each entry changes; connection settings stay in the catalog.\n"));
    if(!await prompter.askYesNo("Update these entries?", true)) return;
    const results: SyncResult[] = [];
    for(const kind of kinds) results.push(...registry.applySession(registry.planSession(kind, "catalog")));
    prompter.clearScreen();
    prompter.write(`${registry.formatResults(results, "Launch commands saved.", prompter.paint)}\n`);
    const connections = registry.read().connections;
    await registry.checkSaved(prompter, connectionNames(registry).filter(name => kinds.includes(connections[name].kind)));
    prompter.write("Restart or reconnect your AI clients to use them.\n");
    await prompter.acknowledge();
}
