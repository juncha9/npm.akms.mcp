# Development

This repository builds the setup CLI and the Database, SSH, WSL and S3 MCP servers as one `@akms/mcp` package. Start with [README.md](README.md) for installation, runtime layout, migration and catalog security.

## Commands

From the repository root, with Node.js 22+ and npm:

```sh
npm ci
npm run typecheck
npm run build
npm test
```

`npm run dev` runs the setup source with tsx. `npm start` opens the built setup menu. To run one test project or a focused file without the `pretest` rebuild:

```sh
npm exec -- vitest run --project db
npm exec -- vitest run tests/registration/registration-ux.test.ts
```

`npm test` runs `pretest`, which builds first. `npm run test:watch` opens Vitest watch mode; `npm run test:coverage` collects coverage.

## Source and build layout

```text
src/
  cli.ts                       setup entry
  _defs/                       package version and supported kinds
  _types/
  modules/
    launcher/                  arguments, main menu and setup process handoff
    registration/              shared registry, clients, Runtime, Sync and migration
    session-server.ts          connection-prefixed tool routing
    prompt-errors.ts           shared Back/Closed error classes
  kinds/
    db/                        PostgreSQL driver, parser, policies, tools and setup
    ssh/                       SSH/SFTP connections, policies, tools and setup
    wsl/                       Windows process transport, policies, tools and setup
    s3/                        storage clients, policies, tools and setup
tests/
  launcher/  registration/  db/  ssh/  wsl/  s3/  support/
docs/
  db.md  ssh.md  wsl.md  s3.md  user guides
  db/  ssh/  wsl/  s3/         implementation notes and earlier release histories
lib/
  cli.js                       akms-mcp
  db.js  ssh.js  wsl.js  s3.js  server, config and --check entries
```

The only npm `bin` is `akms-mcp`. Server entries are direct Node paths to `lib/<kind>.js`; they are not additional npm commands. The package has no public library exports.

`tsup.config.ts` builds independent ESM entries with splitting disabled. Each kind loads its own code and drivers, so importing another kind's server or SDK at the shared entry would change startup and memory behavior. The build injects `__PACKAGE_VERSION__` from the root package manifest into all entries.

TypeScript aliases are `@/` for shared source and `@db/`, `@ssh/`, `@wsl/`, `@s3/` for kind source. The root typecheck includes source, tests and build/test configuration. Vitest projects keep tests separated by kind; the DB project sets `DB_MCP_LOG_LEVEL=silent`, and the projects use forked workers.

## Shared setup and runtime contracts

- Registration, Sync, import and migration have one shared implementation. Do not restore per-kind copies or add a dependency on a separate setup package.
- Main-menu shared actions stay outside kind-specific connection lists. Saving a connection still performs reconciliation and startup checks through the shared registry adapter.
- `src/modules/registration/runtime.ts` discovers one dedicated `@akms/mcp` installation and its `lib/<kind>.js` entries. Runtime installation and updates operate on this package once for all kinds.
- `src/modules/launcher/npm.ts` opens a kind's installed `config` entry. If installation fails and the user approves, it can open the kind's bundled setup from this package; it does not run a separate `npm exec` setup fallback.
- Preserve the registry version 1 reader and version 2 session format. Runtime shows Migrate registry only when changes can be applied; missing or blocked prerequisites have a status message. The ordered `single_package` migration repoints recognized legacy launches, then reconciliation updates managed client entries. Missing runtimes and external edits must preserve old settings until reviewed.
- Old-package cleanup inspects catalog and client references again before removal. The removal confirmation defaults to No.
- Shared prompt errors come from `src/modules/prompt-errors.ts`. Kind prompters retain their own rendering/editing code but must throw those shared classes so Esc and closed input cross screen boundaries correctly.

Catalog passwords and `registry.previous.json` are plaintext. Fixtures must use temporary catalogs, fake credentials and temporary client settings, never the developer's real configuration. See the [registration design](docs/db/design/registration.md) for the reconciliation and backup invariants.

## Verification and package contents

Use `npm pack --dry-run --json` to inspect the package. Its `prepack` hook rebuilds. The `files` allowlist includes `lib`, the public README, changelog and license; source, tests, development notes and fixtures stay in the repository.

For runtime or migration changes, install a package tarball into a temporary prefix and test both fresh registration and an upgrade from legacy client/catalog copies. Verify the rewritten launch paths, startup tool coverage, retained external edits, old-package cleanup and client restart behavior. Keep actual credentials and user settings outside these tests.

The build cleans its output directory. When a running MCP is linked to a checkout's `lib`, validate in an isolated copy and replace verified artifacts without deleting the live directory. Keep source-map paths relative to the final `lib` location.

The release guard checks package inputs and registry version metadata before publishing.

## Kind-specific notes

- [Database implementation notes](docs/db/README_DEV.md) and [design](docs/db/DESIGN.md)
- [SSH implementation notes](docs/ssh/README_DEV.md)
- [WSL implementation notes](docs/wsl/README_DEV.md)
- [S3 implementation notes](docs/s3/README_DEV.md) and [design](docs/s3/DESIGN.md)

These retained notes include background from the 0.3.x standalone packages. Use this root guide for current source paths, commands, build configuration and package boundaries; historical library and release examples in the kind notes do not define the 0.4.0 package interface.
