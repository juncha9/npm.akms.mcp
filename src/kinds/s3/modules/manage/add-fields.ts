import type { AddField } from "@/modules/registration/add-command";

export const ADD_FIELDS: AddField[] = [
    { flag: "backend", env: "S3_BACKEND", help: "aws (default) or compatible" },
    { flag: "bucket", env: "S3_BUCKET", help: "General-purpose bucket name", required: true },
    { flag: "region", env: "S3_REGION", help: "Signing region; required for compatible storage" },
    { flag: "endpoint", env: "S3_ENDPOINT", help: "Compatible storage root URL, such as https://storage.example.com" },
    { flag: "auth", env: "S3_AUTH", help: "static | profile | default; required with --backend compatible" },
    { flag: "profile", env: "S3_PROFILE", help: "AWS shared profile name; requires --auth profile" },
    { flag: "access-key-id", env: "S3_ACCESS_KEY_ID", help: "Access key ID", type: "secret" },
    { flag: "secret-access-key", env: "S3_SECRET_ACCESS_KEY", help: "Secret access key", type: "secret" },
    { flag: "session-token", env: "S3_SESSION_TOKEN", help: "Temporary session token", type: "secret" },
    { flag: "prefix", env: "S3_PREFIX", help: "Allowed literal key prefix; keys must include it" },
    { flag: "readonly", env: "S3_READONLY", help: "Reject remote writes", type: "switch" },
    { flag: "local-root", env: "S3_LOCAL_ROOT", help: "Local directory for file transfers" },
    { flag: "description", env: "S3_DESCRIPTION", help: "Shown to the model; say what the bucket is for" },
];
