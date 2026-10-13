#!/usr/bin/env node
import { parseArguments } from "./modules/launcher/arguments";
import { runMenu } from "./modules/launcher/menu";
import { launchMcp } from "./modules/launcher/npm";

declare const __PACKAGE_VERSION__: string;

const HELP_TEXT = [
    "AKMS MCP — connection setup for Database, SSH and WSL",
    "",
    "Usage:",
    "  akms-mcp                          Open the setup menu",
    "  akms-mcp [setup|config]            Open the same menu",
    "  akms-mcp [setup|config] <mcp>      Open db, ssh or wsl setup directly",
    "",
    "Options:",
    "  --target <client>                 claude-code | codex | claude-desktop | cursor",
    "  -h, --help                        Print this help",
    "  -v, --version                     Print the launcher version",
    "",
    "Each launch checks npm for the selected package's latest release.",
    "Node.js 22+ and npm are required. WSL setup runs on Windows.",
].join("\n");

async function main(): Promise<void> {
    const argumentsList = parseArguments(process.argv.slice(2));
    if(argumentsList.showHelp == true) {
        process.stdout.write(`${HELP_TEXT}\n`);
        return;
    }
    if(argumentsList.showVersion == true) {
        let version = "development";
        if(typeof __PACKAGE_VERSION__ !== "undefined") {
            version = __PACKAGE_VERSION__;
        }
        process.stdout.write(`${version}\n`);
        return;
    }
    if(argumentsList.mcpId != null) {
        process.exitCode = await launchMcp({ mcpId: argumentsList.mcpId, targetId: argumentsList.targetId });
        return;
    }
    process.exitCode = await runMenu({
        input: process.stdin,
        output: process.stdout,
        targetId: argumentsList.targetId,
        launch: launchMcp,
    });
}

main().catch((error: unknown) => {
    process.stderr.write(`akms-mcp: ${String(error)}\n`);
    process.exitCode = 1;
});
