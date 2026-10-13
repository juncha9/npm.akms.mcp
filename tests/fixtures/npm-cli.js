import { appendFileSync } from "node:fs";

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
