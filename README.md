# @akms/mcp

MCP servers for PostgreSQL databases, SSH hosts, Windows Subsystem for Linux (WSL) and S3 buckets, with one setup menu and one shared connection catalog.

Choose Claude Code, Codex, Claude Desktop and/or Cursor once. Connections you save are applied to every registered AI service. Each connection keeps its own credentials and access policy.

Requires **Node.js 22+ and npm**. WSL runs on Windows with an installed Linux distribution.

## Install and set up

```sh
npx -y @akms/mcp@latest
```

1. Open **Runtime** and choose **Install AKMS MCP**. This installs one runtime for all four kinds.
2. Open **Register**, select the AI services you use, then choose **Apply registration** and confirm the review.
3. Open **Database**, **SSH**, **WSL** or **S3**, add a connection and save it. The kind's screen contains its connections and a Back action; shared settings are in the main menu.
4. Restart or reconnect your AI clients to load the saved connections.

Add requires at least one registered service. Existing matching connections are imported when you apply registration; differing versions remain available for review in **Sync > Import existing connections**.

You can open a kind's setup directly:

```sh
npx -y @akms/mcp@latest db
npx -y @akms/mcp@latest ssh
npx -y @akms/mcp@latest wsl
npx -y @akms/mcp@latest s3
```

To install the setup command globally instead:

```sh
npm install -g @akms/mcp@latest
akms-mcp
```

`akms-mcp setup` and `akms-mcp config` open the same main menu. `akms-mcp register` and `akms-mcp sync` open the shared registration and comparison screens. `--target codex` preselects Codex in Register; saves still apply to all registered services. Run `akms-mcp --help` for the command reference.

The package exposes **one command, `akms-mcp`**. Database, SSH, WSL and S3 servers have separate entry files inside the same package; they do not need separate npm installations.

## Choose a connection kind

### Database

Query PostgreSQL directly or through an SSH tunnel. SQL goes through a PostgreSQL parser, with optional read-only mode, DDL restrictions, statement timeouts and result limits. See [Database connections, configuration and tools](docs/db.md).

### SSH

Run commands, keep working-directory sessions, and transfer files over SFTP. Configure a private key, password or SSH agent, optional jump hosts, host-key pinning and per-host command/path rules. See [SSH connections, configuration and tools](docs/ssh.md).

### WSL

Run commands and work with files in a registered Linux distribution and user on Windows. Command and file policies include additional protection for Windows paths mounted under `/mnt`. See [WSL connections, configuration and tools](docs/wsl.md).

### S3

List objects, inspect and edit UTF-8 content, and upload or download files in one bucket and optional key prefix. Supports AWS S3 and explicitly configured S3-compatible endpoints. See [S3 connections, configuration and tools](docs/s3.md).

## Runtime and updates

**Runtime** installs and updates the single `@akms/mcp` runtime. Choose **Check for updates**, then **Update to <version>** when a newer release is available. Opening the main menu does not query npm: **Update available <version>** means the installed runtime is older than the setup version already running. A linked development installation is shown as such and is never offered an update.

Runtime also contains **Server layout**, **Migrate registry** when changes are ready to apply, and **Remove old packages** when unused legacy installations can be removed. If migration is waiting or blocked, Runtime explains what to fix first.

The catalog directory is `~/.akms/mcp`, or `$AKMS_MCP_HOME` when set. Runtime installs below that directory:

| Platform | Runtime prefix | Package directory |
| --- | --- | --- |
| Windows | `<catalog>/runtime` | `<catalog>/runtime/node_modules/@akms/mcp` |
| macOS / Linux | `<catalog>/runtime` | `<catalog>/runtime/lib/node_modules/@akms/mcp` |

Saved MCP entries start Node directly with `lib/db.js`, `lib/ssh.js`, `lib/wsl.js` or `lib/s3.js`. npm installation runs during setup; an AI client's server connection does not keep an npm/npx wrapper running.

After saving changed settings or updating the runtime, setup checks MCP startup using `initialize` and `tools/list`. This check does not execute database, SSH, WSL or S3 tools. Fix any startup failures before reconnecting clients. Running processes keep their loaded code until restarted.

## Server layout

New catalogs use **one server per kind** in each AI client session. For example, six database connections share an `akms_db` entry and four SSH hosts share an `akms_ssh` entry. Different AI client sessions still have their own processes.

Each server reads a catalog snapshot at startup. Tools include the saved connection name, such as `pg_main__db_query` or `remote_main__ssh_exec`. Connections open lazily; listing tools does not connect to remote services. Call `db_catalog_status`, `ssh_catalog_status`, `wsl_catalog_status` or `s3_catalog_status` to inspect loaded and skipped connections without printing credentials. If the catalog is missing or invalid, a newly started server exposes its status tool so the problem remains visible.

Open **Runtime > Server layout**, select a kind, and review its layout before applying a change. **Switch to one entry per connection** restores individual entries containing their saved environment values. **Switch to one server (akms_<kind>)** combines them again. These confirmations default to **No**. The **New kinds** row changes the default for kinds you have not configured; it does not change existing kinds' choices.

Connection names use ASCII letters, digits, underscores or hyphens: Database up to 35 characters, SSH/WSL up to 30, and S3 up to 37. The names `akms_db`, `akms_ssh`, `akms_wsl` and `akms_s3` are reserved.

## Register, compare and import

**Register** shares the service selection across all kinds. Newly registered services receive saved connections. Unregistering removes only AKMS-managed entries from that service and keeps the catalog.

**Sync** compares saved settings with client settings and retries unfinished changes. Select an item to see the AKMS version beside the current service version, then choose which one to use. Secret values stay hidden in comparisons. Changes made outside setup remain intact until you approve a version.

When Sync shows **Not yet imported**, choose **Import existing connections** on that screen. Review the versions and choose one, or use a new connection name to keep both. A runtime wait is shown separately from a failed write; retained entries identify the services in which they remain.

## Upgrading from 0.3.x to 0.4.0

Versions 0.3.x and earlier used the separate `@akms/mcp-db`, `@akms/mcp-ssh`, `@akms/mcp-wsl` and `@akms/mcp-s3` packages. Version 0.4.0 includes these servers in `@akms/mcp`.

1. Run `npx -y @akms/mcp@latest` to open the current setup.
2. Open **Runtime**. The main menu marks it **Not installed** until the unified runtime is installed, then **Registry update available**. Choose **Install AKMS MCP** first when it is offered.
3. Choose **Migrate registry** in Runtime when it is available. Review the old/new package versions, launch paths and proposed replacements, then approve the migration; its apply confirmation defaults to **No**.
4. Applying the migration runs synchronization to rewrite managed client entries. Open **Sync** to resolve retained external edits or retry unfinished writes. Existing per-connection layout choices are preserved, and the registry remains version 2.
5. Open **Runtime > Remove old packages** when it is offered. It lists legacy packages only when the catalog and inspected client settings no longer use them. Removal is optional and defaults to **No**; finish migration and Sync before removing packages still in use.
6. Restart or reconnect your AI clients to replace running servers.
7. Call each kind's `*_catalog_status` tool and confirm its loaded connections. For an intentional per-connection layout, verify the individual entries and tools instead.

The new target is `node .../node_modules/@akms/mcp/lib/<kind>.js`, with `--catalog` for one server per kind. Migrate registry moves old direct paths and standard npx entries. An individual entry that still uses an old kind-specific command (such as `akms-mcp-db`) is marked **launch out of date** under **Runtime > Server layout**; choose **Update launch commands** there. Custom commands and externally edited entries require review. If installation is deferred or fails, old launches are kept; install from **Runtime**, then choose **Migrate registry** there.

## Upgrading from 0.2.x

For clients with individual npx entries and no shared catalog:

1. Run `npx -y @akms/mcp@latest`, open **Runtime** and choose **Install AKMS MCP**.
2. Open **Register**, select your services and apply. Matching copies become one shared connection; differing copies stay unchanged until you choose a version.
3. Complete the offered comparison, or use **Sync > Import existing connections**. Review description-only differences too. Keep the connection name to replace its old entries, or choose a new name to keep both.
4. Run **Sync** to finish pending changes. If **Registry update available** appears, review **Runtime > Migrate registry** as described above.
5. Restart or reconnect clients, then check the appropriate `*_catalog_status` tools.

If you register before installing the runtime, **Waiting for runtime** is a normal pending state. Existing entries stay until the replacement is ready. Install from **Runtime**, then use **Runtime > Migrate registry** if offered and **Sync** to finish. Installing the runtime alone does not finish the conversion.

Each client session owns its MCP processes. Start a fresh session or thread after upgrading, and close old sessions whose servers you want to stop.

## Catalog security and recovery

The shared catalog is `~/.akms/mcp/registry.json`, or `$AKMS_MCP_HOME/registry.json`. It contains complete connection settings, including passwords and secret values **in plaintext**. In per-connection mode these values also appear in AI client entries. The previous revision, `registry.previous.json`, also contains saved credentials. SSH private-key settings store file paths, not the key files themselves.

On POSIX, new catalog files request mode `0600` and new catalog directories `0700`; existing permissions are not tightened. Windows uses inherited parent-directory ACLs. Check access permissions when choosing a custom location.

**Keep both catalog files private:** do not commit them, share them, copy them to another person or PC, paste their contents into chats/issues/AI conversations, or ask an AI agent to print them. Exclude them from cloud sync and shared backups, or protect those copies. If exposed, change the affected passwords or rotate the affected keys/tokens, then update the saved connections.

SSH local-transfer guards block the standard `.akms/mcp` catalog tree and also protect the two catalog files at a custom `AKMS_MCP_HOME` when available to the process. WSL's Windows-path checks apply through `/mnt/<drive>/`; remote SSH paths and native Linux paths have no catalog-specific block. These guards do not replace filesystem permissions or private storage.

Each successful catalog-changing operation atomically keeps one pre-operation revision in **`registry.previous.json`**. Internal bookkeeping and a no-op Sync do not replace that revision. This is one previous revision, not a backup history.

To recover, close setup commands, preserve the current file if needed, then copy `registry.previous.json` over `registry.json`. Reopen setup, review **Sync** and reconnect clients. Restoring the catalog does not automatically restore client files. A session entry contains no connection credentials, so Import cannot reconstruct a missing catalog from that entry alone.

## Terminal controls

Use arrow keys and Enter to select; Esc goes back one level. Colors are disabled with `NO_COLOR` or when output is piped. Piped prompts use the same choices as numbered lists and accept a number, action key or label.

See [CHANGELOG.md](CHANGELOG.md) for release changes and [README_DEV.md](README_DEV.md) for contribution notes. Licensed under [MIT](LICENSE.md).
