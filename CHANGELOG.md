# Changelog

All notable changes to `@akms/mcp`.

## 0.1.0 — Unreleased

### Added

- One terminal menu for database, SSH and WSL connection setup, using the selection and rendering behavior of the existing MCP packages.
- Client selection for Claude Code, Codex, Claude Desktop and Cursor, plus direct commands such as `akms-mcp db --target codex`.
- A fresh npm `latest` lookup before every launch. The selected version runs through npm without making the MCP packages runtime dependencies of the launcher.
- Every child opens through its `config` command. Exiting the child returns to the launcher menu.
- `.npmignore` controls the published package contents, excluding source, tests and development files.
