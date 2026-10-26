/** Shared by the AKMS MCP menu and every kind's config screen in @akms/mcp. */
export type ClientId = "claude-code" | "codex" | "claude-desktop" | "cursor";
export type ConfigTargetId = ClientId | "registered";
export type McpKind = "db" | "ssh" | "wsl" | "s3";
export interface McpServerEntry { command: string; args: string[]; env: Record<string, string> }
export interface ConfigWriteResult { status: "written" | "unavailable"; detail: string }
export interface ConfigTarget {
    id: ClientId | "registered";
    label: string;
    location: string;
    detected: boolean;
    readEntries(): Record<string, McpServerEntry>;
    hasEntry?(name: string): boolean;
    prepareEntry?(name: string, entry: McpServerEntry, oldName?: string): McpServerEntry;
    writeEntry(name: string, entry: McpServerEntry, options?: { replace?: boolean }): ConfigWriteResult;
    removeEntry(name: string): ConfigWriteResult;
    renameEntry?(oldName: string, name: string, entry: McpServerEntry): ConfigWriteResult;
}
export const CLIENT_LABELS: Record<ClientId, string> = {
    "claude-code": "Claude Code", codex: "Codex", "claude-desktop": "Claude Desktop", cursor: "Cursor",
};
export const KINDS: McpKind[] = ["db", "ssh", "wsl", "s3"];
export const KIND_LABELS: Record<McpKind, string> = { db: "Database", ssh: "SSH", wsl: "WSL", s3: "S3" };
