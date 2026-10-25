# @akms/mcp

An optional terminal helper for configuring AKMS Database, SSH, WSL and S3 connections. Each MCP also provides its own independent `register`, `config` and `sync` commands.

```sh
npx -y --prefer-online @akms/mcp@latest
```

Requires **Node.js 22+ and npm**. WSL setup runs from Windows.

```text
? AKMS MCP · Connection setup
❯ Database  PostgreSQL connections
  SSH       Remote hosts
  WSL       Local Linux distros · Windows
  S3        AWS S3 and S3-compatible buckets
  ────────────────────────
  Register  Choose AI services once
  Sync      Review and retry shared settings
  Runtime   AKMS installation and direct launches
  Updates   Check installed MCP releases
  Quit

↑↓ move · enter select · esc back
```

Use **Register** to select Claude Code, Codex, Claude Desktop and/or Cursor once. Every menu remains available before registration; Add displays a Register instruction until at least one service is selected. Then choose a server type and save a connection: its package applies the entry to every registered service. Exiting its settings returns to this menu. **Sync** reviews differences and retries pending changes. Register and Sync run locally without installing a child MCP.

**Runtime** installs or explicitly updates a selected MCP in `<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`, and converts existing standard npx entries to direct Node launches after review. Connection values and credentials stay intact; custom commands and external client edits are preserved. Each standalone MCP has the same Runtime menu, so this helper is optional. Register/import legacy entries before conversion, then restart or reconnect the AI clients to replace their running npx processes.

## Install and run

```sh
npm install -g @akms/mcp@latest
akms-mcp
```

`akms-mcp config` and `akms-mcp setup` open the same menu. You can also jump straight into a setup screen:

```sh
akms-mcp register
akms-mcp db
akms-mcp ssh
akms-mcp wsl
akms-mcp s3
akms-mcp sync
```

Use `--help` for the command reference and `--version` for the launcher's version.

## Upgrading from 0.2.x

For clients with individual npx entries and no shared registry, start the current setup launcher:

```sh
npx -y --prefer-online @akms/mcp@latest
```

1. Open **Runtime**, select each MCP kind you use, and choose **Install AKMS runtime** or **Update runtime installation**.
2. Open **Register**, select your AI services, then choose **Apply registration** and confirm the review. Matching existing connections are imported into the shared catalog, and their individual client entries are replaced by one `akms_<kind>` entry per service.
3. Answer **Yes** to **Compare existing settings and choose which to share?** when versions differ, even if only their descriptions differ. Select the connection, choose **Use 1** or **Use 2**, keep the shared connection name to replace its old entries, and confirm **Import ... and apply it?**. If you defer this choice, use **Import existing connections** or reopen Register and Apply to return to the comparison.
4. Run **Sync** if any saved changes remain unfinished.
5. Restart or reconnect your AI clients to load the new entries. In Codex, start a new thread and archive the old threads whose servers you want to retire: each thread owns its MCP processes, and archiving stopped those processes in the isolated Codex 0.164.0 check.
6. Call `db_catalog_status`, `ssh_catalog_status`, `wsl_catalog_status` or `s3_catalog_status` for each kind you use and check its loaded and skipped connections. Tools now include the connection prefix, such as `pg_alpha__db_query` or `ssh_dev__ssh_exec`.

**If you registered first:** a missing-runtime result is a normal pending state. Updated setup labels this **Waiting for runtime**. Existing client entries stay in place while the runtime is missing. Install it from **Runtime**, then run **Sync** to finish applying the session entries and removing the old entries; installing the runtime alone does not finish that conversion.

**Finish importing differences:** in 0.3.1, connections still awaiting import did not appear in Sync, even when only their descriptions differed. Finish the Register comparison or use **Import existing connections** to review them. Updated Sync screens show **Not yet imported** and offer **Import existing connections** on the same screen. Complete that import review even when the saved connections are already up to date.

**Existing development registry:** if setup shows **Registry update available**, open **Migrate registry**, review the proposed changes and confirm them. See [Migrate an older registry](#migrate-an-older-registry).

**Return to individual entries:** open **Runtime**, select the kind, choose **Switch back to per-connection entries**, then review and confirm. This restores the saved individual launch commands and credentials and removes the session entry after the replacements are verified; the registry stays version 2. Restart or reconnect clients after changing the layout.

## Shared registration

### Startup checks and updates

After saving a changed connection, applying Runtime launch commands, or updating from **Updates**, setup starts each distinct saved command once without shell interpolation. It sends MCP `initialize` and `tools/list`, then closes stdin; it does not invoke database, SSH, WSL or S3 tools. The check takes at most about 10 seconds per entry, plus bounded process cleanup. Results show the server version and tool count, or the exit code and masked stderr tail. Standard runtime script paths and spawn command paths stay visible for diagnosis. Session checks also verify a tool-name prefix for every saved connection. A failed check keeps the saved settings: fix it before restarting or reconnecting AI clients. Identical command/arguments/environment values share one check.

Open **Updates** in the launcher or any package config menu to see installed and latest published runtime versions. Version lookup runs only when this screen opens or **Refresh versions** is chosen, with a short timeout; offline results show **Unavailable**. Update one runtime or all installed runtimes with newer releases; missing runtimes can be installed individually. Development links are displayed but never updated, and WSL is listed only on Windows. Updates use the same dedicated AKMS runtime directory and check that kind's saved connections afterward. Reconnect your AI clients to use the new runtime. The helper itself is not updated here.

Register confirmation defaults to **No** when deselecting a previously registered service; otherwise it defaults to **Yes**.

### Session server mode

New catalogs start in version 2 with session mode enabled. Register your AI services, then add connections; setup creates each kind's session entry automatically. Existing version 1 catalogs keep individual mode until you approve **Migrate registry** or a per-kind **Runtime > Switch to session server** conversion (default No). Register/import their existing connections first. Each registered AI service gets one `akms_db`, `akms_ssh`, `akms_wsl` or `akms_s3` entry for that kind, running Node directly with `--catalog`. The helper package is optional. A client session still owns its own stdio process; connections of the same kind share that process.

The server reads its connections from the shared catalog at startup. Tools include the connection name, for example `production__db_query`; their arguments stay unchanged. Add/Edit/Remove updates the catalog; reconnect your clients to load changes. Removing the last connection removes the session entry. An invalid connection is excluded while valid ones remain available; `<kind>_catalog_status` reports the loaded/excluded names without credentials. No database, SSH, WSL or S3 connection opens just to list tools.

Converting an existing version 1 catalog upgrades it to version 2 and keeps the previous revision. Older setup packages stop without modifying version 2. New kinds in a new catalog also default to sessions; each kind's explicit rollback choice is retained. AKMS removes managed individual entries only after verifying the session entry; external edits stay for **Sync** review. Custom launch commands are retained in the catalog for rollback but are not executed in session mode.

**Runtime > Switch back to per-connection entries** previews and restores the saved individual entries, including their credentials and launch commands. It removes the session entry after the replacements are verified. The registry stays version 2. **Reapply session launch command** updates paths after moving Node or the runtime. Restart/reconnect clients after either change.

Connection names use ASCII letters, digits, underscores or hyphens: DB up to 35 characters, SSH/WSL 30, S3 37. The four `akms_<kind>` names are reserved. These limits keep client-prefixed tool names within 64 characters; rename longer legacy entries before conversion.

### Migrate an older registry

When a version 1 registry or a version 2 registry without a default-mode marker is opened, the helper and each config menu show **Registry update available** and **Migrate registry**. Select it to review the ordered format steps, every kind's current layout, per-service additions/removals, and settings kept for Sync. Approval defaults to **No**.

Migration upgrades v1 to v2, records `defaultMode: "catalog"`, and converts individual kinds through the existing session conversion rules. Kinds explicitly switched back to individual entries keep that choice. Already bundled kinds keep their launch commands; an unmarked v2 containing only bundles receives the marker without client-file changes. Missing runtimes leave existing entries in place for **Runtime** installation and **Sync**. Startup checks verify the affected session tools after approval.

One `registry.previous.json` revision covers the whole migration. Repeating migration on a current registry does nothing. Runtime still offers per-kind conversion and rollback. **Runtime > Use individual entries for new kinds** turns the future-kind default off, and **Start new kinds as session servers** turns it back on; existing kinds retain their modes. The explicit `individual` default is also current format, so turning it off does not trigger another migration notice.

### Catalog security

The shared catalog is `~/.akms/mcp/registry.json`, or `$AKMS_MCP_HOME/registry.json`. It contains complete connection settings, including passwords and secret values **in plaintext**. In individual mode these values also appear in AI client entries. After successful session-mode conversion and resolution of any retained legacy entries, the catalog is the only active location for that kind's connection credentials; one previous-revision copy also contains them. This includes DB/SSH passwords and passphrases, and S3 static access keys and session tokens. SSH private-key settings store file paths, not the key files themselves.

On POSIX, new catalog files request mode `0600` and new catalog directories `0700`; existing permissions are not tightened. Windows uses inherited parent-directory ACLs (normally the user profile), not POSIX owner/group modes. Check access permissions when choosing a custom location.

Keep both catalog files private: do not commit it, share it, copy it to another person or PC, paste its contents into chats/issues/AI conversations, or ask an AI agent to print it. Exclude it from cloud sync and shared backups, or protect those copies. Prefer SSH key authentication over passwords where possible. If exposed, change the affected passwords or rotate the affected keys/tokens, then update the connections through `config`.

SSH blocks local uploads from and downloads into `.akms/mcp`. A custom `AKMS_MCP_HOME` outside that path is not protected as a whole: its `registry.json` and `registry.previous.json` are additionally blocked when the SSH process has that environment variable. Remote SSH paths have no catalog-specific block. WSL protects these paths through `/mnt/<drive>/`; native Linux paths have no catalog-specific block, and local Windows transfers depend on the installed SSH guard. The locked SSH 0.1.9 dependency does not block the catalog in those local transfers. Do not rely on these guards to keep the file private.

Each successful catalog-changing operation atomically keeps one previous revision as **`registry.previous.json`** in the same directory. Internal application bookkeeping does not replace that pre-operation revision, and a no-op Sync leaves it unchanged. The copy requests the catalog's existing file permissions; Windows uses inherited ACLs. This is one revision, not a history.

To recover, close configuration commands, preserve the current file if needed, and copy `registry.previous.json` over `registry.json` in that directory. Then reopen setup, review **Sync**, and reconnect clients. Recovery does not automatically revert client files.

A running session keeps its startup snapshot. If `registry.json` is missing or invalid, a newly started session exposes only its status tool; its empty client entry cannot reconstruct credentials through Import. Restore the previous revision or enter the connections again. Individual mode still uses each entry's environment, so its existing client entries keep working and can be imported after registering services again.

Each standalone package can manage the catalog; the helper is optional. New services receive existing entries. Unregistering removes only AKMS-managed entries from that service and preserves the catalog.

Register discovers earlier settings and imports matching copies together on Apply. Identical copies become one shared item. In session mode, managed individual entries are replaced after the session launch is verified. If a runtime is missing, install it from Runtime and run Sync; existing entries stay until then. Use **Import existing connections** to review differing versions or import remaining matching entries in a batch. Different versions require a choice before applying. Results summarize completed connections and list only items needing attention. Comparisons show changed fields, label description-only differences, and hide secret values. Partial failures retain successful writes; Sync offers retries and explicit resolution of client edits. `--target` preselects a service in registration; saves still apply to all registered services.

## Minimum working configuration

The launcher needs **no environment variables or MCP server entry**. With Node.js 22+, npm and access to your configured npm registry, run:

```sh
npx -y --prefer-online @akms/mcp@latest
```

Register at least one AI service, then choose a server and enter its connection values. The launcher opens the selected package's `config` menu; that package saves the connection in the shared local catalog and applies it to all registered AI services. Replace example names and credentials with your own. Each server package's README includes a **Minimum working configuration** section with a complete entry and its prerequisites.

| Server | Minimum connection values | Prerequisites and defaults |
|---|---|---|
| Database | `DB_DRIVER=postgres`, `DB_HOST`, `DB_NAME`, `DB_USER`; `DB_PASSWORD` when password authentication is required | Reachable PostgreSQL database; port `5432`, TLS `require`. Set `DB_SSL=off` only for a database without TLS. Alternatively use `DB_DRIVER=postgres` with `DB_URL`. |
| SSH | `SSH_HOST`, `SSH_USER`, plus `SSH_KEY` or `SSH_PASSWORD` | Reachable SSH server; port `22`. Omit both authentication fields only when the MCP process can use an SSH agent with an authorized key. |
| WSL | `WSL_DISTRO` | Run the MCP client on Windows; the named distro must already be installed with `bash`. Uses the distro's default user. |
| AWS S3 | `S3_BUCKET`, `S3_REGION`, `S3_AUTH=static`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Existing bucket and credentials permitted to access it; temporary credentials also need `S3_SESSION_TOKEN`. With an available AWS credential provider, omit the three static-auth fields. |
| S3-compatible | `S3_BACKEND=compatible`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_AUTH=static`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Existing bucket, service endpoint, signing region and credentials. |

For either S3 backend, `S3_LOCAL_ROOT` is needed only for local file upload/download; it must name an existing directory. Object listing, text reads/writes and deletion do not need it.

## Installed runtime setup

Choosing a server opens the installed AKMS runtime's `config` screen directly through Node, so setup and server execution use the same version. This path makes no npm calls and does not require registry access, including for linked development checkouts.

If the runtime is missing, the launcher asks to install it (default **Yes**) into `<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`, then opens that installed version. If installation fails, the reason is shown and a second question offers the latest setup through `npm exec` (default **No**). Only an explicit Yes uses that fallback: it checks npm's `latest` tag with fresh metadata and runs the exact returned version. A failed lookup does not open a cached setup release.

The MCP packages are **not dependencies** of this package. The managed runtime prefix is independent of Node versions, and saved connections use Node plus the runtime's `lib/cli.js` path. **Updates** checks published versions on demand; **Runtime** manages installations and conversion of existing launch commands. Saved MCP servers do not run npm or check for updates at startup. Updating a compatible MCP runtime does not require a new launcher release.

| Selection | Package | Setup command |
|---|---|---|
| Database | `@akms/mcp-db` | `config` |
| SSH | `@akms/mcp-ssh` | `config` |
| WSL | `@akms/mcp-wsl` | `config` |
| S3 | `@akms/mcp-s3` | `config` |

During local development, build the child package and run `npm install -g --prefix "<AKMS runtime directory>" "<checkout path>"`. The launcher opens that linked runtime directly. Linked runtime installations use the checkout and are protected from automatic replacement with a published release.

The selected MCP owns its connection forms, validation and server execution. Service registration and sync code is included in each package and this optional helper. Entries saved for your AI client follow that MCP's own behavior.

On an interactive terminal, connection menus, registration and comparisons use separate screens. Results and errors stay visible until Enter or Esc; returning to the menu shows current services and any connections needing attention. Piped commands keep plain output and need no extra answers. Sync labels the saved AKMS version and the current service version separately. Numbered choices show which service receives a value or whether it becomes the AKMS value for all registered services. Long values wrap, changed text is highlighted, and confirmation names the destinations.

## Terminal controls

Use arrow keys and Enter, or number keys to move to a row. Esc returns to the previous menu; Esc at the main menu exits. The menu uses the same selection and rendering code as the SSH and WSL packages.

Outside an interactive terminal, menus show numbers and accept a number, key or label. For scripted setup, the direct command is easiest: `akms-mcp db` passes stdin to the database setup screen.

See [development notes](./README_DEV.md) for build and test instructions.
