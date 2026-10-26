import { stripVTControlCharacters } from "node:util";
import type { RegistrationPrompter } from "./prompter";

type Screen = Pick<RegistrationPrompter, "write" | "paint">;
export type ScreenTone = "accent" | "success" | "warning" | "error" | "dim";

/** Plain configuration values cannot supply terminal controls or extra screen rows. */
export const screenText = (value: string): string => stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f]/g, " ");
export const countLabel = (count: number, noun: string, plural = `${noun}s`): string => `${count} ${count === 1 ? noun : plural}`;

export function writeHeading(screen: Screen, title: string): void {
    screen.write(`${screen.paint.bold(screenText(title))}\n`);
}

export function writeField(screen: Screen, label: string, value: string, note = "", tone: ScreenTone = "accent"): void {
    const paint = screen.paint;
    const key = screenText(label);
    const padded = key.padEnd(Math.max(13, key.length + 2));
    screen.write(`  ${paint.dim(padded)}${paint[tone](screenText(value))}${note ? `  ${paint.dim(screenText(note))}` : ""}\n`);
}

export function writeHint(screen: Screen, text: string): void {
    screen.write(`${screen.paint.dim(screenText(text))}\n`);
}

export function writeWarning(screen: Screen, text: string): void {
    screen.write(`${screen.paint.warning(`! ${screenText(text)}`)}\n`);
}

export function writeOutcome(screen: Screen, status: string, detail: string, tone: "success" | "warning" | "error"): void {
    screen.write(`${screen.paint[tone](screenText(status))}\n`);
    // Shared writers return a complete results screen; preserve its rows rather than
    // flattening it into one long, dimmed explanation.
    if(detail.includes("\n")) screen.write(`${detail}\n`);
    else writeField(screen, "Location", detail);
}

export function writeFormHelp(screen: Screen, clearAnswer: string): void {
    writeHint(screen, "Select a setting to edit.");
    writeField(screen, "Text", `Enter keeps · ${clearAnswer} clears`);
    writeField(screen, "Back", "Esc");
    screen.write("\n");
}
