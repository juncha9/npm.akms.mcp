# Development

For installation and usage, see [README.md](./README.md).

```sh
npm ci
npm test
npm run build
npm start
npm pack --dry-run
```

`npm run dev` runs the TypeScript entry without a build. The published package contains the bundled CLI, package manifest, README, changelog and MIT license. `prepack` rebuilds before packaging or publishing. The package has no runtime dependencies.

## Package files

`.npmignore` owns the package exclusions; `package.json` intentionally has no `files` allowlist. It excludes source, tests, build configuration, development documents, temporary files and existing tarballs. Inspect `npm pack --dry-run --json` after changing the project layout.

`CHANGELOG.md` records release changes. Update its release status and keep the versions in `package.json` and `package-lock.json` synchronized when releasing. The build takes the CLI version from `package.json`.

The launcher exposes only a CLI through `bin`; it has no library entry, so the sibling servers' `main`, `module`, `types` and `exports` fields do not apply. Public publishing is configured by `publishConfig.access` in `package.json`.

## Boundaries

- `src/_defs/index.ts` maps the supported packages to their binaries. Every child is opened with `config`, which all three packages support.
- `src/modules/launcher/menu.ts` selects a package and optional client. It releases input listeners and raw mode before handing the terminal to the child, then resumes when setup ends.
- `src/modules/launcher/prompter.ts` adapts the selection/rendering code shared by the existing SSH and WSL projects. Text and secret editors remain in those projects. This copy adds listener cleanup and piped-input handoff because the launcher repeatedly yields stdin to another process.
- `src/modules/launcher/npm.ts` locates npm's CLI script and invokes it through Node, with an argument array and no shell command interpolation. npm performs registry authentication, scoped registry selection and package installation using the user's npm configuration.

## Latest-version contract

For **each** selection, run `npm view <package>@latest version --json` with a fresh temporary metadata cache and online lookup flags. An empty cache prevents a failed registry request from falling back to stale tag metadata. Delete this temporary cache afterwards. On failure, do not launch anything.

Run `npm exec --yes --package=<package>@<resolved-version> -- <binary> config` using npm's normal execution cache. Pinning only for this invocation runs the exact version just checked while reusing downloaded package bytes. No version is persisted in the launcher. `latest` means npm's publisher-controlled dist-tag, not the highest semver or a prerelease tag.

The launcher does not rewrite the MCP entries saved by child setup screens. Their later server-start behavior belongs to the corresponding MCP package.

## Verification

- Selection tests exercise arrow keys, Esc, Ctrl+C, narrow-terminal rendering, input listener cleanup, piped answers and returning from child setup.
- The registry test starts a short-lived local fixture registry and invokes real npm. It moves `latest` despite a long cache lifetime, then returns HTTP 503 to check that no stale version is accepted.
- CLI integration tests run the built executable with a fixture npm script. They verify setup commands, client forwarding, stdin and exit statuses without modifying real client settings.

Before release, run tests, build, and inspect `npm pack --dry-run`. Publish with `npm publish --access public` when releasing this version.
