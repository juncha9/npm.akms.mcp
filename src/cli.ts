#!/usr/bin/env node
import { parseArguments } from "./modules/launcher/arguments";
import { runMenu, runRegistrationCommand } from "./modules/launcher/menu";
import { launchAdd, launchMcp } from "./modules/launcher/npm";
import { PACKAGE_VERSION } from "./_defs";

const HELP_TEXT = [
    "AKMS MCP — connection setup for Database, SSH, WSL and S3",
    "",
    "Usage:",
    "  akms-mcp                          Open the setup menu",
    "  akms-mcp [setup|config]            Open the same menu",
    "  akms-mcp [setup|config] <mcp>      Open db, ssh, wsl or s3 setup directly",
    "  akms-mcp register                  Register AI services for all AKMS connections",
    "  akms-mcp sync                      Review differences and retry pending changes",
    "  akms-mcp add <mcp> <name> [opts]   Save a new connection without the menu, for scripts and AI agents;",
    "                                     akms-mcp add <mcp> --help lists the options",
    "",
    "Options:",
    "  --target <client>                 claude-code | codex | claude-desktop | cursor",
    "  -h, --help                        Print this help",
    "  -v, --version                     Print the launcher version",
    "",
    "Opens the installed runtime's setup. Missing runtimes can be installed with confirmation.",
    "Node.js 22+ and npm are required. WSL setup runs on Windows.",
    "Catalog: ~/.akms/mcp/registry.json (or $AKMS_MCP_HOME/registry.json) stores settings and passwords in plaintext.",
].join("\n");

async function main(): Promise<void> {
    const argumentsList = parseArguments(process.argv.slice(2));
    if(argumentsList.addArguments != null) {
        process.exitCode = await launchAdd(argumentsList.addArguments);
        return;
    }
    if(argumentsList.showHelp == true) {
        process.stdout.write(`${HELP_TEXT}\n`);
        return;
    }
    if(argumentsList.showVersion == true) {
        process.stdout.write(`${PACKAGE_VERSION}\n`);
        return;
    }
    if(argumentsList.mcpId != null) {
        process.exitCode = await launchMcp({ mcpId: argumentsList.mcpId, targetId: argumentsList.targetId });
        return;
    }
    if(argumentsList.managementMode) {
        process.exitCode = await runRegistrationCommand({ input: process.stdin, output: process.stdout, mode: argumentsList.managementMode, targetId: argumentsList.targetId });
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
