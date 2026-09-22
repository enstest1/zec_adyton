#!/usr/bin/env node
/**
 * Run every web/js/tx/test_*.mjs. Exit non-zero if any fails (including
 * crashes that never print a pass line).
 *
 *   node web/js/tx/run_tx_tests.mjs
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const DIR = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(DIR)
  .filter((n) => n.startsWith("test_") && n.endsWith(".mjs"))
  .sort();

if (!tests.length) {
  console.error("FAIL no test_*.mjs found in", DIR);
  process.exit(1);
}

let failed = 0;
for (const name of tests) {
  const path = join(DIR, name);
  process.stdout.write(`\n=== ${name} ===\n`);
  const r = spawnSync(process.execPath, [path], {
    cwd: DIR,
    encoding: "utf8",
    env: process.env,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`FAIL ${name} exit=${r.status}${r.error ? " " + r.error.message : ""}`);
    failed++;
  } else if (!((r.stdout || "") + (r.stderr || "")).trim()) {
    // Crash-free but silent — treat as failure so stackless emptiness is visible
    console.error(`FAIL ${name} produced no output`);
    failed++;
  } else {
    console.log(`PASS ${name}`);
  }
}

console.log(`\n--- ${tests.length - failed}/${tests.length} suites passed ---`);
process.exit(failed ? 1 : 0);
