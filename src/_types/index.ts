import type { CLIENT_LABELS, MCP_PACKAGES } from "../_defs";

export type McpId = keyof typeof MCP_PACKAGES;
export type ClientId = keyof typeof CLIENT_LABELS;

export interface LaunchOptions {
    mcpId: McpId;
    targetId?: ClientId;
    pendingInput?: string;
}

export interface CliArguments {
    showHelp: boolean;
    showVersion: boolean;
    mcpId?: McpId;
    targetId?: ClientId;
    managementMode?: "register" | "sync";
}
