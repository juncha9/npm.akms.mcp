/**
 * Input ended before a prompt was answered — Ctrl+D, Ctrl+C, or a piped script running out.
 * The menus treat it as leaving, not as a failure.
 *
 * One class for every prompter: the shared registration screens catch it with `instanceof`
 * whichever prompter (the launcher's or a kind's `config`) raised it.
 */
export class PromptClosedError extends Error {
    constructor() {
        super("input closed before the prompt was answered");
        this.name = "PromptClosedError";
    }
}

/**
 * The user pressed Esc: leave this prompt without answering and go back one level. Every
 * prompt throws it, so a caller that opened a sub-screen (a field editor, a confirmation)
 * returns to where it was with nothing changed. Off a TTY a line of just `ESC` means the same.
 */
export class PromptBackError extends Error {
    constructor() {
        super("prompt left with esc");
        this.name = "PromptBackError";
    }
}
