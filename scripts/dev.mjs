#!/usr/bin/env node
// `pnpm dev`: ensure .env, start Postgres (docker compose), wait until healthy, run migrations,
// then start the server (tsx watch) and the web app (vite) together.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (m) => console.log(`\x1b[90m[dev]\x1b[0m ${m}`);

if (!fs.existsSync(path.join(root, '.env'))) {
  fs.copyFileSync(path.join(root, '.env.example'), path.join(root, '.env'));
  log('created .env from .env.example');
}

function sh(cmd) {
  return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

let dockerOk = true;
try {
  sh('docker info --format "{{.ServerVersion}}"');
} catch {
  dockerOk = false;
  log('docker is not available — assuming DATABASE_URL in .env points at a running Postgres');
}

if (dockerOk && process.env.GW_SKIP_DB !== '1') {
  log('starting Postgres (docker compose up -d db)…');
  execSync('docker compose up -d db', { cwd: root, stdio: 'inherit' });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const id = sh('docker compose ps -q db');
      const health = sh(`docker inspect -f "{{.State.Health.Status}}" ${id}`);
      if (health === 'healthy') break;
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline) {
      console.error('Postgres did not become healthy within 60s');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log('Postgres is healthy');
}

const procs = [
  { name: 'server', color: '36', cmd: 'pnpm', args: ['--filter', '@gw/server', 'dev'] },
  { name: 'web', color: '35', cmd: 'pnpm', args: ['--filter', '@gw/web', 'dev'] },
];

const children = procs.map((p) => {
  const child = spawn(p.cmd, p.args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `\x1b[${p.color}m[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(prefix + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    log(`${p.name} exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

log('web → http://localhost:5173   api → http://localhost:8787   admin → http://localhost:8787/admin/sources');

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
