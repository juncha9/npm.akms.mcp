# Shared registration

The single `@akms/mcp` package owns the setup menu and shared registration code. `akms-mcp register` and `akms-mcp sync` manage all kinds; each `lib/<kind>.js config` screen manages that kind's connections. The same package provides the independent server entry files used by AI clients.

## Ownership and flow

- `register` selects user-wide AI services. Selection applies across MCP kinds.
  Discovery lists existing AKMS entries before registration. Apply previews and
  imports unambiguous names in one batch, merging identical old sync copies;
  differing versions stay intact until explicitly reviewed. Import rechecks the
  reviewed source values before any writes. Pending deletions are not reimported.
- A kind's `config` screen shows its shared connections, Add and Back. Register and Sync are opened from the main setup menu; import is inside Sync, while migration and server layout are inside Runtime.
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
- The ordinary stdio invocation remains environment-based. With `--catalog`,
  the server reads a startup snapshot without locks or writes; neither mode
  invokes registration or requires a running management process. Each kind uses one process per AI client session, with connection-prefixed tools and lazy remote connections.

## Dedicated server runtime

New managed connections use the Node executable and the runtime package's
`lib/<kind>.js` path, never an npm/npx wrapper. The dedicated installation prefix is
`<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`, independent of the active Node version.
Discovery computes `<prefix>/node_modules` on Windows and `<prefix>/lib/node_modules`
elsewhere without running npm. Installation passes `--global --prefix <prefix>`.
After the registration guard, Add and standard-launch Edit install
`@akms/mcp@latest` only when no valid runtime is present; standard-launch
host-key saves also check before writing. Custom commands keep their launch
settings without requiring the managed runtime. An update failure reports its
cause and continues only if an installed runtime remains discoverable.
Installation is a setup operation; MCP stdio startup never invokes npm.
ManagedSession receives the setup package version as an option.
Add/Edit offer an update (default Yes) when that version is newer than the runtime;
declining keeps the installed version. Linked packages skip update prompts.

Migrate registry previews a batch conversion of standard npx/binary/old direct launches to the unified package.
Only command and arguments change; environment values are retained. Version-pinned
npx entries switch to the installed version shown in the preview. Custom wrappers
and extra flags are skipped. Catalog/service snapshots are checked again under the
lock, and ordinary ownership checks preserve external client edits for Sync.
Legacy entries must first be registered/imported. Existing npx launches remain
recognized for migration; clients need a restart or reconnect after conversion.

Runtime discovery validates the package name, bin declaration and script file.
It preserves the Node alias and the package link path; nvm-windows can change
Node versions without losing the package installation. Automatic updates refuse
to replace development links. Build a checkout and link it using
`npm install -g --prefix <runtime> <checkout>`. Moving the Node command path or
AKMS_MCP_HOME requires reapplying current paths from Runtime.
The installer invokes npm's JavaScript CLI directly without a shell; discovery
includes Unix prefix layouts and rejects non-JavaScript version-manager shims.
It runs outside registry locks, has a deadline, and reports installation failure
with the last six npm stderr lines (ANSI stripped), without saving a connection
or falling back to npx.

## Session migration and local schema

The main setup menu detects version 1, version 2 without `defaultMode`, and saved launches that still use the separate per-kind packages. The Runtime row shows **Registry update available**. Runtime exposes **Migrate registry** only when it can apply, with waiting/blocked reasons otherwise. Review leads to ordered
steps (`v1_to_v2`, `catalog_default`, then `single_package`), a per-kind/per-service preview, and
approval defaulting to No. The preview lists additions, removals after replacement
verification, external settings retained for Sync, missing-runtime work, and
explicit individual-mode rollback choices that remain unchanged.

`Registry.needsMigration()`, `planMigration()`, and `applyMigration(plan)` expose
the same workflow to scripts. Planning performs no writes. Apply checks the
reviewed snapshot and runtime paths again, shares session planning/transitions
with `planSession`/`applySession`, and records all desired changes under one
existing lock before reconciling clients. One previous-revision copy retains the
complete pre-migration state. An unmarked v2 whose active kinds are already bundled and use the current unified paths needs only the default marker, with zero client writes. Applying a plan
with no remaining steps does not save, reconcile, or rotate the backup.

Migration converts individual kinds except explicit `sessions[kind].mode:
"individual"` rollback choices. Missing-runtime kinds retain their legacy entries
until Runtime installation and Sync can verify a replacement. The UI runs startup
checks after migration, including connection-prefix coverage. Per-kind conversion and rollback remain under Runtime > Server layout.

Runtime can turn the default for new kinds off or on through
`Registry.setDefaultMode("individual" | "catalog")`. Existing explicit choices
remain intact; existing implicit modes are materialized before the default is
changed. Pending runtime setup must finish first. An explicit individual default
is current format too, so disabling the default does not show an older-format
notice. Version 1 and unmarked v2 require migration before changing this default.

Runtime > Server layout offers **Switch to one server (akms_<kind>)**, with a per-service preview and confirmation defaulting to No. Each kind has one `akms_<kind>` entry running `node <package>/lib/<kind>.js --catalog`. Its environment is empty at the default
location, or contains only `AKMS_MCP_HOME` for an explicit catalog location.
Register and Import keep existing version 1 files until an explicit migration or
per-kind switch.
New catalogs start at version 2 with `defaultMode: "catalog"`, empty connections
and empty sessions. Register can save service selection without requiring any
runtime; the first Add or import initializes each kind's session launch before
applying client changes. Existing v1 files upgrade only through the confirmed
Runtime switch or registry migration. Older setup packages fail closed before
writing client settings.

When a fresh Register/import finds existing entries but that kind's runtime is
missing, it saves the imported connections and ownership without deleting their
client entries. Results instruct the user to install from Runtime and run Sync.
Sync then persists and verifies the new session launch before removing the old
entries. The ordinary first-Add flow prepares the runtime before saving its form.

Each client session owns its stdio process. Within it, connections of the same
kind share the process and expose `<connection>__<tool>` names. Tool arguments
stay unchanged. Names use ASCII letters, digits, underscores or hyphens and
must fit the complete 64-character client-prefixed tool name: DB 35 characters,
SSH/WSL 30, S3 37. `akms_db`, `akms_ssh`, `akms_wsl`, `akms_s3` are reserved.
`catalog.ts` exports the read-only v1/v2 reader and the tool-name budget. It has
no management imports, tolerates unreadable/invalid files, and returns generic
problems without environment values. Invalid entries are excluded independently.

The confirmed switch preserves saved individual launch commands for rollback,
including custom wrappers. Those wrappers are not run in catalog mode. The
server uses each saved environment to construct a separate lazy connection.
Add/Edit/Remove changes catalog data without rewriting an unchanged session
entry. Removing the last active connection removes that entry; adding one back
recreates it. Clients must reconnect to load the changed snapshot.

**Switch back to per-connection entries** previews the inverse change, restores
individual entries, and removes the session entry only after all replacements
are verified on that service. The schema stays version 2 to prevent older
packages from silently interpreting session bookkeeping as individual mode.

`~/.akms/mcp/registry.json`, or `$AKMS_MCP_HOME/registry.json`, contains:

- `version`: a schema version. Unknown versions fail closed without rewriting.
- `clients`: registered IDs (`claude-code`, `codex`, `claude-desktop`, `cursor`).
- `connections`: globally unique names mapping to `kind`, canonical `entry`
  (`command`, `args`, `env`) and `applied` hashes per service. Client-specific
  fields outside those owned fields remain in the destination configuration.
- A null `entry` is a pending deletion. A deletion created by renaming includes
  `replacement`; the old name is kept on each service until its replacement is
  installed. Pending deletions survive failed writes and CLI restarts.
- Version 2 additionally requires `sessions`, keyed by kind, with `mode`
  (`catalog` or `individual`), the direct launch `entry`, and per-service
  `applied` hashes. An explicit per-kind mode overrides `defaultMode`. New v2
  files use `defaultMode: "catalog"`, including for kinds added later; old v2
  files without this field retain individual mode for kinds without session
  state. Rollback records the explicit individual choice so later saves do not
  switch it back. Missing-runtime kinds may wait without materialized session
  state while their existing client entries remain intact.

The canonical catalog entry contains the complete command, arguments and environment
in plaintext, including passwords, passphrases and S3 static keys/tokens. These
values match client entries in individual mode. After successful session-mode
migration and review of retained external entries, the catalog is the only
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
imported to reconstruct lost connections. In individual mode, existing client
entries continue working and Import can rebuild the catalog after registration.

Evidence for the README and CLI statements:

| Statement | Evidence |
|---|---|
| Plaintext values, matching client entries, SSH key paths | `tests/registration/registration-security.test.ts`: `stores complete credential values in plaintext, matching the client, while SSH keys remain paths` (shared suite); S3 credential fields are read in `src/kinds/s3/profile.ts` |
| Default/override location and requested modes | Same suite: `uses the configured catalog directory and requests private creation modes`; actual mode assertions run on POSIX, creation arguments are checked on every platform; Windows ACL evidence is recorded in the isolated validation report |
| Notice appears once and pipe input remains usable | Same suite: `shows the privacy notice once across repeated Apply reviews in plain piped input`, `does not repeat the privacy notice while only selecting services`; each package's `tests/catalog-help.test.ts` checks plain help output |
| Individual entries survive deletion; catalog sessions require recovery | `registration-security.test.ts` covers individual-mode Import; `registration-session.test.ts` covers previous-revision recovery; each server's `catalog-server.test.ts` covers empty/invalid catalogs |
| SSH and WSL transfer scope, including custom paths and shared guard behavior | The `tests/ssh/catalog-transfer-security.test.ts` and `tests/wsl/catalog-transfer-security.test.ts` files exercise actual local tool handlers with mocked transfer I/O and the remote/distro path guards |
| Handling advice | Recommendations based on plaintext storage and the verified guard limitations; they do not claim encryption, automatic backup exclusion or provider-side credential rotation |

## Post-save startup checks and runtime updates

After a changed save or runtime update, setup starts each distinct saved command once and sends MCP `initialize` and `tools/list`, never `tools/call`. It verifies every saved connection's tool prefix in session mode, closes stdin and waits for exit with bounded process cleanup. Failures keep the saved state and report masked diagnostics.

Runtime owns installation and updates of the single `@akms/mcp` package. Its main-menu notice compares installed and setup versions locally. `Check for updates` queries npm on demand, then offers `Update to <version>`. Linked development installations are not automatically replaced. `Server layout` contains kind-specific session/individual transitions and the default for new kinds.

## Reconciliation and concurrent editing

An exclusive PID lock serializes catalog changes across packages. A dead owner's
lock can be reclaimed; an active owner makes a second writer stop and retry.
Desired state is saved before client changes, and applied state is recorded
after each verified write. Success on one service remains valid when another
fails. This is a resumable operation, not an atomic transaction across clients.
Session migration installs and verifies the bundle before removing managed
individual entries on each service. Rollback verifies all individual entries
before removing its bundle. External edits block their own replacement/removal
and stay visible in Sync. Sync can restore the AKMS session launch; it cannot
import an arbitrary external session launch as a connection. Retained external
individual settings can be imported into the catalog before removing that entry.

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

The ordered `single_package` migration recognizes 0.3.x and earlier per-kind direct paths, npx launches and old binaries. The Runtime screen installs missing prerequisites before exposing the migration action. Migration changes ready kinds only, preserves each kind's chosen layout and leaves registry version 2 unchanged. Reconciliation updates managed client entries; externally edited entries remain for Sync review. A missing runtime leaves the old launch in place and the migration available to retry.

Runtime offers old-package removal only after catalog and inspected client references no longer use it. References are checked again before removal, and confirmation defaults to No. Running AI clients must reconnect to load replaced code.
