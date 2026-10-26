import { appendFileSync } from "node:fs";

const argumentsList = process.argv.slice(2);
if(process.env.AKMS_TEST_RUNTIME_RECORD) appendFileSync(process.env.AKMS_TEST_RUNTIME_RECORD, JSON.stringify(argumentsList) + "\n");
process.stdout.write(`RUNTIME_ARGS:${JSON.stringify(argumentsList)}\n`);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
    process.stdout.write(`CHILD_INPUT:${JSON.stringify(input)}\n`);
    process.exitCode = Number(process.env.AKMS_TEST_EXIT_CODE ?? "0");
});
