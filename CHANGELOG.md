# Changelog

All notable changes to `@akms/mcp`.

## [Unreleased]

### Changed

- Prepare 0.4.0 as one `@akms/mcp` package containing setup and the Database, SSH, WSL and S3 servers. The only command is `akms-mcp`; server entries use `lib/db.js`, `lib/ssh.js`, `lib/wsl.js` and `lib/s3.js`.
- Add a reviewed Migrate registry step that moves old direct paths and standard npx entries to `@akms/mcp`. Entries using an old kind-specific command are updated from Server layout. Preserve launches waiting for the unified runtime; keep registry version 2 and existing layout choices.
- Combine installation, updates and migration in Runtime, with per-kind choices under Server layout. Show migration only when it can apply and display old/new package versions. Offer removal of unused legacy packages after checking client references; removal defaults to No.
- Each kind's screen lists only its connections; Register, Sync and Runtime are in the main menu, which marks Runtime when an update or registry migration is available.
- Consolidate user installation, security and upgrade guidance in README, with kind-specific configuration and tool guides under `docs/`.
- Plan deprecation of the separate `@akms/mcp-db`, `@akms/mcp-ssh`, `@akms/mcp-wsl` and `@akms/mcp-s3` packages after 0.4.0 is published. Existing legacy entries remain migration sources.

Earlier kind-specific release histories: [Database](docs/db/CHANGELOG.md), [SSH](docs/ssh/CHANGELOG.md), [WSL](docs/wsl/CHANGELOG.md), [S3](docs/s3/CHANGELOG.md).

## [0.3.2] - 2026-10-26

### Changed

- Point Sync review instructions to its current menu and name the services retaining old connection entries, grouping only identical retained lists.
- Separate runtime waits from failed changes in Register and Sync. Group retained connection names, count saved connections separately from service entries, and show semantic colors only on interactive terminals without NO_COLOR.
- Offer unimported connections directly from Sync and compare both saved and external settings before resolving an individual entry during session migration. Wide terminals show versions side by side; narrow terminals keep wrapped values.
- Preserve existing terminal symbols and keep status words visible when colors are disabled.
- Document the upgrade path from 0.2.x, including pending runtimes, differing imported settings, reconnecting clients, rollback and registry migration.

## [0.3.1] - 2026-10-26

### Verification

- Stabilize Windows test cleanup: temporary test directories are removed with one bounded asynchronous retry budget for transient file locks, while persistent errors still fail. Tests only; the published package changes only its version.
- 0.3.0 was committed but never published to npm; 0.3.1 is the first published 0.3 release.

## [0.3.0] - 2026-10-26

- Detect older registry formats in standalone config and the helper menu. Add reviewed, ordered migrations with default-No approval, script APIs, complete pre-migration backup, rollback preservation and post-apply startup checks. Runtime can change the default for future kinds without changing existing modes.

- Start new registries in version 2 session mode. Register/Add/Import create per-kind bundles automatically; missing runtimes keep imported legacy entries until installation and Sync. Existing v1 migration and v2 per-kind rollback choices are preserved.

- Add session servers (default for new catalogs, opt-in migration for existing version 1 catalogs): one direct-Node `akms_<kind>` entry per client session, connection-prefixed tools, registry version 2, reviewed migration and rollback, and startup tool coverage checks.
- Preserve one atomic `registry.previous.json` revision per catalog-changing operation; keep externally edited client entries for Sync and retain old entries until replacements are verified.
- Validate connection-name budgets; document credential location and recovery in session mode. Show runtime paths in startup failures, accept string protocol versions, and explain file-lock update failures.

- Open installed runtime setup directly without npm; offer missing-runtime installation and an explicit default-No npm setup fallback after installation failure. Connect the shared Updates screen in the main menu.
- Block publication on dirty Git trees, reused release versions, mismatched server versions, registration drift, or WSL dependencies missing AKMS registry protection; document the SSH-first package order.

- Check MCP startup after saves, runtime conversion and Updates; add an on-demand Updates screen and default registration removal to No.

- Document plaintext catalog credentials, platform permissions, transfer-guard limits and recovery; show one privacy notice during Register review and a catalog notice in --help.
- Keep custom-command edits and host-key saves independent of the managed runtime; continue with a still-usable installed runtime after an update failure.

- Install managed server runtimes under `<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`, independent of Node versions. Convert existing npx and global paths through Runtime; preserve development links.
- Offer older-runtime updates before Add/Edit and check installation before host-key saves. Include the last npm error lines without ANSI controls, and recognize Unix npm JavaScript paths while skipping version-manager shims.

- Add Runtime management for dedicated MCP runtime installation, explicit latest updates and reviewed conversion of existing npx entries to direct Node launches. Standalone packages remain independent.

- Clarify Sync choices with numbered AKMS/service versions, highlighted differences, wrapped values, and explicit apply destinations.

- Separate terminal menu, comparison and result screens; wait for acknowledgement before returning, while keeping piped commands unchanged.

- Keep all configuration menus visible; Add requires at least one registered AI service.
- Summarize registration/sync results, show only differing fields during review, and distinguish pending imports from shared settings conflicts.

- Replace the temporary Client selector with persistent Register and Sync screens shared by the standalone MCP packages. Registration works locally without launching or installing a child package.
- Keep this package optional: each child implements its own registration, catalog management and all-service writes.

## 0.2.1 — 2026-10-19

### Documentation

- Document the launcher's minimum setup and the required connection values and prerequisites for each MCP server.

## 0.2.0 — 2026-10-19

### Changed

- Align the package and CLI version with the 0.2.0 MCP release family. Database, SSH, WSL and S3 routing continues to resolve each package's published `latest` version.
- Check the built CLI version against the package manifest in tests.

## 0.1.1 — Unreleased

### Added

- S3 setup in the main menu and direct `akms-mcp s3 --target <client>` routing to `@akms/mcp-s3`.
- S3 command routing and built CLI integration tests; updated help and setup documentation.

## 0.1.0 — Unreleased

### Added

- One terminal menu for database, SSH and WSL connection setup, using the selection and rendering behavior of the existing MCP packages.
- Client selection for Claude Code, Codex, Claude Desktop and Cursor, plus direct commands such as `akms-mcp db --target codex`.
- A fresh npm `latest` lookup before every launch. The selected version runs through npm without making the MCP packages runtime dependencies of the launcher.
- Every child opens through its `config` command. Exiting the child returns to the launcher menu.
- `.npmignore` controls the published package contents, excluding source, tests and development files.
