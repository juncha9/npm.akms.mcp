# Database

PostgreSQL queries, schema inspection and query plans, directly or through an SSH tunnel. Included in the single `@akms/mcp` package.

## Set up

Follow [Install and set up](../README.md#install-and-set-up), then open Database from the main menu or run:

```sh
npx -y @akms/mcp@latest db
```

Use the main `akms-mcp` menu for Register and Sync, with import inside Sync. Runtime contains installation, updates and migration. Connections are grouped into one `akms_<kind>` entry in each AI service. This kind's screen manages its saved connections. See the shared [upgrade guide](../README.md#upgrading-from-03x-to-040), [how connections appear](../README.md#how-connections-appear-in-ai-services) and [catalog security](../README.md#catalog-security-and-recovery).

In 0.3.x and earlier this server was distributed as `@akms/mcp-db` with an `akms-mcp-db` command. Version 0.4.0 uses `@akms/mcp` and the single `akms-mcp` command.

## Add from the command line

With 0.5.0 or later, after registering an AI service and installing the runtime, add a new database without the setup menu:

```sh
akms-mcp add db example_db --host db.example.com --database app --user app_user --password --readonly
```

`--password` reads a hidden terminal prompt, or one line on stdin; never put its value in an argument. Other secret flags work the same way, in option order. The driver defaults to PostgreSQL. Writes are allowed unless `--readonly` is given; `--no-ddl` separately disables CREATE, ALTER and DROP. Run `akms-mcp add db --help` for the allowed options. Use the setup menu for database URLs (`DB_URL`). Advanced settings such as timeouts and deny patterns are not exposed by `add`.

The command accepts new names only and prints one JSON result. A saved connection can still report a failed startup check; read `saved`, `ok` and the exit code before reconnecting your AI client.

## Managed server entry

Setup uses one grouped `akms_db` entry per AI client session. Setup writes a direct Node launch like this:

```json
{
  "mcpServers": {
    "akms_db": {
      "command": "node",
      "args": [
        "/path/to/node_modules/@akms/mcp/lib/db.js",
        "--catalog"
      ]
    }
  }
}
```

Replace the example path with the installed script shown by your runtime; [runtime locations](../README.md#runtime-and-updates) differ between Windows and macOS/Linux. Setup writes the absolute Node executable and package path for you. The server reads connections from the catalog at startup. Call `db_catalog_status` to check loaded and skipped connections. Tool names include the connection name, such as `pg_main__db_query`. The tables below use the base tool names.

## Minimum working configuration

These examples show direct, single-connection startup from environment variables without `--catalog`. Setup always groups connections: enter the same values in setup, or use Register/Import to bring existing manual entries into the catalog and replace them with the grouped `akms_db` entry. Install the runtime before using a manual entry, and replace paths and credentials with your own.

For a direct PostgreSQL connection with password authentication, use this MCP client entry. Replace the host, database, user and password with an existing, reachable database and its credentials. This example uses port `5432` and requires the database to support TLS (the default `DB_SSL=require`).

```json
{
    "mcpServers": {
        "pg_main": {
            "command": "node",
            "args": ["/path/to/node_modules/@akms/mcp/lib/db.js"],
            "env": {
                "DB_DRIVER": "postgres",
                "DB_HOST": "db.example.com",
                "DB_NAME": "app",
                "DB_USER": "app_user",
                "DB_PASSWORD": "your-database-password"
            }
        }
    }
}
```

Required split fields are `DB_DRIVER`, `DB_HOST`, `DB_NAME` and `DB_USER`. Supply `DB_PASSWORD` when the database requires password authentication. `DB_PORT` is optional; set it only for a non-default port. For a local database without TLS, add `"DB_SSL": "off"`. SSH tunnel settings are unnecessary for a direct connection. Writes are allowed by default; add `"DB_READONLY": "true"` for a read-only entry.

If you already have a connection URL, replace the entire `env` block with:

```json
{
    "DB_DRIVER": "postgres",
    "DB_URL": "postgres://app_user:your-database-password@db.example.com:5432/app?sslmode=require"
}
```

Keep `DB_DRIVER` with `DB_URL`, and percent-encode reserved characters in the URL's user/password. Do not combine `DB_URL` with the split connection fields.

The full JSON example fits an MCP client's `mcpServers` configuration, such as a project `.mcp.json` or Cursor's `mcp.json`. The direct Node command also works on Windows. For Codex TOML or other client formats, use the shared Register screen.

### Connection through an SSH tunnel

For a database reached through an SSH host, use these values in the manual entry's `env`, or enter them in setup:

```json
{
    "DB_DRIVER": "postgres",
    "DB_HOST": "private-db.example.com",
    "DB_NAME": "app",
    "DB_USER": "app_user",
    "DB_PASSWORD": "your-database-password",
    "DB_SSH_HOST": "bastion.example.com",
    "DB_SSH_USER": "ssh_user",
    "DB_SSH_KEY": "~/.ssh/id_ed25519"
}
```

The database hostname is resolved on the SSH host. The tunnel uses an SSH channel without opening a local listening port. Use **Test the connection** in setup to check the SSH and database hops, then pin the reported host key with `DB_SSH_HOST_KEY`.

With the same connection variables available in your shell, the direct check is:

```sh
node "/path/to/node_modules/@akms/mcp/lib/db.js" --check
```

It exits after the connection check; use the script path from your installed runtime.

## Configuration

### Connection

| Variable | Description |
|---|---|
| `DB_DRIVER` ✅ | `postgres` |
| `DB_HOST` · `DB_NAME` · `DB_USER` ✅ | Where and as whom |
| `DB_PORT` · `DB_PASSWORD` | Port defaults to 5432 |
| `DB_URL` | All of the above in one URL. Setting it together with any of them fails startup, and so does any URL parameter but `sslmode` (`options`, `sslrootcert`, … would otherwise be dropped silently) |
| `DB_SSL` | `require` (encrypt, don't check the certificate) · `verify` · `off`. **Default `require`, through a tunnel too** — RDS refuses an unencrypted session even from inside its VPC |
| `DB_SSL_CA` | CA bundle for `verify` (the RDS bundle is not in Node's default store). Setting it without `DB_SSL=verify` fails startup — it would be ignored — and so does a path that does not exist |
| `DB_ALIAS` · `DB_DESCRIPTION` | Shown to the agent; alias defaults to `<database>@<host>` |

### SSH tunnel

| Variable | Description |
|---|---|
| `DB_SSH_HOST` · `DB_SSH_USER` | Turns the tunnel on |
| `DB_SSH_PORT` | Default 22 |
| `DB_SSH_KEY` · `DB_SSH_PASSPHRASE` | Private key **path** (`~` expanded) |
| `DB_SSH_PASSWORD` | When no key is used |
| `DB_SSH_HOST_KEY` | Pin the server's key, `SHA256:…` — `--check` prints it |

Authentication order: key file, password, then the SSH agent. A `DB_SSH_*` detail without `DB_SSH_HOST` fails startup rather than silently connecting direct.

No local port is opened: each database connection rides its own SSH channel, handed straight to the PostgreSQL driver. Nothing else on the machine can use the tunnel, and two servers never fight over a port. A dropped SSH connection is reopened on the next query.

### Policy

| Variable | Default | Effect |
|---|---|---|
| `DB_READONLY` | `false` | Only `SELECT` / `VALUES` / `TABLE` / `SHOW` / `EXPLAIN`, and every call runs in `BEGIN READ ONLY … ROLLBACK` — so a write hidden in a function is stopped by the server too. Functions whose effect lands outside the transaction are refused as well (`pg_terminate_backend`, `pg_cancel_backend`, replication-slot and `pg_stat_reset*` functions, `dblink*`, `lo_export`, …), and `set_config` of `statement_timeout` / `transaction_timeout` — any other `set_config` is fine, the closing `ROLLBACK` undoes it |
| `DB_ALLOW_DDL` | `true` | `false` refuses CREATE / ALTER / DROP / GRANT / COMMENT / REASSIGN OWNED …, and the tables `SELECT … INTO` and `EXPLAIN ANALYZE CREATE TABLE … AS` would create |
| `DB_DENY_PATTERNS` | — | Regexes, case-insensitive, tested against each statement as written. Comma-separated, or a JSON array (`["\\bdrop\\s{1,3}table", "secrets"]`) when a pattern contains a comma — the value is read as JSON when it parses as JSON or opens like one (`["…",` or `["…"]`), otherwise as a comma list (so a regex starting with a class like `["']` still works), where an entry with unbalanced brackets fails startup. As JSON it must be a valid array of strings, and a `\b` written with one backslash — JSON's backspace, a pattern that never matches — fails startup. Not applied to the SQL the tools write themselves (catalog queries, `db_explain`'s `EXPLAIN` wrapper) |
| `DB_STATEMENT_TIMEOUT_MS` | `60000` | `statement_timeout`, set at connect and again in every call — the **server** stops the query, even behind a pooler that drops startup parameters |
| `DB_CONNECT_TIMEOUT_MS` | `20000` | SSH and database handshakes, each — and the longest a call waits for a free connection (the pool holds two) |
| `DB_MAX_ROWS` | `500` | Rows read per statement. A cursor stops there, so a huge table never lands in memory |
| `DB_MAX_OUTPUT` | `100000` | Characters of rendered output, errors included; at least 2000 — the server text quoted in one error (message, hint, detail, where together) can take 1000, and the rest must hold the outcome line and the headings of whatever was committed before the failure. Every statement keeps its heading line. Results are kept whole smallest first — a count after a wide listing still shows — and the largest are cut, each saying how many rows or notices it leaves out (with very many statements, one line counts them all). When even the headings do not fit, runs of statements fold into one range line each (`[3–200] CREATE · 198 statements · DDL · 1–3 ms each`), so every statement stays accounted for |
| `DB_MCP_LOG_LEVEL` | `info` | `silent` · `debug` · `info` · `warn` · `error`, to stderr |

Defaults are permissive on purpose — a guard that blocks real work gets switched off wholesale. Make a production entry `DB_READONLY=true` and let write access be the deliberate exception.

A malformed value fails startup: `DB_READONLY=ture` is an error, not "writable"; so is a port outside 1–65535 or a timeout past 2³¹−1 ms, and so is a misspelled policy or TLS name (`DB_READ_ONLY`, or `db_readonly` on a case-sensitive system — "did you mean `DB_READONLY`?") that would otherwise leave the permissive default in place. A `DB_*` name close only to a connection variable is logged and ignored — another program's `DB_POOL` or `DB_HOST_REPLICA` in an inherited environment does not stop the server, and a wrong connection shows itself anyway. Errors about `DB_URL` never repeat it — it holds the password. Passwords are taken as written, surrounding spaces included.

## Tools

| Tool | Purpose |
|---|---|
| `db_list_hosts` | The database, the route to it, and the policy. No credentials |
| `db_query` | Run SQL — one or several statements, optional `params` (`$1`, `$2`, … with a single statement; pass bigint ids and exact decimals as strings), optional `transaction: false` |
| `db_schemas` | Schemas with owner and table / view / sequence counts |
| `db_tables` | One schema's tables, views, sequences (approx rows, size, comment) and its enum / domain / composite types. A partitioned table shows its partitions' total size and rows |
| `db_describe` | Columns, constraints, foreign keys pointing in, indexes with size and scan count since the statistics were last reset (an `INVALID` one marked, with what to do about it; a standby counts its own scans), triggers, partitions and `INHERITS` children, a sequence's settings, view definition |
| `db_explain` | The plan of one statement (send it without `EXPLAIN`); `analyze: true` runs it inside a transaction that is always rolled back. A prepared statement does not outlive its call — send its own SQL, with the values in `params` and its declared parameter types as casts (`$1::numeric`) |

The catalog tools read a name as SQL does — `"MixedCase"` in double quotes, an unquoted name folded to lower case (then, failing that, tried as typed), each argument by its own quotes — and print every name the way SQL has to write it: schemas, tables, columns, types, constraints, indexes, quoted where needed and schema-qualified where they name another table (partitions, parents, a sequence's owner, foreign keys pointing in). A name with no schema is looked up on the session's `search_path`, as SQL does — so a table named without its schema inside a printed definition (a foreign key, a trigger) resolves to the same object. A copied name means the same object in a query. When the same spelling also names another schema or table (`"Users"` beside `users`), a note says so. A separate `schema` argument is one name, dots included.

Rows come back as **one JSON object per line**. Dates, times, timestamps, intervals and `bytea` stay as the server's text — `pg` would otherwise turn a `timestamp` without time zone into a local-time `Date` that JSON shifts to UTC. `bigint`, `numeric` and `numeric[]` are strings, so no precision is lost; a float `NaN` / `Infinity` stays text instead of turning into `null`; in a `json` / `jsonb` value, a number a double cannot hold exactly (an id past 2⁵³, `1e-400`) is written with the server's own digits, and the value stays an object or array. A value nested deeper than about 2,000 levels comes back whole as the server's text. A repeated column name gets a `#2` suffix instead of overwriting the first. The server's `NOTICE` / `WARNING` lines are shown under the statement that raised them — a failed statement's too, since a procedure's progress lines tell what it committed (up to 20 per statement, each cut at 500 characters).

**Past the row limit:** a `SELECT` stops reading one row past it (read to tell there are more), but a function in its select list may have run for more rows than are shown — up to every row read, when its value feeds a sort, `DISTINCT`, `GROUP BY`, an aggregate or a set operation, or comes from a `WITH` or subquery that is sorted, grouped or joined. Side effects belong in a write with `RETURNING`, not in a `SELECT`. An `INSERT` / `UPDATE` / `DELETE` / `MERGE … RETURNING` has already run in full; its output says how many rows it affected and how many of the returned rows are shown. A `SELECT` whose `WITH` writes runs in full as well, outer query included. `EXECUTE` and `SHOW` run in full; only their listing is cut. A long `EXPLAIN` plan is cut the same way — without `ANALYZE` the explained statement does not run.

### Transactions

| Call | What happens |
|---|---|
| `db_query` (default) | All statements in **one transaction** — committed together, or all rolled back; the error names the statement that failed. A failing `COMMIT` (a deferred constraint) is reported as such, with everything rolled back |
| `db_query` with `transaction: false` | Autocommit, statement by statement — for `CREATE INDEX CONCURRENTLY`, `VACUUM` and others that refuse a transaction. When a later statement fails, the results of those already committed are shown with the error |
| Read-only profile, `db_explain`, catalog tools | `BEGIN [READ ONLY] … ROLLBACK` — nothing persists |

`BEGIN` / `COMMIT` / `SAVEPOINT` in the SQL are refused — the tool owns the transaction. `COPY … FROM STDIN / TO STDOUT` is refused too: the tool has no channel for a COPY stream — read with `SELECT`, write with `INSERT`.

**Cancellation.** When the MCP client cancels a call or gives up waiting, the server is asked to stop the running statement (a protocol CancelRequest), nothing further runs, and an open transaction — or an autocommit statement whose rows are still being read — is rolled back instead of committed. If the server does not stop within 5 s, the connection is cut. A connection that lost its session mid-call — a restart, a failover, a dropped tunnel — fails that call and is replaced; it never takes the server process down. When the connection dies so that a statement's outcome can't be known (during an autocommit statement or a `COMMIT`), the error says the outcome is unknown rather than guessing.

After every call the connection runs `DISCARD ALL` before going back to the pool: a `SET statement_timeout = 0`, a `set_config(…)` or a temp table does not reach the next call, and the profile's timeout is restored.

## Guard

Every statement is parsed by **libpg_query** — PostgreSQL's own grammar, compiled to WASM (`libpg-query`), the same parser `postgres-mcp` uses through `pglast`. A statement that does not parse is refused: an unknown shape can't be screened. Rules read the whole tree, so `delete   from\n users` is the same node as `DELETE FROM users`, and a `DELETE` inside `WITH x AS (…)` is found even though the statement's top is a `SELECT`.

| Layer | Scope | Refuses |
|---|---|---|
| **Always** | Every database, not configurable | `TRUNCATE` · `UPDATE` / `DELETE` without `WHERE` (inside `WITH` too) · `DROP DATABASE` / `SCHEMA` / `TABLESPACE` · `DROP OWNED` · `ALTER SYSTEM` · `COPY … TO/FROM PROGRAM` · transaction control |
| `DB_READONLY` | Opt-in | Anything but reads; data-modifying `WITH`; `SELECT … INTO`; `EXPLAIN ANALYZE` of a write |
| `DB_ALLOW_DDL=false` | Opt-in | Schema changes |
| `DB_DENY_PATTERNS` | Opt-in | Whatever you list |

**The threat model is a mistaken agent, not an adversary.** A `DO $$ … $$` body is a PL/pgSQL string the tree doesn't open, and a function can do anything its owner can — the read-only profile closes both by refusing `DO` and running inside a `READ ONLY` transaction, but the read-write profile's guard is a seatbelt, not a cage. The real boundary is the database role: give the entry a role that can do no more than it should.

The guard also can't ask a human. "Confirm before dropping a table" is the agent's rule, carried in the server's instructions; the tool refuses only what is never right.

A rejection says which rule fired, on which statement, and that nothing was sent. Its first line tells the agent what to do with it: **`Refused by the guard:`** is policy — report it, don't rephrase around it; **`Not supported by this tool:`** (COPY over STDIN / STDOUT, transaction control, turning `standard_conforming_strings` off) and **`SQL syntax error:`** mean the statement should be rewritten or fixed and sent again.

## Security notes

- Grouped connection settings store `DB_PASSWORD` and possibly `DB_SSH_PASSWORD` in the catalog. Manual environment-based client entries can also hold these values until setup imports and replaces them. Prefer SSH key files where possible and follow the shared [catalog security guidance](../README.md#catalog-security-and-recovery).
- **Anything the agent can reach, a prompt injection can reach.** Rows are untrusted input. Keep a production entry read-only.
- An unpinned SSH host accepts whatever key it presents — pin it with `DB_SSH_HOST_KEY`.

## Development

Use the [contributor guide](../README_DEV.md) for current build and test commands, and [Database implementation notes](db/README_DEV.md) for detailed background. Earlier releases are recorded in the [kind's changelog](db/CHANGELOG.md).

## Memory and process lifetime

The SQL parser runs in a worker thread that retires after 30 seconds without a pending parse. The next parse starts a new worker; active queries and database connections are independent of that lifecycle.

SSH and crypto modules load only when opening a tunnel. Setup groups this kind's connections in one stdio process per AI client session. Clients start Node directly from the runtime and need to reconnect after updates.

## License

MIT — see [LICENSE.md](../LICENSE.md).
