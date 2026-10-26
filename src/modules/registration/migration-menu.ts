import { Registry, sessionName } from "./registry";
import type { MigrationPlan } from "./registry";
import { CLIENT_LABELS, KIND_LABELS } from "./types";
import { PACKAGE_NAME } from "./runtime";
import { plainText } from "./comparison";
import { PromptBackError, PromptClosedError, type RegistrationPrompter } from "./prompter";

function writePlan(prompter: RegistrationPrompter, plan: MigrationPlan): void {
    const paint = prompter.paint;
    prompter.clearScreen();
    prompter.write(`${paint.bold("Migrate registry")}\n`);
    plan.steps.forEach((step, index) => prompter.write(`  ${paint.accent(`${index + 1}.`)} ${step.label}\n`));
    if(plan.steps.some(step => step.id === "catalog_default")) prompter.write(paint.dim("  New kinds start as one server per kind; a kind switched back to per-connection entries keeps that choice.\n"));
    prompter.write("\n");
    for(const item of plan.launches) {
        const names = item.names.length > 3 ? `${item.names.length} entries` : item.names.map(plainText).join(", ");
        prompter.write(`  ${paint.dim(KIND_LABELS[item.kind].padEnd(10))}${names} ${paint.dim("→")} ${paint.accent(`${PACKAGE_NAME}/lib/${item.kind}.js`)}${item.ready ? "" : paint.warning("  after installing it")}\n`);
    }
    for(const item of plan.kinds) {
        const target = sessionName(item.kind);
        const action = item.status === "catalog" ? `already ${target}` : item.status === "individual" ? "keeps per-connection entries (your choice)"
            : item.status === "empty" ? `no connections · new ones use ${target}` : item.status === "blocked" ? paint.error("blocked")
            : `${item.names.length} entries → ${target}${item.status === "pending-runtime" ? paint.warning("  after Runtime + Sync") : ""}`;
        prompter.write(`  ${paint.dim(KIND_LABELS[item.kind].padEnd(10))}${action}\n`);
        if(item.detail) prompter.write(`  ${" ".repeat(10)}${paint.dim(plainText(item.detail))}\n`);
        for(const change of item.session?.changes ?? item.changes ?? []) {
            const remove = change.remove.length > 3 ? `${change.remove.length} entries` : change.remove.join(", ") || "nothing";
            prompter.write(`  ${" ".repeat(10)}${paint.dim(CLIENT_LABELS[change.client].padEnd(15))}${paint.accent(change.add.join(", ") || "nothing")} ${paint.dim("· then remove")} ${plainText(remove)}\n`);
            if(change.review.length) prompter.write(`  ${" ".repeat(25)}${paint.warning(`kept for Sync review: ${change.review.map(plainText).join(", ")}`)}\n`);
        }
        if(item.session?.custom.length) prompter.write(`  ${" ".repeat(10)}${paint.dim(`custom commands kept for switching back: ${item.session.custom.map(plainText).join(", ")}`)}\n`);
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
        writePlan(prompter, plan);
        if(plan.launches.some(item => !item.ready) && !registry.installedRuntime()?.linked) {
            prompter.write(paint.warning(`! ${PACKAGE_NAME} is not installed in the runtime directory yet.\n`));
            if(await prompter.askYesNo(`Install ${PACKAGE_NAME} now?`, true)) {
                prompter.write(`Installing ${PACKAGE_NAME}@latest...\n`);
                try { await registry.installRuntime(); }
                catch(error) { prompter.write(`${paint.error("Failed")} ${plainText(error instanceof Error ? error.message : "Installation failed.")}\n`); await prompter.acknowledge(); }
                plan = registry.planMigration();
                writePlan(prompter, plan);
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
            ...plan.kinds.filter(item => item.status !== "individual").flatMap(item => item.names),
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
