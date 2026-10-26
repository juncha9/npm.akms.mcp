import type { Prompter } from "../launcher/prompter";

export { Prompter, PromptBackError, PromptClosedError, displayWidth } from "../launcher/prompter";
export type { SelectItem } from "../launcher/prompter";

/**
 * What the shared screens use from a prompter. The launcher's prompter and each kind's `config`
 * prompter are separate classes, so the screens accept this shape rather than one class.
 */
export type RegistrationPrompter = Pick<Prompter, "write" | "clearScreen" | "acknowledge" | "askYesNo" | "askRequired" | "select" | "paint" | "width">;
