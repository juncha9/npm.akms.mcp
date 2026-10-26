import { PACKAGE_VERSION } from "../../_defs";
import { Registry, entryHash, sessionName } from "./registry";
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

const connectionCount = (count: number) => `${count} connection${count === 1 ? "" : "s"}`;

function layoutLabel(registry: Registry, kind: McpKind): string {
    return registry.isSessionMode(kind) ? `one server (${sessionName(kind)})` : "one entry per connection";
}

/** True when the saved launch of this kind no longer matches the installed runtime. */
function launchOutdated(registry: Registry, kind: McpKind): boolean {
    if(!registry.globalRuntime(kind)) return false;
    try {
        if(registry.isSessionMode(kind)) {
            const saved = registry.read().sessions?.[kind]?.entry;
            return saved != null && entryHash(saved) !== entryHash(registry.sessionEntry(kind));
        }
        return registry.planRuntime(kind).names.length > 0;
    } catch { return false; }
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

/** Install, update and clean up @akms/mcp. The per-kind server layout is one level down. */
export async function runtimeMenu(prompter: RegistrationPrompter, registry: Registry): Promise<void> {
    // undefined: not checked in this visit; null: npm could not be reached
    let latest: string | null | undefined;
    for(;;) {
        try {
            prompter.clearScreen();
            const paint = prompter.paint;
            const installed = registry.installedRuntime();
            const target = installed && !installed.linked ? updateTarget(installed.version, latest) : null;

            // (1) Where the runtime stands
            if(!installed) prompter.write(`${paint.bold("Runtime")}  ${paint.warning("not installed")}\n`);
            else prompter.write(`${paint.bold("Runtime")}  ${PACKAGE_NAME} ${paint.accent(installed.version)}${installed.linked ? paint.dim("  development link") : ""}\n`);
            prompter.write(`${paint.dim("Location")}  ${plainText(runtimePrefix())}\n`);
            if(latest === null) prompter.write(paint.warning("! Could not reach npm to check for updates.\n"));
            else if(latest !== undefined && installed && !target) prompter.write(`${paint.success("Up to date")} ${paint.dim(`· latest ${latest}`)}\n`);
            const legacy = registry.legacyRuntimes();
            const removable = legacy.filter(item => !item.usedBy.length);
            const inUse = legacy.filter(item => item.usedBy.length);
            const migration = migrationStatus(registry);
            if(migration.status === "waiting") prompter.write(paint.warning(`! Registry update waits: ${plainText(migration.detail ?? "")}\n`));
            if(migration.status === "blocked") prompter.write(paint.warning(`! Registry update blocked: ${plainText(migration.detail ?? "")}\n`));
            if(inUse.length) prompter.write(paint.warning(`! Old packages still in use: ${inUse.map(item => `${item.runtime.packageName} ${item.runtime.version}`).join(", ")}. Migrate the registry (and Sync) before removing them.\n`));
            prompter.write("\n");

            // (2) Only what can be done now
            const items: SelectItem<string>[] = [];
            if(!installed) items.push({ value: "install", key: "install", label: "Install AKMS MCP", hint: `into ${plainText(runtimePrefix())}` });
            else if(target) items.push({ value: "update", key: "update", label: `Update to ${target}`, hint: `installed ${installed.version}` });
            else if(!installed.linked) items.push({ value: "check", key: "check", label: "Check for updates", hint: "asks npm for the latest release" });
            if(migration.status === "ready") {
                // "registry v1 → v2 · @akms/mcp-db 0.3.2 →" dimmed, then the destination in green.
                const pairs = migrationVersions(registry).map(pair => pair.label === "Registry" ? { from: `registry ${pair.from}`, to: pair.to } : pair);
                const last = pairs.at(-1);
                items.push({ value: "migrate", key: "migrate", label: "Migrate registry",
                    hint: last ? [...pairs.slice(0, -1).map(pair => `${pair.from} → ${pair.to}`), `${last.from} →`].join(" · ") : "one server per kind becomes the default",
                    ...(last ? { notice: last.to, noticeTone: "success" as const } : {}) });
            }
            const outdated = KINDS.filter(kind => launchOutdated(registry, kind));
            items.push({ value: "layout", key: "layout", label: "Server layout", hint: layoutSummary(registry),
                ...(outdated.length ? { notice: `${outdated.map(kind => KIND_LABELS[kind]).join(", ")}: launch out of date` } : {}) });
            if(removable.length) items.push({ value: "remove", key: "remove", label: "Remove old packages", hint: `${removable.map(item => item.runtime.packageName).join(", ")} · not used` });
            items.push({ value: "back", key: "b", label: "Back" });
            const picked = await prompter.select("Runtime", items, { cancelValue: "back", ...(migration.status === "ready" ? { defaultValue: "migrate" } : {}) });

            if(picked === "back") return;
            if(picked === "migrate") { await migrationMenu(prompter, registry); continue; }
            if(picked === "install" || picked === "update") { await installOrUpdate(prompter, registry); latest = undefined; continue; }
            if(picked === "check") {
                prompter.write(`Checking the latest ${PACKAGE_NAME} release...\n`);
                latest = await registry.latestRuntime();
                continue;
            }
            if(picked === "layout") { await serverLayoutMenu(prompter, registry); continue; }
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

function layoutSummary(registry: Registry): string {
    const used = KINDS.filter(kind => connectionNames(registry, kind).length);
    if(!used.length) return "no connections yet";
    const layouts = new Set(used.map(kind => registry.isSessionMode(kind)));
    if(layouts.size === 1) return layouts.has(true) ? "one server per kind" : "one entry per connection";
    return used.map(kind => `${KIND_LABELS[kind]} ${registry.isSessionMode(kind) ? "one server" : "per connection"}`).join(" · ");
}

async function serverLayoutMenu(prompter: RegistrationPrompter, registry: Registry): Promise<void> {
    let defaultValue: string | undefined;
    for(;;) {
        prompter.clearScreen();
        const paint = prompter.paint;
        prompter.write(`${paint.bold("Server layout")}\n`);
        prompter.write(paint.dim("One server per kind keeps passwords in the catalog only. Per-connection entries copy them into each AI service.\n\n"));
        const state = registry.read();
        const migrated = !registry.needsMigration(state);
        const items: SelectItem<string>[] = KINDS.map(kind => {
            const count = connectionNames(registry, kind).length;
            return {
                value: kind, key: kind, label: KIND_LABELS[kind],
                hint: count ? `${layoutLabel(registry, kind)} · ${connectionCount(count)}` : `no connections · new ones use ${layoutLabel(registry, kind)}`,
                ...(launchOutdated(registry, kind) ? { notice: "launch out of date" } : {}),
            };
        });
        items.push({ separator: true });
        if(migrated) items.push({ value: "default", key: "default", label: "New kinds", hint: state.defaultMode === "catalog" ? "one server" : "one entry per connection" });
        items.push({ value: "back", key: "b", label: "Back" });
        const picked = await prompter.select("Server layout", items, { defaultValue, cancelValue: "back" });
        if(picked === "back") return;
        defaultValue = picked;
        if(picked === "default") {
            const mode = state.defaultMode === "catalog" ? "individual" : "catalog";
            prompter.write(`New kinds will use ${mode === "catalog" ? "one server" : "one entry per connection"}. Existing kinds keep their layout.\n`);
            if(await prompter.askYesNo("Change the layout for new kinds?", false)) {
                prompter.write(`${registry.formatResults(registry.setDefaultMode(mode), "Layout for new kinds saved.", prompter.paint)}\n`);
                await prompter.acknowledge();
            }
            continue;
        }
        try { await kindLayoutMenu(prompter, registry, picked as McpKind); }
        catch(error) {
            if(error instanceof PromptClosedError) throw error;
            if(error instanceof PromptBackError) continue;
            prompter.write(`${error instanceof Error ? plainText(error.message) : "Could not change the server layout."}\n`);
            await prompter.acknowledge();
        }
    }
}

async function kindLayoutMenu(prompter: RegistrationPrompter, registry: Registry, kind: McpKind): Promise<void> {
    const paint = prompter.paint;
    prompter.clearScreen();
    const sessionMode = registry.isSessionMode(kind);
    const installed = registry.globalRuntime(kind);
    prompter.write(`${paint.bold(KIND_LABELS[kind])}  ${layoutLabel(registry, kind)} ${paint.dim(`· ${connectionCount(connectionNames(registry, kind).length)}`)}\n`);
    if(!installed) prompter.write(paint.warning("! Install AKMS MCP from Runtime before changing the layout.\n"));
    prompter.write("\n");
    const outdated = launchOutdated(registry, kind);
    const items: SelectItem<string>[] = [
        ...(outdated ? [{ value: "relaunch", key: "relaunch", label: sessionMode ? "Update launch command" : "Update launch commands", hint: `start ${PACKAGE_NAME} ${installed!.version}` }] : []),
        ...(installed && !sessionMode ? [{ value: "catalog", key: "catalog", label: `Switch to one server (${sessionName(kind)})`, hint: "one entry per AI service" }] : []),
        ...(sessionMode && (installed || registry.read().sessions?.[kind]) ? [{ value: "individual", key: "individual", label: "Switch to one entry per connection", hint: "copies connection settings into each AI service" }] : []),
        { value: "back", key: "b", label: "Back" },
    ];
    const picked = await prompter.select(KIND_LABELS[kind], items, { cancelValue: "back" });
    if(picked === "back") return;
    if(picked === "relaunch" && !sessionMode) { await applyLaunchCommands(prompter, registry, kind); return; }
    await applyLayout(prompter, registry, kind, picked === "individual" ? "individual" : "catalog");
}

/** Per-connection entries: repoint standard launches at the installed runtime. */
async function applyLaunchCommands(prompter: RegistrationPrompter, registry: Registry, kind: McpKind): Promise<void> {
    const paint = prompter.paint;
    const plan = registry.planRuntime(kind);
    prompter.clearScreen();
    prompter.write(`${paint.bold("Update launch commands")}  ${KIND_LABELS[kind]}\n`);
    prompter.write(`  ${paint.dim("Start")}      ${PACKAGE_NAME} ${paint.accent(plan.runtime.version)}\n`);
    prompter.write(`  ${paint.dim("Entries")}    ${paint.accent(String(plan.names.length))}  ${paint.dim(plan.names.map(plainText).join(", "))}\n`);
    if(plan.skipped.length) prompter.write(`  ${paint.dim("Kept")}       ${plan.skipped.map(plainText).join(", ")} ${paint.dim("· custom commands")}\n`);
    prompter.write(paint.dim("Connection values and credentials stay the same.\n"));
    if(!await prompter.askYesNo("Apply these launch commands?", true)) return;
    const results = registry.applyRuntime(plan);
    prompter.clearScreen();
    prompter.write(`${registry.formatResults(results, "Launch commands saved.", prompter.paint)}\n`);
    await registry.checkSaved(prompter, plan.names);
    prompter.write("Restart or reconnect your AI clients to use them.\n");
    await prompter.acknowledge();
}

/** Review and apply one server per kind (catalog) or per-connection entries (individual). */
async function applyLayout(prompter: RegistrationPrompter, registry: Registry, kind: McpKind, mode: "catalog" | "individual"): Promise<void> {
    const paint = prompter.paint;
    const plan = registry.planSession(kind, mode);
    prompter.clearScreen();
    prompter.write(`${paint.bold(mode === "catalog" ? `Switch to one server (${sessionName(kind)})` : "Switch to one entry per connection")}  ${KIND_LABELS[kind]}\n`);
    for(const change of plan.changes) {
        const add = change.add.length ? change.add.join(", ") : "nothing";
        const remove = change.remove.length ? change.remove.length > 3 ? `${change.remove.length} entries` : change.remove.join(", ") : "nothing";
        prompter.write(`  ${paint.dim(CLIENT_LABELS[change.client].padEnd(15))}${paint.accent(plainText(add))} ${paint.dim("· then remove")} ${plainText(remove)}\n`);
        if(change.review.length) prompter.write(`  ${" ".repeat(15)}${paint.warning(`kept for Sync review: ${change.review.map(plainText).join(", ")}`)}\n`);
    }
    if(mode === "catalog") {
        prompter.write(`  ${paint.dim("Runs".padEnd(15))}${plainText(plan.entry.args[0])} --catalog\n`);
        if(plan.custom.length) prompter.write(`  ${paint.dim("Not started".padEnd(15))}${plan.custom.map(plainText).join(", ")} ${paint.dim("· custom commands, kept for switching back")}\n`);
        prompter.write(paint.dim(`The ${sessionName(kind)} entry holds no passwords; they stay in the catalog.\n`));
    } else prompter.write(paint.warning("! Passwords are copied back into each AI service's settings.\n"));
    prompter.write(paint.dim("The previous catalog is kept as registry.previous.json.\n"));
    if(!await prompter.askYesNo("Apply this layout?", false)) return;
    const results = registry.applySession(plan);
    prompter.clearScreen();
    prompter.write(`${registry.formatResults(results, "Layout saved.", prompter.paint)}\n`);
    await registry.checkSaved(prompter, plan.names);
    prompter.write("Restart or reconnect your AI clients to load the new layout. Fix startup failures first.\n");
    await prompter.acknowledge();
}
