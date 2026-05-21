#!/usr/bin/env node
// Verifies the local environment can run e2e tests:
//   1. `claude --version` resolves on PATH
//   2. ANTHROPIC_API_KEY is set OR a prior `claude auth login` exists
// Exits 0 on success with a green check, non-zero on failure with an actionable message.

import { spawn } from 'node:child_process';

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => {
      stdout += b.toString();
    });
    child.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const checks = [];

const ver = await run('claude', ['--version']);
if (ver.code === 0) {
  checks.push({ name: 'claude --version', ok: true, detail: ver.stdout.trim() });
} else {
  checks.push({
    name: 'claude --version',
    ok: false,
    detail: '`claude` not found on PATH. Install Claude Code globally and ensure it is available.',
  });
}

if (process.env.ANTHROPIC_API_KEY) {
  checks.push({ name: 'auth', ok: true, detail: 'ANTHROPIC_API_KEY set' });
} else {
  const status = await run('claude', ['auth', 'status']);
  checks.push({
    name: 'auth',
    ok: status.code === 0,
    detail:
      status.code === 0
        ? 'claude auth status: logged in'
        : 'No ANTHROPIC_API_KEY and `claude auth status` not logged in. Run `claude auth login` or export ANTHROPIC_API_KEY.',
  });
}

let allOk = true;
for (const c of checks) {
  const mark = c.ok ? 'ok' : 'FAIL';
  console.log(`[${mark}] ${c.name} — ${c.detail}`);
  if (!c.ok) allOk = false;
}

process.exit(allOk ? 0 : 1);
