import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argumentsList = process.argv.slice(2);
appendFileSync(process.env.AKMS_TEST_RECORD, JSON.stringify(argumentsList) + "\n");
if(argumentsList[0] === "view") {
    if(process.env.AKMS_TEST_FAIL_LOOKUP === "1") {
        process.stderr.write("Registry unavailable\n");
        process.exitCode = 1;
    }
    else {
        process.stdout.write('"9.8.7"\n');
    }
}
else if(argumentsList[0] === "install") {
    if(process.env.AKMS_TEST_FAIL_INSTALL === "1") {
        process.stderr.write("Fixture installation failed: registry denied installation\n");
        process.exitCode = 1;
    }
    else if(process.env.AKMS_TEST_NO_RUNTIME !== "1") {
        const packageName = argumentsList.find((arg) => /^@akms\/mcp-[a-z]+@latest$/.test(arg))?.replace(/@latest$/, "");
        const prefix = argumentsList[argumentsList.indexOf("--prefix") + 1];
        if(!packageName || !prefix.startsWith(process.env.AKMS_MCP_HOME)) throw new Error("Test installation must stay in its isolated runtime.");
        const directory = join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", packageName);
        mkdirSync(join(directory, "lib"), { recursive: true });
        writeFileSync(join(directory, "package.json"), JSON.stringify({ name: packageName, version: "9.8.7", type: "module", bin: { [packageName.replace("@akms/", "akms-")]: "lib/cli.js" } }));
        writeFileSync(join(directory, "lib/cli.js"), readFileSync(new URL("./runtime-cli.js", import.meta.url)));
    }
}
else {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
        input += chunk;
    });
    process.stdin.on("end", () => {
        process.stdout.write(`CHILD_INPUT:${JSON.stringify(input)}\n`);
        process.exitCode = Number(process.env.AKMS_TEST_EXIT_CODE ?? "0");
    });
}
