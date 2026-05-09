#!/usr/bin/env node
/**
 * run-pytest.mjs — wrapper for `python -m pytest` that prefers a local venv.
 *
 * Resolution order:
 *   1. src/tools/.venv/{bin,Scripts}/python  — if a venv exists locally
 *   2. python3 / python on PATH              — typical CI shape
 *
 * CI workflows install deps via `pip install -r src/tools/requirements.txt`
 * directly into the runner's interpreter, so the fallback path is fine there.
 * Local devs run `python3.12 -m venv src/tools/.venv && pip install -r ...`
 * once and then `npm run test:python` picks the venv up automatically.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `import.meta.dirname` only landed in Node 20.11 — keep this compatible
// with the package.json `engines.node: ">=20"` floor.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const venvDir = join(repoRoot, "src", "tools", ".venv");
const venvPython =
  process.platform === "win32"
    ? join(venvDir, "Scripts", "python.exe")
    : join(venvDir, "bin", "python");

const python = existsSync(venvPython)
  ? venvPython
  : process.platform === "win32"
    ? "python"
    : "python3";

const args = ["-m", "pytest", "src/tools/tests", "-q", ...process.argv.slice(2)];
const { status } = spawnSync(python, args, { stdio: "inherit", cwd: repoRoot });
process.exit(status ?? 1);
