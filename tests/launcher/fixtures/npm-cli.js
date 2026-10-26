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
        const prefix = argumentsList[argumentsList.indexOf("--prefix") + 1];
        if(!argumentsList.includes("@akms/mcp@latest") || !prefix.startsWith(process.env.AKMS_MCP_HOME)) throw new Error("Test installation must stay in its isolated runtime.");
        // One package carries every kind's entry.
        const directory = join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@akms", "mcp");
        const kinds = ["db", "ssh", "wsl", "s3"];
        mkdirSync(join(directory, "lib"), { recursive: true });
        writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@akms/mcp", version: "9.8.7", type: "module", bin: Object.fromEntries(kinds.map((kind) => [`akms-mcp-${kind}`, `lib/${kind}.js`])) }));
        for(const kind of kinds) writeFileSync(join(directory, "lib", `${kind}.js`), readFileSync(new URL("./runtime-cli.js", import.meta.url)));
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
