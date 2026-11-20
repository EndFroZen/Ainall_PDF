// Self-check for parseRanges(): run with `node scripts/check-ranges.ts` (Node 22.6+).
import assert from "node:assert/strict";
import { parseRanges } from "../src/lib/ranges.ts";

assert.deepEqual(parseRanges("1-3, 5, 8-", 10), [[1, 3], [5, 5], [8, 10]]);
assert.deepEqual(parseRanges("-2", 10), [[1, 2]]);
assert.deepEqual(parseRanges(" 4 - 4 ,", 4), [[4, 4]]);
for (const bad of ["", "0", "11", "3-2", "a", "1-2-3", "-"]) {
  assert.equal(typeof parseRanges(bad, 10), "string", bad);
}
console.log("parseRanges OK");
