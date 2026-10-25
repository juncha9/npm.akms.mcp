# Development

## Release guard and package order

Run `npm run prepublishOnly` to inspect every publish prerequisite without publishing. `npm publish` runs the same `node scripts/release-guard.mjs` gate. It requires a clean `git status --porcelain`, a package version newer than the configured registry's `latest`, matching `SERVER_VERSION` (servers only), and five registration copies matching the DB baseline. Metadata uses a fresh temporary cache. Any lookup failure, including E404, or a missing `latest` tag blocks release. All five sibling checkouts are needed for release comparison; normal builds and installed packages do not need them.

The DB registration directory is the baseline. Run `node scripts/sync-registration.mjs` from the DB checkout after common changes. The launcher keeps its own adapters and its `prompter.ts` import is adjusted for `launcher/prompter`. Keep the five development-only `scripts/release-guard.mjs` copies identical.

Release in this order:

1. Publish `@akms/mcp-ssh` with AKMS registry protection first, after its tests, build, package inspection, reviewed commit and release gate pass.
2. Raise `@akms/mcp-wsl`'s SSH dependency minimum to that published protected release, remove ranges permitting SSH 0.1.9, and refresh its lockfile and local dependency. WSL's release gate calls the installed SSH guard against `.akms/mcp` reads and writes; the current SSH 0.1.9 must fail, regardless of the WSL version.
3. Validate and publish WSL, then the DB and S3 servers. Align each manifest, lockfile and `SERVER_VERSION`, synchronize registration, and commit reviewed release changes before running the gate.
4. Publish the optional `@akms/mcp` launcher last, once every child can be installed from npm.

The guard never commits, installs dependencies or publishes. `npm pack --dry-run` inspects contents without invoking this publish-only gate.

For installation and usage, see [README.md](./README.md).

```sh
npm ci
npm test
npm run build
npm start
npm pack --dry-run
```

`npm run dev` runs the TypeScript entry without a build. The published package contains the bundled CLI, package manifest, README, changelog and MIT license. `prepack` rebuilds before packaging or publishing. The registration adapters use `smol-toml` to validate Codex configuration.

## Package files

`.npmignore` owns the package exclusions; `package.json` intentionally has no `files` allowlist. It excludes source, tests, build configuration, development documents, temporary files and existing tarballs. Inspect `npm pack --dry-run --json` after changing the project layout.

`CHANGELOG.md` records release changes. Update its release status and keep the versions in `package.json` and `package-lock.json` synchronized when releasing. The build takes the CLI version from `package.json`.

The launcher exposes only a CLI through `bin`; it has no library entry, so the sibling servers' `main`, `module`, `types` and `exports` fields do not apply. Public publishing is configured by `publishConfig.access` in `package.json`.

## Boundaries

- `src/_defs/index.ts` maps the supported packages to their binaries. Every child is opened with `config`, which all four packages support. The S3 package must be published before the launcher's S3 route can resolve it from npm.
- `src/modules/launcher/menu.ts` selects a package and exposes shared Register/Sync/Runtime/Updates screens. It releases input listeners and raw mode before handing the terminal to the child, then resumes when setup ends.
- `src/modules/launcher/prompter.ts` adapts the selection/rendering code shared by the existing SSH and WSL projects. Text and secret editors remain in those projects. This copy adds listener cleanup and piped-input handoff because the launcher repeatedly yields stdin to another process.
- `src/modules/launcher/npm.ts` uses the registration copy's `findGlobalRuntime` and `installGlobalRuntime`. Installed setup runs as Node plus the runtime CLI path, with no npm discovery or version lookup. npm performs registry authentication, scoped registry selection and installation only when installation or fallback is approved.

## Runtime and fallback contract

Open the installed runtime's `config [--target <client>]` directly. Do not query npm on this path. Missing runtimes require an installation confirmation (default Yes), followed by rediscovery before execution. An installation failure displays its reason and offers npm setup (default No). Close the confirmation's input listeners and raw mode before launching any child, preserving read-ahead answers for that child.

Only after explicit fallback approval, run `npm view <package>@latest version --json` with a fresh temporary metadata cache and online flags. Delete the cache afterwards and stop on lookup failure. Then run `npm exec --yes --package=<package>@<resolved-version> -- <binary> config` using npm's normal execution cache. `latest` means npm's publisher-controlled dist-tag. No fallback happens automatically, and no version is persisted in the launcher.

The launcher does not rewrite the MCP entries saved by child setup screens. Their later server-start behavior belongs to the corresponding MCP package.

## Verification

- Selection tests exercise arrow keys, Esc, Ctrl+C, narrow-terminal rendering, input listener cleanup, piped answers and returning from child setup.
- The registry test starts a short-lived local fixture registry and invokes real npm. It moves `latest` despite a long cache lifetime, then returns HTTP 503 to check that no stale version is accepted.
- CLI integration tests use temporary installed runtimes and a fixture npm script. They verify that installed setup makes zero npm calls, installation uses its resulting runtime, fallback requires approval, and input/client/exit-status forwarding survives both confirmations. Real client settings and global installations are untouched. `AKMS_TEST_BUILT_CLI` can point these process tests at an isolated build.

Before release, run tests, build, and inspect `npm pack --dry-run`. Publish with `npm publish --access public` when releasing this version.

## Registration code

The local `src/modules/registration` copy is bundled into this package. It needs no launcher or sibling checkout at build or runtime. The sibling DB checkout maintains the shared files; its `node scripts/sync-registration.mjs` command updates development copies. Keep schema version 1 compatible across releases and test standalone registration before publishing.

## Child runtime development

Each MCP runtime is installed under `<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`, independent of Node versions. To use a built child checkout, run `npm install -g --prefix "<AKMS runtime directory>" "<child checkout path>"`. Runtime detects the link and hides Update. Build children before linking and reconnect AI clients after rebuilding. The helper itself remains optional; see each child's README_DEV for platform-specific commands.

## Session-server compatibility

Setup reads registry versions 1 and 2. New catalogs start at version 2 with `defaultMode: "catalog"`; their first connection of each kind creates its session launch. Existing version 1 catalogs require the confirmed Runtime switch. Existing version 2 catalogs without `defaultMode` retain individual mode for kinds without explicit session state. Per-kind choices override the default, and rollback keeps version 2 so older setup cannot recreate individual entries. Server `--catalog` readers accept both versions without locks or writes. The common `catalog.ts` has no dependency on setup or the optional helper. Include it in the five-copy release comparison. `registration-session.test.ts` covers migration/rollback, backup failure, name budgets, external edits, replacement ordering and bundle startup coverage.

During active MCP development, build a disposable source copy and validate it before replacing live `lib` files. The normal build removes `lib`; running it beneath a connected MCP can break active sessions.

Registry migrations are ordered in `registry.ts`: `v1_to_v2`, then `catalog_default`. `needsMigration`, `planMigration`, and `applyMigration` support scripted review/application; the plan is rechecked under the normal lock. Session planning and state transitions are shared with `planSession`/`applySession`, while one outer mutation preserves the pre-migration backup. `setDefaultMode("individual")` and `setDefaultMode("catalog")` change only the future-kind default after migration. An explicit individual marker remains current format. `registration-migration.test.ts` covers migration, no-op repetition, backup, stale plans, external edits, missing runtimes, rollback preservation and menu approval. Include `migration-menu.ts` in common-file synchronization.
