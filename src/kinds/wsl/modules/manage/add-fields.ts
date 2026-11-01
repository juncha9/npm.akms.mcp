import type { AddField } from "@/modules/registration/add-command";
import { SINGLE_HOST_ENV } from "@wsl/_defs";

export const ADD_FIELDS: AddField[] = [
    { flag: "distro", env: SINGLE_HOST_ENV.DISTRO, help: "Distro name as wsl -l -q prints it", required: true },
    { flag: "user", env: SINGLE_HOST_ENV.USER, help: "Linux user; default is the distro's configured user" },
    { flag: "readonly", env: SINGLE_HOST_ENV.READONLY, help: "Reject write commands, redirections and uploads", type: "switch" },
    { flag: "allow-windows", env: SINGLE_HOST_ENV.ALLOW_WINDOWS, help: "Allow Windows .exe interop and writes under /mnt/<drive>", type: "switch" },
    { flag: "allowed-paths", env: SINGLE_HOST_ENV.ALLOWED_PATHS, help: "Comma-separated path prefixes the file tools may touch" },
    { flag: "description", env: SINGLE_HOST_ENV.DESCRIPTION, help: "Shown to the model; say what the distro is for" },
];
