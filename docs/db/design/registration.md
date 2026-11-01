# Shared registration

The single `@akms/mcp` package owns the setup menu and shared registration code. `akms-mcp register` and `akms-mcp sync` manage all kinds; each `lib/<kind>.js config` screen manages that kind's connections. The same package provides the independent server entry files used by AI clients.

## Ownership and flow

- `register` selects user-wide AI services. Selection applies across MCP kinds.
  Discovery lists existing AKMS entries before registration. Apply previews and
  imports unambiguous names in one batch, merging identical old sync copies;
  differing versions stay intact until explicitly reviewed. Import rechecks the
  reviewed source values before any writes. Pending deletions are not reimported.
- A kind's `config` screen shows its shared connections, Add and Back. Register and Sync are opened from the main setup menu; import is inside Sync, while migration is inside Runtime.
  Add without registered services shows a Register instruction and returns to
  the menu without opening a form. Saving also rechecks registration under the
  catalog lock, so unregistering during an open form cannot create local-only entries.
- Results summarize successes and group unresolved items by connection.
  Comparisons show differing fields only, with description-only changes called
  out and secret values hidden. Numbered versions identify AKMS as the shared
  saved source and each service as a current source. Choices and confirmation
  identify destinations. Values wrap using terminal column widths, with changed
  non-secret text highlighted; removal/restoration uses separate labels.
  Existing shared items go to Sync; unmanaged
  legacy entries go to Import, with an explicit choice before replacement.
- Interactive screens clear only the visible terminal viewport at navigation
  boundaries. Results and errors wait for Enter or Esc before returning. The
  main menu redraws service selection and a short unresolved-connection count.
  Existing scrollback is not erased. Pipes emit no screen-control codes and
  consume no additional acknowledgement input.
- Connection forms and connection checks belong to each MCP. A virtual
  `ConfigTarget` adapts the existing forms to the shared catalog.
- Saving or removing a connection reconciles it with every registered service.
  Adding a service backfills existing entries; removing one removes only entries
  previously managed by AKMS on that service. The shared catalog is retained.
- Managed client entries use `--catalog` to read a startup snapshot without locks or writes. Setup groups each kind's connections into one process per AI client session, with connection-prefixed tools and lazy remote connections. Manual environment-based startup still serves one connection. Neither invocation runs registration or requires a management process to stay open.

## Adding without the menu

`akms-mcp add <kind> <name>` saves one new connection for scripts and AI agents. The shared flow is `src/modules/registration/add-command.ts`; each kind supplies its option list (`modules/manage/add-fields.ts`) and its server's parser.

- Options are an allow-list. Settings that run local commands (`SSH_PROXY_COMMAND`), settings that would put a password on the command line (`DB_URL`) and custom launch commands have no option, and stay in the setup menu.
- Secret options take no value. They read a hidden prompt on a terminal, otherwise one stdin line each in option order. Errors repeat only options from the list and never what was typed, because a mistyped command can hold a password, even one starting with `--`.
- It only adds. The name is checked before any secret is requested and again under the catalog lock (`Registry.add`), so it cannot change an existing connection's settings or permissions, however long a prompt stays open. A name waiting for removal counts as taken, because reusing it would discard the pending deletion and its replacement.
- Everything that can refuse runs before a secret is requested: a pending migration, no registered service, no runtime, an existing name. The server's own parser then checks the settings before anything is saved, and the startup check runs afterwards.
- stdout carries one JSON object; prompts and the startup report go to stderr. `saved` turns true when the catalog commit returns, not when the command ends: clients are written and the catalog saved again afterwards, so a later step can fail with the connection already saved. The launcher starts its own `lib/<kind>.js add`, not the installed runtime's: an older runtime has no `add`, ignores the word and starts its MCP server on the same pipes.

This is a command rather than an MCP tool on purpose. Servers stay startup-snapshot readers that never write the catalog or client settings. A kind's server exists only once it has a connection, so a tool could not add the first one. Tool arguments pass through the model, so a password would enter the conversation; MCP form elicitation may not collect passwords, and URL elicitation would need a separate local page. A registration tool would also sit in every session's tool list, within reach of a prompt injection, and could reach local command execution through a proxy command. An agent that can run this command already has a shell, so the command adds no new authority. The cost is that clients without a shell, such as Claude Desktop, have no way to use it.

## Dedicated server runtime

New managed connections use the Node executable and the runtime package's
`lib/<kind>.js` path, never an npm/npx wrapper. The dedicated installation prefix is
`<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`, independent of the active Node version.
Discovery computes `<prefix>/node_modules` on Windows and `<prefix>/lib/node_modules`
elsewhere without running npm. Installation passes `--global --prefix <prefix>`.
The shared setup installs `@akms/mcp@latest` when a managed runtime is required and missing. Imported custom commands can remain in catalog metadata; the grouped server uses their environment values rather than executing those commands. An update failure reports its
cause and continues only if an installed runtime remains discoverable.
Installation is a setup operation; MCP stdio startup never invokes npm.
ManagedSession receives the setup package version as an option.
Add/Edit offer an update (default Yes) when that version is newer than the runtime;
declining keeps the installed version. Linked packages skip update prompts.

Migrate registry previews conversion of recognized legacy direct paths and npx launches to the unified package and groups imported connection settings.
Launch-path replacement changes command and arguments while retaining saved connection environment values in the catalog. Version-pinned
npx entries switch to the installed version shown in the preview. Direct path conversion skips custom wrappers and extra flags; grouped servers can still use imported environment values without running those wrappers. Catalog/service snapshots are checked again under the
lock, and ordinary ownership checks preserve external client edits for Sync.
Legacy entries must first be registered/imported. Existing npx launches remain
recognized for migration; clients need a restart or reconnect after conversion.

Runtime discovery validates the package name and the kind's `lib/<kind>.js` file.
It preserves the Node alias and the package link path; nvm-windows can change
Node versions without losing the package installation. Update actions are not offered for linked development installations. Build a checkout and link it using
`npm install -g --prefix <runtime> <checkout>`. Moving the Node command path or
AKMS_MCP_HOME requires reapplying current paths from Runtime.
The installer invokes npm's JavaScript CLI directly without a shell; discovery
includes Unix prefix layouts and rejects non-JavaScript version-manager shims.
It runs outside registry locks, has a deadline, and reports installation failure
with the last six npm stderr lines (ANSI stripped), without saving a connection
or falling back to npx.

## Grouped servers and migration

Setup always groups connections into one `akms_<kind>` entry per registered AI service. The grouped server reads a catalog snapshot and exposes connection-prefixed tools; each connection keeps its own credentials and policy. Direct environment-based server startup remains available for manual connections, whose settings setup can import into the grouped catalog.

Runtime shows **Migrate registry** only when changes can apply, and reports missing or blocked prerequisites otherwise. Migration previews the affected kinds and services, old/new package versions, additions, retained external edits and removals after replacement verification. Apply confirmation defaults to No.

Only needed steps are included, in this order:

1. `v1_to_v2` upgrades a version 1 catalog and prepares grouped entries.
2. `catalog_default` records the grouped default for older version 2 catalogs without a marker.
3. `group_all` converts older version 2 catalogs with `defaultMode: "individual"` or a kind saved as `mode: "individual"`. Those markers are legacy input to migration, including kinds previously changed back to separate entries. The resulting catalog groups every kind and uses `defaultMode: "catalog"`.
4. `single_package` repoints recognized old per-kind direct paths and npx launches to `@akms/mcp/lib/<kind>.js`.

`Registry.needsMigration()`, `planMigration()` and `applyMigration(plan)` expose this workflow. Planning performs no writes. Apply rechecks the reviewed catalog and runtime, saves desired changes under the catalog lock, and then reconciles clients. One previous-revision copy retains the complete pre-operation state. An already grouped catalog with current unified paths may need only its missing marker, with zero client writes. A plan with no remaining steps does not save, reconcile or rotate the backup.

Missing runtime installations preserve existing client entries. Install from Runtime, reopen Migrate registry when offered, and use Sync to finish retained differences or failed writes. The grouped entry is installed and verified before managed separate entries are removed from each service. Startup checks verify a tool-name prefix for every saved connection.

New catalogs start at version 2 with `defaultMode: "catalog"`, empty connections and empty sessions. Register can save service selection before runtime installation; adding or importing a connection prepares its kind's grouped launch when the runtime is ready. Each launch is `node <package>/lib/<kind>.js --catalog`, with no connection credentials in the client entry. Its environment is empty at the default catalog location, or contains `AKMS_MCP_HOME` for an explicit location.

A grouped server uses each saved environment to construct a separate lazy connection. Custom imported commands can remain as metadata but are not executed by the grouped server. Add/Edit/Remove updates the catalog without rewriting an unchanged grouped launch. Removing the last active connection removes that service entry; adding one back recreates it. Clients must reconnect to load a changed startup snapshot.

Each AI client session owns its stdio process. Connections of the same kind share that process and expose `<connection>__<tool>` names without changing tool arguments. Names use ASCII letters, digits, underscores or hyphens and fit the complete 64-character client-prefixed tool name: DB 35 characters, SSH/WSL 30, S3 37. `akms_db`, `akms_ssh`, `akms_wsl` and `akms_s3` are reserved. The read-only v1/v2 `catalog.ts` reader returns generic problems without environment values and excludes invalid connections independently.

`~/.akms/mcp/registry.json`, or `$AKMS_MCP_HOME/registry.json`, contains:

- `version`: the schema version. Unknown versions fail closed without rewriting.
- `clients`: registered IDs (`claude-code`, `codex`, `claude-desktop`, `cursor`).
- `connections`: globally unique names mapping to `kind`, canonical `entry` (`command`, `args`, `env`) and per-service `applied` hashes. Fields outside these owned fields remain in the client configuration.
- A null `entry` is a pending deletion. A renamed connection records `replacement`; its old name stays on each service until the replacement is installed. Failed writes and CLI restarts preserve pending deletions.
- Version 2 `sessions` records grouped launches by kind, with `mode: "catalog"`, a direct launch `entry` and per-service `applied` hashes. Readers still accept the old `individual` markers so Migrate registry can convert existing files through `group_all`. Kinds waiting for a runtime may temporarily lack session state while their old entries remain intact.

The canonical catalog entry contains the complete command, arguments and environment
in plaintext, including passwords, passphrases and S3 static keys/tokens.
Legacy or manually created client entries can also contain those values until they are imported and replaced. After successful grouped migration and review of retained external entries, the catalog is the only
active credential location for that kind, plus its previous-revision copy.
SSH key settings retain file paths
and do not copy private-key file contents. Only the separate `applied` bookkeeping
uses hashes. WSL shares this catalog even though its own settings need no password.

New files request POSIX mode 0600 and new directories 0700. Existing POSIX file
modes and directory permissions are preserved, not tightened. On Windows, directory
ACL inheritance controls access; Node's owner/group mode distinction is not
implemented there ([Node file modes](https://nodejs.org/docs/latest-v24.x/api/fs.html#file-modes)).
The default location inherits permissions under the user profile; custom locations
need their parent ACLs checked. No special Windows ACL is installed by this code.

Do not commit, share, copy to another PC, or paste the catalog into chats, issues
or AI conversations; do not ask an agent to print it. Exclude or protect cloud-sync
and shared-backup copies. Prefer SSH keys where possible. If exposed, change
affected passwords or rotate keys/tokens at the provider, then update `config`.
These are operational recommendations because the file is a plaintext credential
copy, not protection implemented by the catalog format.

The SSH local file-tool guard blocks the `.akms/mcp` tree for upload sources and
download destinations. If AKMS_MCP_HOME is available in the server environment,
its exact registry.json and registry.previous.json are also blocked; a custom directory outside `.akms/mcp`
is not protected as a whole. SSH remote paths are limited by allowedPaths and
readonly, without a catalog-specific exclusion. WSL's `/mnt/<drive>/` guard
blocks the default tree and the configured custom registry, but native Linux
paths have no catalog-specific block. Its Windows-local upload/download guard uses the SSH implementation bundled in the same package, including catalog-path protection.

Every operation that changes the catalog atomically retains one previous revision
as `registry.previous.json` beside it. The copy uses the source file's mode;
Windows permissions come from the containing directory's ACL. Internal writes
recording applied hashes do not overwrite the pre-operation revision. No-op Sync
does not rotate it. Failure to commit the backup prevents committing a desired-state
edit and beginning that edit's client changes. Sync retries remain resumable
per-service operations rather than transactions across files. This is one
revision, not history.

For recovery, close configuration commands, preserve the current file if needed,
copy `registry.previous.json` over `registry.json`, then reopen setup and review
Sync before reconnecting clients. Recovery does not restore client files itself.
No server automatically falls back to the previous revision. A running session
keeps its snapshot; a new catalog-mode server with a missing or invalid catalog
exposes only the status tool. Credential-free session client entries cannot be
imported to reconstruct lost connections. Existing manual or legacy environment-based client entries can still work independently of the catalog. Import can recover their settings into grouped entries after registration.

Evidence for the README and CLI statements:

| Statement | Evidence |
|---|---|
| Plaintext values, matching client entries, SSH key paths | `tests/registration/registration-security.test.ts`: `stores complete credential values in plaintext, matching the client, while SSH keys remain paths` (shared suite); S3 credential fields are read in `src/kinds/s3/profile.ts` |
| Default/override location and requested modes | Same suite: `uses the configured catalog directory and requests private creation modes`; actual mode assertions run on POSIX, creation arguments are checked on every platform; Windows ACL evidence is recorded in the isolated validation report |
| Notice appears once and pipe input remains usable | Same suite: `shows the privacy notice once across repeated Apply reviews in plain piped input`, `does not repeat the privacy notice while only selecting services`; each package's `tests/catalog-help.test.ts` checks plain help output |
| Legacy/manual entries can be imported after catalog loss; grouped entries require recovery | `registration-security.test.ts` covers importing legacy environment-based entries; `registration-session.test.ts` covers previous-revision recovery; each server's `catalog-server.test.ts` covers empty/invalid catalogs |
| SSH and WSL transfer scope, including custom paths and shared guard behavior | The `tests/ssh/catalog-transfer-security.test.ts` and `tests/wsl/catalog-transfer-security.test.ts` files exercise actual local tool handlers with mocked transfer I/O and the remote/distro path guards |
| Handling advice | Recommendations based on plaintext storage and the verified guard limitations; they do not claim encryption, automatic backup exclusion or provider-side credential rotation |

## Post-save startup checks and runtime updates

After a changed save or runtime update, setup starts each distinct saved command once and sends MCP `initialize` and `tools/list`, never `tools/call`. It verifies every saved connection's tool prefix in session mode, closes stdin and waits for exit with bounded process cleanup. Failures keep the saved state and report masked diagnostics.

Runtime owns installation and updates of the single `@akms/mcp` package. Its main-menu notice compares installed and setup versions locally. `Check for updates` queries npm on demand, then offers `Update to <version>`. Linked development installations have no update action. Runtime offers **Update launch commands** only when a saved grouped launch differs from the installed runtime; the review updates those commands.

## Reconciliation and concurrent editing

An exclusive PID lock serializes catalog changes across setup processes. A dead owner's
lock can be reclaimed; an active owner makes a second writer stop and retry.
Desired state is saved before client changes, and applied state is recorded
after each verified write. Success on one service remains valid when another
fails. This is a resumable operation, not an atomic transaction across clients.
Session migration installs and verifies the bundle before removing managed
separate legacy entries on each service. External edits block their own replacement/removal
and stay visible in Sync. Sync can restore the AKMS session launch; it cannot
import an arbitrary external session launch as a connection. Retained external single-connection settings can be imported into the grouped catalog before removing that entry.

For each owned entry, compare the current destination fields against the last
applied hash and desired hash. External edits and unmanaged conflicting names
require review; unsupported HTTP entries and different servers are not replaced.
Sync can explicitly reapply the shared version or import a changed service's
version. Import and resolution recheck the reviewed value before applying.
Shared forms and registration also detect stale edits from another command.

The existing adapters preserve unrelated entries. JSON/TOML writes stage an
adjacent file and replace the destination; TOML is validated before and after
editing. Claude Code uses its CLI. Changes are read back before being counted as
applied. Client reload/restart is separate from successful configuration writes.

## Distribution and maintenance

Registration, catalog reading, session routing and prompt-error classes live once under `src/modules/`. Kind connection forms stay under `src/kinds/<kind>/`. There is no sibling-copy synchronization step or separate setup dependency. See the [contributor guide](../../../README_DEV.md) for current build and test commands.

The ordered migration groups legacy connection layouts through `v1_to_v2`, `catalog_default` and `group_all` as needed, and repoints recognized old direct paths and npx launches through `single_package`. Runtime installs missing prerequisites before exposing the migration action. Migration leaves registry version 2 unchanged. Reconciliation updates managed client entries; externally edited entries remain for Sync review. A missing runtime leaves the old launch in place and the migration available to retry.

Runtime offers old-package removal only after catalog and inspected client references no longer use it. References are checked again before removal, and confirmation defaults to No. Running AI clients must reconnect to load replaced code.
