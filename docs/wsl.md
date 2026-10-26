# WSL

Commands and file operations in an installed Linux distribution on Windows, under a registered Linux user. Included in the single `@akms/mcp` package.

## Set up

Follow [Install and set up](../README.md#install-and-set-up), then open WSL from the main menu or run:

```sh
npx -y @akms/mcp@latest wsl
```

Use the main `akms-mcp` menu for Register and Sync, with import inside Sync. Runtime contains installation, migration and AI service entries (grouped or one per connection). This kind's screen manages its saved connections. See the shared [upgrade guide](../README.md#upgrading-from-03x-to-040), [AI service entries](../README.md#ai-service-entries) and [catalog security](../README.md#catalog-security-and-recovery).

In 0.3.x and earlier this server was distributed as `@akms/mcp-wsl` with an `akms-mcp-wsl` command. Version 0.4.0 uses `@akms/mcp` and the single `akms-mcp` command.

## Managed server entry

The default layout uses one `akms_wsl` entry per AI client session. Setup writes a direct Node launch like this:

```json
{
  "mcpServers": {
    "akms_wsl": {
      "command": "node",
      "args": [
        "C:/path/to/node_modules/@akms/mcp/lib/wsl.js",
        "--catalog"
      ]
    }
  }
}
```

Replace the example path with the installed script shown by your runtime; [runtime locations](../README.md#runtime-and-updates) differ between Windows and macOS/Linux. Setup writes the absolute Node executable and package path for you. The server reads connections from the catalog at startup. Call `wsl_catalog_status` to check loaded and skipped connections. Tool names include the connection name, such as `linux_dev__wsl_exec`. The tables below use the base tool names.

## Minimum working configuration

The environment-based examples below describe **one entry per connection**. They omit `--catalog`; in the default layout, enter the same values through setup instead. Install the runtime before using a manual entry, and replace paths and credentials with your own.

Run the MCP client on Windows with Node.js 22+ and npm available. Install the target WSL distro first; it must have `bash`. Use the exact distro name from `wsl -l -q` in this entry, replacing `Ubuntu` if necessary:

```json
{
    "mcpServers": {
        "wsl_ubuntu": {
            "command": "node",
            "args": ["C:/path/to/node_modules/@akms/mcp/lib/wsl.js"],
            "env": {
                "WSL_DISTRO": "Ubuntu"
            }
        }
    }
}
```

`WSL_DISTRO` is the only required variable. Commands use that distro's default Linux user; add `WSL_USER` only to select another existing user. No SSH credentials are needed. The first tool call starts a stopped distro. Writes inside Linux are allowed by default; add `"WSL_READONLY": "true"` for a read-only entry. Windows interop and writes under `/mnt/<drive>/` remain disabled unless explicitly allowed.

The JSON example fits an MCP client's `mcpServers` configuration, such as a project `.mcp.json` or Cursor's `mcp.json`. For Codex TOML or other client formats, use the shared Register screen.

## Distro configuration

| `WSL_*` variable | Description |
|---|---|
| `WSL_DISTRO` ✅ | Distro name as `wsl -l -q` prints it. Required by name — following `wsl --set-default` would let a machine-wide setting silently redirect every command |
| `WSL_USER` | Linux user (`wsl -u`). The distro's default user when unset |
| `WSL_NAME` | Alias shown to the agent; defaults to the distro name |
| `WSL_DESCRIPTION` | Shown to the agent — say what the distro is for |
| `WSL_CWD` | Directory new sessions start in |

### Policy

| `WSL_*` variable | Default | Effect |
|---|---|---|
| `WSL_READONLY` | `false` | Rejects write commands, output redirection, package installs, uploads and writes |
| `WSL_ALLOW_SUDO` | `true` | When false, rejects `sudo` / `su` / `doas` / `pkexec` / `runuser` / `chroot` |
| `WSL_ALLOW_WINDOWS` | **`false`** | When false, rejects Windows interop executables (`powershell.exe`, `cmd.exe`, any `.exe`) and **writes** whose target is under `/mnt/<drive>/`. Reads and copies *out of* `/mnt` are always allowed |
| `WSL_ALLOW_COMMANDS` | *(none)* | When set, only these binaries may run (`pwd` is added automatically so sessions can open) |
| `WSL_DENY_PATTERNS` | *(none)* | Extra regex sources, compiled at startup and tested per command segment |
| `WSL_ALLOWED_PATHS` | *(none)* | When set, the file tools accept only absolute paths inside these prefixes |
| `WSL_EXEC_TIMEOUT_MS` | `60000` | Per-command wall clock; `wsl.exe` is killed when it elapses |
| `WSL_MAX_OUTPUT` | `100000` | stdout and stderr are each truncated past this |
| `WSL_MAX_READ_BYTES` | `200000` | `wsl_read_file` ceiling |

Like SSH, it is **permissive by default**, restriction opt-in, and a malformed value fails startup (`WSL_READONLY=ture` is an error, not "not read-only"). The one default that differs is `WSL_ALLOW_WINDOWS`, and the reason is in the security notes below.

### Check it before wiring it up

`--check` reads the current process's `WSL_*` environment, not the MCP client's saved entries. Set the variables in the same PowerShell session, using an installed distro and Linux user:

```powershell
$env:WSL_DISTRO = "Ubuntu"
$env:WSL_USER = "root"        # optional; omit to use the distro's default user
node "C:/path/to/node_modules/@akms/mcp/lib/wsl.js" --check
```

```
Checking Ubuntu  →  root@Ubuntu

  OK      uid=0(root) gid=0(root) groups=0(root)  (115ms)
          distro: Running  ·  WSL 2  ·  networking mirrored  ·  systemd  ·  kernel 5.15.146.1-microsoft-standard-WSL2
```

To check a saved entry, open `config`, select the entry, then **Check the distro**. Both checks run `id` as the configured user and can start a stopped distro. If `WSL_ALLOW_COMMANDS` is set, include `id` for the check to pass. `--check` exits with code `0` on success and `1` on failure.

## Tools

| Tool | Purpose |
|---|---|
| `wsl_list_hosts` | The configured distro and user, the guard policy, and the distro's state: running/stopped, WSL version, networking mode, whether systemd is PID 1 |
| `wsl_connect` | Open a session (a remembered working directory), returns a session id |
| `wsl_disconnect` | Forget a session |
| `wsl_list_sessions` | Open sessions with cwd, command count and idle time |
| `wsl_exec` | Run a command in a login bash; returns stdout, stderr, exit code, duration |
| `wsl_list_dir` | Directory listing (type, mode, size, mtime) |
| `wsl_read_file` | Read a text file, truncated to the byte ceiling |
| `wsl_write_file` | Write or append UTF-8 text |
| `wsl_upload` | Local → distro file transfer |
| `wsl_download` | Distro → local file transfer |

### Every call is its own process

There is no connection to keep. Each tool call spawns `wsl.exe -d <distro> -u <user> --exec bash -lc <script>` and waits for it — about 100 ms of overhead, no handshake. A **session** therefore carries exactly one thing between calls: the working directory, so `cd /opt/app` in one `wsl_exec` still applies to the next. Environment variables, background jobs and `sudo` timestamps do not carry over, because the process that held them has exited.

`--exec`, never `--`: with `--`, `wsl.exe` hands the command to the distro's default shell for a *second* parse, which strips backslashes and expands `$HOME` before bash ever sees the script — the text the guard screened would not be the text that runs.

### Commands run without a terminal

stdin is closed, so anything that waits for input fails fast instead of hanging until the timeout: `sudo` without `NOPASSWD` fails with `a password is required`, prompts need their non-interactive flag (`apt-get -y`), full-screen tools have no TTY (`top -bn1`, `wsl_write_file` instead of an editor).

**A background job must detach all three descriptors**, or `wsl.exe` waits on the open pipe until the timeout kills it:

```bash
nohup ./build.sh > /tmp/build.log 2>&1 < /dev/null &
```

When the timeout fires, `wsl.exe` is killed; the process inside the distro may survive. The reply says so.

### File tools go through the distro process

`wsl_read_file` is `head -c`, `wsl_write_file` is `cat >`, transfers are `cat` over stdin/stdout — byte-clean pipes, so binaries round-trip intact. This is deliberate: the `\\wsl$\` share opens every file as the distro's *default* user, so a `root` entry could not have written `/etc/nginx/…` through it. Through the process, the registered user's permissions are the permissions.

These scripts have no variable part but the quoted path, so they bypass the command guard the way SFTP does in the bundled SSH implementation; the **path** guard (`WSL_ALLOWED_PATHS`, read-only, the `/mnt` rules) governs them instead. `WSL_ALLOW_COMMANDS` need not list `cat` or `find`.

## Guard policy

The command guard is shared with the SSH server — catastrophe rules always on (`rm -rf /`, `mkfs`, `dd of=/dev/sda`, `shutdown`, fork bombs…), the rest opt-in. Its threat model is a **mistaken agent, not an adversary**, and so is this server's. On top:

| Layer | Scope | Examples |
|---|---|---|
| **WSL catastrophe** | Always | `wsl --shutdown` / `--terminate` / `--unregister`, `wslconfig /t`, `poweroff`, `systemctl poweroff`, `init 0` |
| `WSL_ALLOW_WINDOWS=false` | Default | any segment whose binary is a Windows executable (`powershell.exe`, `cmd.exe`, `explorer.exe`, `*.exe`); any write-shaped segment whose **target** is under `/mnt/<drive>/` — a redirection, `cp`'s last operand, `tar -c`'s archive, `rm`/`sed -i`/`mv` operands |
| **Operator paths** | Always, even when Windows is open | `/mnt/c/Users/<you>/.ssh`, `.aws`, `.gnupg`, `*.pem`, `.claude.json`, `.mcp.json`, `claude_desktop_config.json` — the same list the bundled SSH implementation protects on the local side, reached through the mount |

Both `wsl_exec` and the file tools enforce these; the rules live in the layer every command and path passes through, so a new tool cannot forget them. A rejection returns the rule that fired, the offending segment, and the note that nothing was run.

## Security notes

**In WSL, the "remote" is your own machine.** the bundled SSH implementation can say "the remote account is the real boundary" because a compromised remote account stays remote. Here the distro shares the Windows filesystem under `/mnt` and can launch Windows programs through interop — and among the files it can reach that way is the MCP client configuration that defines this server's own `WSL_*` policy. An agent that writes `~/.claude.json` rewrites its guards for the next run. That is why `WSL_ALLOW_WINDOWS` is the one restriction on by default, and why the operator's credential and configuration paths stay refused even when it is turned on.

- Prefer a dedicated Linux user per entry over `root`, with `sudoers` scoped to what it needs — the guard is a seatbelt, the account is the containment.
- The catastrophe rules read the command as text. A shell can express the same operation in unlimited ways; the guard stops mistakes, not intent.
- Output from the distro is untrusted input: a file the agent reads can contain instructions.
- Local paths in `wsl_upload` / `wsl_download` are resolved on Windows, so a POSIX-looking `/tmp/x` becomes `<current drive>\tmp\x`. Every transfer reply prints the resolved path — check it.

## Memory and process lifetime

The server reuses command and path guards from the bundled SSH implementation ^0.3.1 without loading its SSH/crypto runtime. A WSL command still runs through `wsl.exe`; no SSH connection or parser worker is involved.

Command output is bounded, and upload/download bodies stream through pipes. Sessions retain working-directory state, not a persistent shell or command history; unused sessions expire after 15 minutes, with active operations skipped by the sweeper. These limits do not force Node's RSS back to its startup value after use.

The Node MCP process and WSL virtual machine have separate memory costs. Legacy 0.3.x npm/npx launches also add wrapper processes until migrated. Session expiry only removes MCP state: this server does not shut down a distro, stop its background jobs, or force Linux cache reclamation to recover memory. Updating this package takes effect when the MCP process is restarted.

## Logging

Everything goes to **stderr**. `WSL_MCP_LOG_LEVEL` picks the level — `silent` / `debug` / `info` / `warn` / `error`, default `info`. Guard rejections are logged at `warn` with the full command; full command text is otherwise only logged at `debug`.

## Development

Use the [contributor guide](../README_DEV.md) for current build and test commands, and [WSL implementation notes](wsl/README_DEV.md) for detailed background. Earlier releases are recorded in the [kind's changelog](wsl/CHANGELOG.md).

## License

MIT — see [LICENSE.md](../LICENSE.md).
