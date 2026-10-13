# @akms/mcp

One terminal menu for configuring AKMS database, SSH and WSL MCP connections in your AI client.

```sh
npx -y --prefer-online @akms/mcp@latest
```

Requires **Node.js 22+ and npm**. WSL setup runs from Windows.

```text
? AKMS MCP · Connection setup
❯ Database  PostgreSQL connections
  SSH       Remote hosts
  WSL       Local Linux distros · Windows
  ────────────────────────
  Client    Automatically selected by each MCP
  Quit

↑↓ move · enter select · esc back
```

Choose a server type to open its current setup screen. Exiting that screen returns to this menu. Use **Client** to select Claude Code, Codex, Claude Desktop or Cursor for subsequent launches. With Automatic, each MCP detects the client using its own setup behavior.

## Install and run

```sh
npm install -g @akms/mcp
akms-mcp
```

`akms-mcp config` and `akms-mcp setup` open the same menu. You can also jump straight into a setup screen:

```sh
akms-mcp db --target codex
akms-mcp ssh --target claude-code
akms-mcp wsl --target cursor
```

Use `--help` for the command reference and `--version` for the launcher's version.

## Latest on every launch

Each time you choose a server, the launcher queries npm for that package's `latest` tag, then runs the exact version returned. This applies even when you select the same server twice in one session. If the lookup fails, setup does not start with a cached older version. An internet connection to your configured npm registry is required.

The MCP packages are **not dependencies** of this package. npm downloads the selected release into its execution cache when needed; it does not install it into this package or globally. Updating an MCP does not require a new launcher release while its setup command remains compatible.

| Selection | Package | Setup command |
|---|---|---|
| Database | `@akms/mcp-db` | `config` |
| SSH | `@akms/mcp-ssh` | `config` |
| WSL | `@akms/mcp-wsl` | `config` |

The selected MCP owns connection editing, validation and client configuration writes. Entries saved for your AI client follow that MCP's own behavior; this launcher checks versions when opening setup.

## Terminal controls

Use arrow keys and Enter, or number keys to move to a row. Esc returns to the previous menu; Esc at the main menu exits. The menu uses the same selection and rendering code as the SSH and WSL packages.

Outside an interactive terminal, menus show numbers and accept a number, key or label. For scripted setup, the direct command is easiest: `akms-mcp db --target codex` passes stdin to the database setup screen.

See [development notes](./README_DEV.md) for build and test instructions.
