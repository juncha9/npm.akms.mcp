import { Registry, sessionName } from "./registry";
import type { MigrationPlan } from "./registry";
import { CLIENT_LABELS, KIND_LABELS } from "./types";
import type { McpKind } from "./types";
import { PACKAGE_NAME, legacyPackageName } from "./runtime";
import { plainText } from "./comparison";
import { PromptBackError, PromptClosedError, type RegistrationPrompter } from "./prompter";

/**
 * Whether Migrate registry would change anything now. It waits while @akms/mcp is missing for a
 * step that only repoints launches, and is blocked by a connection the catalog cannot convert.
 */
export function migrationStatus(registry: Registry): { status: "none" | "ready" | "waiting" | "blocked"; detail?: string } {
    if(!registry.needsMigration()) return { status: "none" };
    const plan = registry.planMigration();
    const blocked = plan.kinds.find(item => item.status === "blocked");
    if(blocked) return { status: "blocked", detail: blocked.detail };
    if(plan.steps.some(step => step.id !== "single_package") || plan.launches.some(item => item.ready)) return { status: "ready" };
    return { status: "waiting", detail: `Install ${PACKAGE_NAME} first.` };
}

/** What Migrate changes, as from → to pairs: the registry format and the package servers start from. */
export function migrationVersions(registry: Registry, plan = registry.planMigration()): { label: string; from: string; to: string }[] {
    const pairs: { label: string; from: string; to: string }[] = [];
    if(plan.steps.some(step => step.id === "v1_to_v2")) pairs.push({ label: "Registry", from: "v1", to: "v2" });
    const ready = plan.launches.filter(item => item.ready);
    if(ready.length) {
        // "@akms/mcp-db 0.3.2" for each per-kind package still in the runtime directory.
        const installed = new Map<McpKind, string>(registry.legacyRuntimes().map(item => [item.runtime.kind, `${item.runtime.packageName} ${item.runtime.version}`]));
        const from = [...new Set(ready.map(item => installed.get(item.kind) ?? legacyPackageName(item.kind)))].join(", ");
        pairs.push({ label: "Servers", from, to: `${PACKAGE_NAME} ${registry.installedRuntime()?.version ?? ""}`.trim() });
    }
    return pairs;
}

function writePlan(prompter: RegistrationPrompter, registry: Registry, plan: MigrationPlan): void {
    const paint = prompter.paint;
    prompter.clearScreen();
    prompter.write(`${paint.bold("Migrate registry")}\n`);
    // Old in yellow, new in green: what this migration moves from and to.
    for(const pair of migrationVersions(registry, plan)) {
        prompter.write(`  ${paint.dim(pair.label.padEnd(10))}${paint.warning(plainText(pair.from))} ${paint.dim("→")} ${paint.bold(paint.success(plainText(pair.to)))}\n`);
    }
    plan.steps.forEach((step, index) => prompter.write(`  ${paint.accent(`${index + 1}.`)} ${step.label}\n`));
    if(plan.kinds.length) prompter.write(paint.dim("  Every kind is listed as one akms_<kind> entry in each AI service; connection settings stay in the catalog.\n"));
    prompter.write("\n");
    for(const item of plan.launches) {
        const names = item.names.length > 3 ? `${item.names.length} entries` : item.names.map(plainText).join(", ");
        prompter.write(`  ${paint.dim(KIND_LABELS[item.kind].padEnd(10))}${names} ${paint.dim("→")} ${paint.accent(`${PACKAGE_NAME}/lib/${item.kind}.js`)}${item.ready ? "" : paint.warning("  after installing it")}\n`);
    }
    for(const item of plan.kinds) {
        const target = sessionName(item.kind);
        const action = item.status === "catalog" ? `already ${target}`
            : item.status === "empty" ? `no connections · new ones use ${target}` : item.status === "blocked" ? paint.error("blocked")
            : `${item.names.length} entries → ${target}${item.status === "pending-runtime" ? paint.warning("  after Runtime + Sync") : ""}`;
        prompter.write(`  ${paint.dim(KIND_LABELS[item.kind].padEnd(10))}${action}\n`);
        if(item.detail) prompter.write(`  ${" ".repeat(10)}${paint.dim(plainText(item.detail))}\n`);
        for(const change of item.session?.changes ?? item.changes ?? []) {
            const remove = change.remove.length > 3 ? `${change.remove.length} entries` : change.remove.join(", ") || "nothing";
            prompter.write(`  ${" ".repeat(10)}${paint.dim(CLIENT_LABELS[change.client].padEnd(15))}${paint.accent(change.add.join(", ") || "nothing")} ${paint.dim("· then remove")} ${plainText(remove)}\n`);
            if(change.review.length) prompter.write(`  ${" ".repeat(25)}${paint.warning(`kept for Sync review: ${change.review.map(plainText).join(", ")}`)}\n`);
        }
        if(item.session?.custom.length) prompter.write(`  ${" ".repeat(10)}${paint.dim(`custom commands are not started; their settings still load in the grouped entry: ${item.session.custom.map(plainText).join(", ")}`)}\n`);
    }
    prompter.write(paint.dim("\nServer entries hold no passwords; they stay in the catalog. The previous catalog is kept as registry.previous.json.\n"));
}

/** Review all registry format steps before any saved settings are changed. */
export async function migrationMenu(prompter: RegistrationPrompter, registry: Registry): Promise<void> {
    try {
        const paint = prompter.paint;
        let plan = registry.planMigration();
        if(!plan.steps.length) {
            prompter.clearScreen();
            prompter.write(`${paint.bold("Migrate registry")}\n${paint.success("Up to date")} ${paint.dim("· the registry is already in the current format")}\n`);
            await prompter.acknowledge();
            return;
        }
        writePlan(prompter, registry, plan);
        if(plan.launches.some(item => !item.ready) && !registry.installedRuntime()?.linked) {
            prompter.write(paint.warning(`! ${PACKAGE_NAME} is not installed in the runtime directory yet.\n`));
            if(await prompter.askYesNo(`Install ${PACKAGE_NAME} now?`, true)) {
                prompter.write(`Installing ${PACKAGE_NAME}@latest...\n`);
                try { await registry.installRuntime(); }
                catch(error) { prompter.write(`${paint.error("Failed")} ${plainText(error instanceof Error ? error.message : "Installation failed.")}\n`); await prompter.acknowledge(); }
                plan = registry.planMigration();
                writePlan(prompter, registry, plan);
            }
        }
        if(plan.kinds.some(item => item.status === "blocked")) { prompter.write(paint.warning("! Resolve blocked kinds before migrating. No migration was applied.\n")); await prompter.acknowledge(); return; }
        if(plan.steps.every(step => step.id === "single_package") && plan.launches.every(item => !item.ready)) {
            prompter.write(`Nothing can be migrated until ${PACKAGE_NAME} is installed. Install it from Runtime, then reopen Migrate registry.\n`);
            await prompter.acknowledge();
            return;
        }
        if(!await prompter.askYesNo("Migrate the registry and apply these changes?", false)) return;
        const results = registry.applyMigration(plan);
        prompter.clearScreen();
        prompter.write(`${registry.formatResults(results, "Registry migration saved.", prompter.paint)}\n`);
        const state = registry.read();
        const launchKinds = plan.launches.filter(item => item.ready).map(item => item.kind);
        await registry.checkSaved(prompter, [...new Set([
            ...plan.kinds.flatMap(item => item.names),
            ...Object.entries(state.connections).filter(([, item]) => item.entry && launchKinds.includes(item.kind)).map(([name]) => name),
        ])]);
        if(plan.launches.some(item => !item.ready)) prompter.write(paint.warning(`! Entries waiting for ${PACKAGE_NAME} keep their old launch. Install it from Runtime, then reopen Migrate registry.\n`));
        prompter.write("Reconnect affected clients to load the new launch commands. Fix startup failures first.\n");
        await prompter.acknowledge();
    } catch(error) {
        if(error instanceof PromptClosedError) throw error;
        if(error instanceof PromptBackError) return;
        prompter.write(`${error instanceof Error ? plainText(error.message) : "Could not migrate the registry."}\n`);
        await prompter.acknowledge();
    }
}
