#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docPath = path.join(root, "docs", "playbook-expectations.md");

function fail(msg) {
  console.error(`pin-check: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(docPath)) {
  fail("docs/playbook-expectations.md missing");
}

const raw = fs.readFileSync(docPath, "utf8");
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
if (!fmMatch) {
  fail("missing YAML frontmatter");
}

const frontmatter = fmMatch[1];
if (!frontmatter) fail("frontmatter is empty");

const shaLine = frontmatter.match(/^vault_git_sha:\s*(.+)\s*$/m);
if (!shaLine) {
  fail("vault_git_sha missing in frontmatter");
}

const value = (shaLine[1]?.trim() ?? "").replace(/^['"]|['"]$/g, "");
if (!/^[a-f0-9]{7,64}$/i.test(value)) {
  fail("vault_git_sha must be 7-64 hex chars");
}

console.log("pin-check: ok");
