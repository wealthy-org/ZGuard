// Regenerates packages/zk/fixtures/sp1-quote-fixtures.json from the built TS pipeline (run after `pnpm build`).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSp1QuoteFixtures } from "../dist/index.js";

const out = fileURLToPath(new URL("../fixtures/sp1-quote-fixtures.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(buildSp1QuoteFixtures(), null, 2)}\n`);
console.log(`wrote ${out}`);
