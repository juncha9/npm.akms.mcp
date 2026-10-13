import { CLIENT_LABELS, MCP_PACKAGES } from "../../_defs";
import type { CliArguments, ClientId, McpId } from "../../_types";

export function parseArguments(argv: string[]): CliArguments {
    const parsed: CliArguments = { showHelp: false, showVersion: false };
    let commandSeen = false;

    for(let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if(argument === "--help" || argument === "-h") {
            parsed.showHelp = true;
            continue;
        }
        if(argument === "--version" || argument === "-v") {
            parsed.showVersion = true;
            continue;
        }
        if(argument === "--target" || argument.startsWith("--target=") == true) {
            let target = argument.slice("--target=".length);
            if(argument === "--target") {
                index += 1;
                target = argv[index];
            }
            if(target == null || Object.hasOwn(CLIENT_LABELS, target) == false) {
                throw new Error("--target needs one of: claude-code, codex, claude-desktop, cursor");
            }
            parsed.targetId = target as ClientId;
            continue;
        }
        if((argument === "setup" || argument === "config") && commandSeen == false && parsed.mcpId == null) {
            commandSeen = true;
            continue;
        }
        if(Object.hasOwn(MCP_PACKAGES, argument) == true && parsed.mcpId == null) {
            parsed.mcpId = argument as McpId;
            continue;
        }
        throw new Error(`Unknown argument: ${argument}. Run akms-mcp --help for usage.`);
    }

    return parsed;
}
