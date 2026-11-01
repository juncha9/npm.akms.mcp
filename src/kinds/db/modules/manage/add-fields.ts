import type { AddField } from "@/modules/registration/add-command";
import { DB_ENV } from "@db/_defs";

// DB_URL can carry a password, so the command accepts separate connection fields only.
export const ADD_DEFAULTS = { [DB_ENV.DRIVER]: "postgres" };
export const ADD_FIELDS: AddField[] = [
    { flag: "host", env: DB_ENV.HOST, help: "Database hostname or IP", required: true },
    { flag: "port", env: DB_ENV.PORT, help: "Database port; default 5432" },
    { flag: "database", env: DB_ENV.NAME, help: "Database name", required: true },
    { flag: "user", env: DB_ENV.USER, help: "Database user", required: true },
    { flag: "password", env: DB_ENV.PASSWORD, help: "Database password", type: "secret" },
    { flag: "ssl", env: DB_ENV.SSL, help: "require (default), verify, or off" },
    { flag: "ssl-ca", env: DB_ENV.SSL_CA, help: "Trusted CA bundle path for --ssl verify" },
    { flag: "ssh-host", env: DB_ENV.SSH_HOST, help: "SSH tunnel hostname or IP" },
    { flag: "ssh-port", env: DB_ENV.SSH_PORT, help: "SSH tunnel port; default 22" },
    { flag: "ssh-user", env: DB_ENV.SSH_USER, help: "SSH tunnel login user" },
    { flag: "ssh-key", env: DB_ENV.SSH_KEY, help: "SSH private key file path; ~ is expanded" },
    { flag: "ssh-passphrase", env: DB_ENV.SSH_PASSPHRASE, help: "SSH key passphrase", type: "secret" },
    { flag: "ssh-password", env: DB_ENV.SSH_PASSWORD, help: "SSH tunnel password", type: "secret" },
    { flag: "ssh-host-key", env: DB_ENV.SSH_HOST_KEY, help: "Pinned SSH host key, SHA256:…" },
    { flag: "readonly", env: DB_ENV.READONLY, help: "Reject database writes", type: "switch" },
    { flag: "no-ddl", env: DB_ENV.ALLOW_DDL, help: "Reject CREATE, ALTER and DROP", type: "switch", set: "false" },
    { flag: "description", env: DB_ENV.DESCRIPTION, help: "Shown to the model; say what the database is for" },
];
