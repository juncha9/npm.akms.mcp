declare const __PACKAGE_VERSION__: string | undefined;

/** package.json's version, injected by tsup and vitest. "development" when run from source through tsx. */
export const PACKAGE_VERSION: string = typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "development";
