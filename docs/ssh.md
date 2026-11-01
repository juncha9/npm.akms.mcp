# SSH

Remote commands, working-directory sessions and SFTP file transfers through a registered SSH connection. Included in the single `@akms/mcp` package.

## Set up

Follow [Install and set up](../README.md#install-and-set-up), then open SSH from the main menu or run:

```sh
npx -y @akms/mcp@latest ssh
```

Use the main `akms-mcp` menu for Register and Sync, with import inside Sync. Runtime contains installation, updates and migration. Connections are grouped into one `akms_<kind>` entry in each AI service. This kind's screen manages its saved connections. See the shared [upgrade guide](../README.md#upgrading-from-03x-to-040), [how connections appear](../README.md#how-connections-appear-in-ai-services) and [catalog security](../README.md#catalog-security-and-recovery).

In 0.3.x and earlier this server was distributed as `@akms/mcp-ssh` with an `akms-mcp-ssh` command. Version 0.4.0 uses `@akms/mcp` and the single `akms-mcp` command.

## Add from the command line

With 0.5.0 or later, after registering an AI service and installing the runtime, add a new host without the setup menu:

```sh
akms-mcp add ssh example_host --host host.example.com --user deploy --password --readonly
```

`--password` reads a hidden terminal prompt, or one line on stdin; never put its value in an argument. Other secret flags work the same way, in option order. Writes are allowed unless `--readonly` is given. Run `akms-mcp add ssh --help` for the allowed options. Use the setup menu for proxy commands (`SSH_PROXY_COMMAND`) and separate jump-host credentials beyond the listed options. Advanced policy settings are not exposed by `add`.

The command accepts new names only and prints one JSON result. A saved connection can still report a failed startup check; read `saved`, `ok` and the exit code before reconnecting your AI client.

## Managed server entry

Setup uses one grouped `akms_ssh` entry per AI client session. Setup writes a direct Node launch like this:

```json
{
  "mcpServers": {
    "akms_ssh": {
      "command": "node",
      "args": [
        "/path/to/node_modules/@akms/mcp/lib/ssh.js",
        "--catalog"
      ]
    }
  }
}
```

Replace the example path with the installed script shown by your runtime; [runtime locations](../README.md#runtime-and-updates) differ between Windows and macOS/Linux. Setup writes the absolute Node executable and package path for you. The server reads connections from the catalog at startup. Call `ssh_catalog_status` to check loaded and skipped connections. Tool names include the connection name, such as `remote_main__ssh_exec`. The tables below use the base tool names.

## Minimum working configuration

These examples show direct, single-connection startup from environment variables without `--catalog`. Setup always groups connections: enter the same values in setup, or use Register/Import to bring existing manual entries into the catalog and replace them with the grouped `akms_ssh` entry. Install the runtime before using a manual entry, and replace paths and credentials with your own.

For a direct SSH connection using a private key, use this MCP client entry. Replace the host, user and key path with your own. The SSH server must be reachable on port `22`, and the matching public key must already be authorized for that user.

```json
{
    "mcpServers": {
        "ssh": {
            "command": "node",
            "args": ["/path/to/node_modules/@akms/mcp/lib/ssh.js"],
            "env": {
                "SSH_HOST": "ssh.example.com",
                "SSH_USER": "deploy",
                "SSH_KEY": "~/.ssh/id_ed25519"
            }
        }
    }
}
```

`SSH_HOST` and `SSH_USER` are required. The example also supplies authentication explicitly: `SSH_KEY` must point to an existing private key file; add `SSH_PASSPHRASE` if it is encrypted. For password authentication, replace `SSH_KEY` with `SSH_PASSWORD`. Omit both only when the MCP process can access an SSH agent with an authorized key (`SSH_AUTH_SOCK`, or the OpenSSH agent on Windows). No default key file or `~/.ssh/config` is loaded automatically.

`SSH_PORT` defaults to `22`; jump-host and proxy settings are optional. Writes are allowed by default; add `"SSH_READONLY": "true"` for a read-only entry.

The JSON example fits an MCP client's `mcpServers` configuration, such as a project `.mcp.json` or Cursor's `mcp.json`. The direct Node command also works on Windows. For Codex TOML or other client formats, use the shared Register screen.

## Host configuration

Every setting is an environment variable in this server's own entry. There is no config file and no JSON — which is also why "what is this server allowed to do" is answerable by reading the entry above, with no second place to check.

### Connection

| `SSH_*` variable | Description |
|---|---|
| `SSH_HOST` ✅ | Hostname or IP |
| `SSH_USER` ✅ | Login user |
| `SSH_PORT` | Default `22` |
| `SSH_KEY` | **Path** to a private key file, `~` expanded |
| `SSH_PASSPHRASE` | Key passphrase |
| `SSH_PASSWORD` | Password auth, when no key is used |
| `SSH_HOST_KEY` | Pin the server's host key, `SHA256:…`; a mismatch aborts the connection |
| `SSH_NAME` | Alias shown to the agent; defaults to the hostname |
| `SSH_DESCRIPTION` | Shown to the agent — say what the host is for |
| `SSH_CWD` | Directory new sessions start in |
| `SSH_PROXY_COMMAND` | Command whose stdin/stdout carry the SSH stream — OpenSSH's `ProxyCommand`. `%h` / `%p` / `%r` expand to the first hop's host, port and user, `%%` to a literal `%` |
| `SSH_JUMP_HOST` | Jump host the target is reached through — OpenSSH's `ProxyJump` / `-J` |
| `SSH_JUMP_PORT` | Default `22` |
| `SSH_JUMP_USER` | Defaults to `SSH_USER` |
| `SSH_JUMP_KEY` | **Path** to the jump host's private key; defaults to `SSH_KEY` (and then shares `SSH_PASSPHRASE`) |
| `SSH_JUMP_PASSPHRASE` | Passphrase for `SSH_JUMP_KEY` |
| `SSH_JUMP_PASSWORD` | Password auth on the jump host |
| `SSH_JUMP_HOST_KEY` | Pin the jump host's key, `SHA256:…` |

Authentication is tried in this order: **private key by path** (with `SSH_PASSPHRASE` if encrypted), **password**, then the **SSH agent** when neither is set (`SSH_AUTH_SOCK`, or the OpenSSH named pipe on Windows). A key path that doesn't exist is reported at startup, not at first connection.

### Through a jump host or a proxy command

`~/.ssh/config` is **not** read — the server never shells out to `ssh` — so a `ProxyJump` or `ProxyCommand` that works on the command line has to be stated in the entry. Both OpenSSH shapes are available, and they compose:

```json
{
    "mcpServers": {
        "ssh-dev": {
            "command": "node", "args": ["/path/to/node_modules/@akms/mcp/lib/ssh.js"],
            "env": {
                "SSH_HOST": "10.0.16.12", "SSH_USER": "ubuntu", "SSH_KEY": "~/.ssh/id_ed25519",
                "SSH_JUMP_HOST": "dev-ak-ssh.example.com",
                "SSH_PROXY_COMMAND": "cloudflared access ssh --hostname %h"
            }
        }
    }
}
```

- **`SSH_JUMP_HOST`** connects to the jump host first and opens a forwarded TCP channel to `SSH_HOST:SSH_PORT`, which the target handshake then runs over — exactly what `ssh -J` does. The jump host authenticates in the same order from `SSH_JUMP_*` — user and key fall back to the target's, the password does not — and its host key can be pinned with `SSH_JUMP_HOST_KEY`. Any `SSH_JUMP_*` set without `SSH_JUMP_HOST` fails startup rather than quietly connecting straight to the target.
- **`SSH_PROXY_COMMAND`** starts the command through the shell and talks SSH over its stdin/stdout, as `ProxyCommand` does — `cloudflared access ssh --hostname %h`, `ssh -W %h:%p bastion`, `nc %h %p`. It carries the **first hop**: the jump host when one is set, otherwise the target. The entry above therefore reads "cloudflared to the jump host, then forward to 10.0.16.12".
- Either alone works too: a jump host reachable directly needs only `SSH_JUMP_HOST`; a host behind a Cloudflare Access tunnel needs only `SSH_PROXY_COMMAND`.

The proxy process lives exactly as long as the connection it carries and is killed with it (the whole process tree on Windows). Its stderr goes to the log at `warn`, which is where a `cloudflared` login prompt or a refused tunnel shows up. Log in once with `cloudflared access login <url>` before wiring the entry up: the server cannot open a browser for you, and `SSH_CONNECT_TIMEOUT_MS` expires first.

`--check` prints the route and both host key fingerprints, so the jump host's key can be pinned the same way:

```
Checking 10.0.16.12  →  ubuntu@10.0.16.12:22
  via proxy command: cloudflared access ssh --hostname %h
  via jump host: ubuntu@dev-ak-ssh.example.com:22

  OK      ubuntu@10.0.16.12:22  (key /home/user/.ssh/id_ed25519, 1840ms)
          host key SHA256:9x2K…  (not pinned — set SSH_HOST_KEY to it to detect a changed key)
          jump host key SHA256:Qm7d…  (not pinned — set SSH_JUMP_HOST_KEY to it to detect a changed key)
```

### Policy

| `SSH_*` variable | Default | Effect |
|---|---|---|
| `SSH_READONLY` | `false` | Rejects write commands, output redirection, package installs, uploads and remote writes |
| `SSH_ALLOW_SUDO` | `true` | When false, rejects `sudo` / `su` / `doas` / `pkexec` / `runuser` / `chroot` |
| `SSH_ALLOW_COMMANDS` | *(none)* | When set, only these binaries may run — the strictest lever available (`pwd` is added automatically so sessions can open) |
| `SSH_DENY_PATTERNS` | *(none)* | Extra regex sources, compiled at startup and tested per command segment |
| `SSH_ALLOWED_PATHS` | *(none)* | When set, the file tools accept only absolute paths inside these prefixes |
| `SSH_EXEC_TIMEOUT_MS` | `60000` | Per-command wall clock; the channel is closed when it elapses |
| `SSH_CONNECT_TIMEOUT_MS` | `20000` | TCP + handshake limit |
| `SSH_MAX_OUTPUT` | `100000` | stdout and stderr are each truncated past this |
| `SSH_MAX_READ_BYTES` | `200000` | `ssh_read_file` ceiling |

**Defaults are permissive on purpose.** An unconfigured host allows ordinary administration — installs, service restarts, sudo, interpreters, deployments — because a guard that blocks real work gets switched off wholesale instead of tuned. Restriction is opt-in.

Lists are comma-separated and booleans also accept `1`/`0`, `yes`/`no`, `on`/`off`. A malformed value fails startup rather than being ignored — `SSH_READONLY=ture` is an error, not "not read-only" — and `SSH_DENY_PATTERNS` is compiled at startup, so a typo'd regex can't be silently absent at the moment it matters. A missing `SSH_HOST` is not fatal: the server starts with nothing registered and the tools say so.

### Several hosts

Add hosts in setup to share one grouped server with connection-prefixed tools. The JSON below illustrates manual environment-based launches, each targeting one host with its own policy. Setup imports these connection settings and replaces the separate entries with `akms_ssh`:

```json
{
    "mcpServers": {
        "ssh-prod": {
            "command": "node", "args": ["/path/to/node_modules/@akms/mcp/lib/ssh.js"],
            "env": { "SSH_HOST": "ssh.example.com", "SSH_USER": "deploy", "SSH_READONLY": "true" }
        },
        "ssh-dev": {
            "command": "node", "args": ["/path/to/node_modules/@akms/mcp/lib/ssh.js"],
            "env": { "SSH_HOST": "dev.example.com", "SSH_USER": "ubuntu" }
        }
    }
}
```

### Check it before wiring it up

```bash
node "/path/to/node_modules/@akms/mcp/lib/ssh.js" --check
```

Connects to the configured host and reports what happened — exit code 0 when it is reachable. Otherwise a setup mistake is indistinguishable from a policy rejection when the agent tries something. Warnings still print during the check (a missing key file, the proxy command's stderr); add `SSH_MCP_LOG_LEVEL=debug` to see the handshake.

```
Checking prod-web  →  deploy@10.0.0.5:22

  OK      deploy@10.0.0.5:22  (key /home/me/.ssh/id_ed25519, 412ms)
          host key SHA256:9x2K…  (not pinned — set SSH_HOST_KEY to it to detect a changed key)
```

That fingerprint is the same string `ssh-keyscan -t ed25519 host | ssh-keygen -lf -` gives — copy it into `SSH_HOST_KEY` to pin it. **An unpinned host accepts whatever key the server presents**: fine on a LAN, worth pinning across the internet, and the thing that tells you a host was rebuilt.

## Tools

| Tool | Purpose |
|---|---|
| `ssh_list_hosts` | The configured host, its route and its guard policy. No credentials |
| `ssh_connect` | Open a reusable session, returns a session id |
| `ssh_disconnect` | Close a session |
| `ssh_list_sessions` | Open sessions with cwd, command count and idle time |
| `ssh_exec` | Run a command; returns stdout, stderr, exit code, duration |
| `ssh_list_dir` | SFTP directory listing (type, mode, size, mtime) |
| `ssh_read_file` | Read a remote text file, truncated to the byte ceiling |
| `ssh_write_file` | Write or append UTF-8 text over SFTP |
| `ssh_upload` | Local → remote file transfer |
| `ssh_download` | Remote → local file transfer |

### One-off vs session

No tool takes a host argument — the host is the one in this server's env block, so the agent can't name a machine. The only choice is whether to reuse a connection:

- **Omit `session`** — a fresh connection is opened and closed around the single call. Simple, but pays a handshake each time and keeps no state. Capped at 32 concurrent.
- **Pass `session`** (an id from `ssh_connect`) — reuses the connection and **remembers the working directory**, so `cd /opt/app` in one `ssh_exec` still applies to the next. Passing `cwd` alongside `session` moves the session there. Capped at 32, reaped after 15 minutes idle but never mid-operation, so a long build or a large transfer is safe. A dropped connection is reported on the next call rather than silently reconnected into a fresh login shell.

A non-zero exit code comes back as ordinary output with stdout and stderr for the agent to read; only a genuine failure (connection refused, guard rejection) is flagged as a tool error.

### Commands run without a terminal

Remote stdin is closed immediately, so anything that waits for input fails fast instead of hanging until the timeout:

- `sudo` on a host without `NOPASSWD` fails with `sudo: a password is required` in milliseconds. Either configure `NOPASSWD` for the commands the agent needs, or use `sudo -n` and expect the failure.
- Confirmation prompts need their non-interactive flag — `apt-get install -y`, `rm -f`, `ssh-keygen -q -N ''`.
- Full-screen tools (`top`, `vi`, `htop`) have no TTY. Use `top -bn1`, `ps aux`, and `ssh_write_file` instead of an editor.

A long job outliving its timeout keeps running remotely; start it with `nohup … &` or `tmux new -d` and poll the log.

## Guard policy

**The threat model is a mistaken agent, not an adversary.** An agent that means well can still type `rm -rf /` with a variable that expanded to nothing, or reboot the host it is currently working through. Those are what the guards stop. One that is *trying* to get around a text-based screen will succeed — a shell can express the same operation in unlimited ways, and chasing that is how a guard ends up blocking `awk` and getting turned off. So the layers are deliberately few:

| Layer | Scope | Examples |
|---|---|---|
| **Catastrophe** | Always, not configurable | `rm -rf /` (and `/etc`, `/home`, `~`, `//*`, `/tmp/x /`), `rm /etc/passwd`, `rm /boot/vmlinuz*`, `mkfs`, `dd of=/dev/sda`, `shutdown`, `reboot`, `chmod -R 777 /`, `find / -delete`, `crontab -r`, `iptables -F`, `--no-preserve-root`, fork bombs |
| `SSH_READONLY` | Opt-in | `rm`/`mv`/`cp`/`mkdir`/`tee`, package installs, editors, `ssh`/`scp`/`wget`, `sed -i`, `sort -o`, `find -delete`, `git push`, `systemctl restart`, `docker run`, `kubectl apply`, `tar -x`, `curl -o`, `> file` redirection |
| `SSH_ALLOW_SUDO=false` | Opt-in | any segment invoking `sudo`, `su`, `doas`, `pkexec`, `runuser`, `chroot` |
| `SSH_ALLOW_COMMANDS` / `SSH_DENY_PATTERNS` | Opt-in | whatever you list |
| Path guards | `SSH_ALLOWED_PATHS` (remote), built-in credential rules (local) | paths outside the allow-list; local credential and config files |
| `cwd` | Always | a working directory containing shell metacharacters |

Everything not in that table runs: installing packages, restarting services, editing configs, `curl … | sh`, deleting an application's own files, `sudo`. `SSH_READONLY` deliberately still allows interpreters (`python3 -c`, `node -e`), `awk`, database clients, `git log`, `docker logs` — a read-only host exists to be **inspected**, and log analysis needs those. A shell payload is screened either way, so `bash -c "rm x"` is caught by the `rm` rule.

Rules are enforced inside `SshConnection.exec` and the SFTP operations — the layer every command and path must pass through — so a new tool cannot forget to call the guard. A rejection returns the rule that fired, the offending segment, and the note that nothing was sent. The screening walkthrough is in [README_DEV.md](ssh/README_DEV.md#how-a-command-is-screened).

`SSH_ALLOWED_PATHS` binds the **file tools only**: `ssh_exec` can still read anything the remote account can, and `ssh_list_hosts` says so. Per-call `timeoutMs` and `maxBytes` are **clamps, not defaults** — they may lower the configured ceiling, never raise it.

### Local path protection

The file tools run with this server's own privileges on your machine, so `localPath` is guarded in both directions — but narrowly, covering **credentials** (`~/.ssh`, `authorized_keys`, private keys, `.pem`/`.key`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `.npmrc`, `.netrc`) and **files that define the guards** (`.claude*` / `.mcp.json` / `claude_desktop_config.json` — where this server's `SSH_*` variables live — plus autostart locations). `.env` uploads, `.bashrc` backups and cron fetches are normal deployment work and are allowed. Symlinks are resolved before matching, so a link into `~/.ssh` does not slip past.

## Memory and process lifetime

SSH and its crypto runtime load on the first connection instead of during idle MCP startup or local configuration work. The same loaded client supports direct, proxy and jump-host routes. Concurrent callers share the connection attempt, and disconnecting during module loading prevents a later transport from opening. The runtime stays loaded after first use; disconnecting a session closes its transport rather than unloading the module.

Setup groups SSH connections in one stdio process per AI client session. Client entries start Node directly from the runtime, and remote connections remain lazy. Manually configured environment-based launches still start one host each; importing them through setup brings their settings into the grouped server. Reconnect clients after changing saved connections.

Restart MCP connections after updating to apply the new code. Compare process counts and Windows Private Bytes separately from resident memory (RSS), including npm wrappers in the total.

## Logging

Everything goes to **stderr** (stdout is the MCP protocol channel). `SSH_MCP_LOG_LEVEL` picks the level — `silent` / `debug` / `info` / `warn` / `error`, default `info`. Guard rejections are logged at `warn` with the full command, and that log is the audit trail for what the agent tried; full command text is otherwise only logged at `debug`, while `password`, `passphrase`, `privateKey` and `token` meta keys are always masked.

## Security notes

**The real boundary is the remote account.** The guards stop mistakes; containment has to come from the host — give each server entry a dedicated unprivileged user rather than `root`, restrict its `sudoers` entries to the exact commands it needs, pair `SSH_READONLY=true` with filesystem permissions that agree with it, reach for `SSH_ALLOW_COMMANDS` on the strictest hosts, and back up anything you would miss.

- Saved connection settings may hold `SSH_PASSWORD` or `SSH_PASSPHRASE` (and their `SSH_JUMP_*` counterparts). Prefer a key file so only its *path* is stored, keep the entry out of version control, and `chmod 600` it — the shipped `.gitignore` already excludes `*.pem`, `id_rsa*` and `id_ed25519*`.
- **Anything the agent can reach, a prompt injection can reach.** Output from a remote host is untrusted input; a file the agent reads can contain instructions. With permissive defaults that matters more, not less — keep a production entry `SSH_READONLY=true` and let write access be a deliberate exception.
- The catastrophe rules are the *only* ones that hold regardless of configuration, and even they read the command as text. Treat them as a seatbelt, not a cage.
- Point this at hosts you are authorized to administer. This is an administration tool, not a scanner.
- Local paths are resolved against the machine running the server, so on Windows a POSIX-looking `/tmp/x` becomes `<current drive>\tmp\x`. Every transfer reply prints the resolved path — check it.

## Development

Use the [contributor guide](../README_DEV.md) for current build and test commands, and [SSH implementation notes](ssh/README_DEV.md) for detailed background. Earlier releases are recorded in the [kind's changelog](ssh/CHANGELOG.md).

## License

MIT — see [LICENSE.md](../LICENSE.md).
