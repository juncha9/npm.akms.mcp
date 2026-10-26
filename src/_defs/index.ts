export const MCP_PACKAGES = {
    db: { label: "Database", packageName: "@akms/mcp-db", command: "akms-mcp-db", setupCommand: "config" },
    ssh: { label: "SSH", packageName: "@akms/mcp-ssh", command: "akms-mcp-ssh", setupCommand: "config" },
    wsl: { label: "WSL", packageName: "@akms/mcp-wsl", command: "akms-mcp-wsl", setupCommand: "config" },
    s3: { label: "S3", packageName: "@akms/mcp-s3", command: "akms-mcp-s3", setupCommand: "config" },
} as const;

export const CLIENT_LABELS = {
    "claude-code": "Claude Code",
    codex: "Codex",
    "claude-desktop": "Claude Desktop",
    cursor: "Cursor",
} as const;

export { PACKAGE_VERSION } from "./version";
