import type { AddField } from "@/modules/registration/add-command";
import { SINGLE_HOST_ENV } from "@ssh/_defs";

/**
 * What `akms-mcp add ssh` can set: the setup form's settings, minus SSH_PROXY_COMMAND.
 * That one runs through the local shell on every connection, so it stays in the setup menu.
 */
export const ADD_FIELDS: AddField[] = [
    { flag: "host", env: SINGLE_HOST_ENV.HOST, help: "Hostname or IP", required: true },
    { flag: "user", env: SINGLE_HOST_ENV.USER, help: "Login user", required: true },
    { flag: "port", env: SINGLE_HOST_ENV.PORT, help: "Port; default 22" },
    { flag: "key", env: SINGLE_HOST_ENV.KEY, help: "Private key file path; ~ is expanded" },
    { flag: "passphrase", env: SINGLE_HOST_ENV.PASSPHRASE, help: "Key passphrase", type: "secret" },
    { flag: "password", env: SINGLE_HOST_ENV.PASSWORD, help: "SSH password", type: "secret" },
    { flag: "host-key", env: SINGLE_HOST_ENV.HOST_KEY, help: "Pinned host key, SHA256:…" },
    { flag: "jump-host", env: SINGLE_HOST_ENV.JUMP_HOST, help: "Jump host the target is reached through" },
    { flag: "jump-port", env: SINGLE_HOST_ENV.JUMP_PORT, help: "Jump host port; default 22" },
    { flag: "jump-user", env: SINGLE_HOST_ENV.JUMP_USER, help: "Jump host user; default --user" },
    { flag: "jump-host-key", env: SINGLE_HOST_ENV.JUMP_HOST_KEY, help: "Pinned jump host key, SHA256:…" },
    { flag: "readonly", env: SINGLE_HOST_ENV.READONLY, help: "Reject write commands, redirections and uploads", type: "switch" },
    { flag: "allowed-paths", env: SINGLE_HOST_ENV.ALLOWED_PATHS, help: "Comma-separated path prefixes the file tools may touch" },
    { flag: "description", env: SINGLE_HOST_ENV.DESCRIPTION, help: "Shown to the model; say what the host is for" },
];
