import { mkdir, writeFile } from "node:fs/promises";

await mkdir("src", { recursive: true });
await mkdir("test", { recursive: true });
await writeFile("src/feature.js", "export const transactionReady = true;\n", "utf8");
await writeFile("test/feature.test.js", "import { strict as assert } from 'node:assert';\nassert.equal(1 + 1, 2);\n", "utf8");
process.stdout.write("Fake agent changed src/feature.js and test/feature.test.js\n");
