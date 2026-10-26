export const MCP_PACKAGES = {
    db: { label: "Database", command: "akms-mcp-db", setupCommand: "config" },
    ssh: { label: "SSH", command: "akms-mcp-ssh", setupCommand: "config" },
    wsl: { label: "WSL", command: "akms-mcp-wsl", setupCommand: "config" },
    s3: { label: "S3", command: "akms-mcp-s3", setupCommand: "config" },
} as const;

export const CLIENT_LABELS = {
    "claude-code": "Claude Code",
    codex: "Codex",
    "claude-desktop": "Claude Desktop",
    cursor: "Cursor",
} as const;

export { PACKAGE_VERSION } from "./version";
