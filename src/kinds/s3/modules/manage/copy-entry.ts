import type { ConfigTarget, McpServerEntry } from "@s3/_types";
import { PromptBackError, Prompter } from "./prompter";
import type { SelectItem } from "./prompter";
import { screenText, writeField, writeHint, writeWarning } from "@/modules/registration/display";

/** Copies the saved command, arguments and environment without reopening the settings form. */
export async function copyEntryToClient(
    prompter: Prompter,
    source: ConfigTarget,
    targets: ConfigTarget[],
    name: string,
    entry: McpServerEntry,
): Promise<void> {
    const destinations = targets.filter((target) => target.id !== source.id);
    if(destinations.length === 0) {
        return;
    }

    for(;;) {
        const items: SelectItem<string>[] = destinations.map((target) => ({
            value: target.id,
            key: target.id,
            label: target.label,
            hint: target.detected ? target.location : `${target.location} · not found on this machine`,
        }));
        items.push({ separator: true }, { value: "back", key: "b", label: "Back" });
        const picked = await prompter.select(`Copy ${name} to which client?`, items, { cancelValue: "back" });
        const destination = destinations.find((target) => target.id === picked);
        if(destination == null) {
            return;
        }

        // Check all names, including HTTP servers and entries omitted by readEntries().
        const exists = destination.hasEntry?.(name) ?? Object.hasOwn(destination.readEntries(), name);
        if(exists) {
            try {
                const overwrite = await prompter.askYesNo(
                    `${name} already exists in ${destination.label} (${destination.location}). Overwrite it?`,
                    false,
                );
                if(overwrite == false) {
                    writeWarning(prompter, "Not copied; the destination entry was kept.");
                    return;
                }
            }
            catch(ex) {
                if(ex instanceof PromptBackError == false) {
                    throw ex;
                }
                continue;
            }
        }

        const result = destination.writeEntry(name, {
            command: entry.command,
            args: [...entry.args],
            env: { ...entry.env },
        }, { replace: true });
        if(result.status === "written") {
            prompter.write(`  ${prompter.paint.success("Copied")} ${prompter.paint.accent(screenText(name))} to ${prompter.paint.accent(screenText(destination.label))}\n`);
            writeField(prompter, "Location", result.detail);
            writeHint(prompter, "Restart or reconnect the destination client to load the change.");
        }
        else {
            prompter.write(`  ${prompter.paint.error("Not copied:")} ${screenText(result.detail)}\n\n`);
        }
        return;
    }
}
