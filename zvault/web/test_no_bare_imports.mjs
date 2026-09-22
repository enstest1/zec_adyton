#!/usr/bin/env node
/**
 * Gate: no bare package imports under web/js/.
 *
 * The mint page is static ES modules with no bundler and no node_modules.
 * Vendored crypto must use relative paths only (like vendor/blake2b.js).
 * node: builtins are allowed in Node-only *.mjs runners.
 *
 * Run: node web/test_no_bare_imports.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "js");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** Strip // and /* *\/ comments so doc examples do not false-positive. */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Keep string literals intact (avoid stripping // inside strings)
    if (src[i] === "'" || src[i] === '"' || src[i] === "`") {
      const q = src[i++];
      out += q;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") {
          out += src[i++] + (src[i] ?? "");
          i++;
          continue;
        }
        out += src[i++];
      }
      if (i < src.length) out += src[i++];
      continue;
    }
    out += src[i++];
  }
  return out;
}

const FROM_RE =
  /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const SIDE_EFFECT_RE = /\bimport\s+['"]([^'"]+)['"]/g;

const files = walk(ROOT);
const bad = [];

for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const code = stripComments(raw);
  const specs = new Set();
  for (const re of [FROM_RE, SIDE_EFFECT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) specs.add(m[1]);
  }
  for (const spec of specs) {
    if (spec.startsWith("./") || spec.startsWith("../")) continue;
    if (spec.startsWith("node:")) continue;
    // Absolute /http never expected; treat as bare/bad for this tree
    bad.push({ file: relative(ROOT, file), spec });
  }
}

if (bad.length) {
  console.error("FAIL bare import specifier(s) under web/js/ — page has no bundler:");
  for (const b of bad) console.error(`  ${b.file}: from '${b.spec}'`);
  process.exit(1);
}

console.log(`ok  no bare imports under web/js/ (${files.length} files)`);
