// Exposes the local server over public HTTPS so Agora's cloud can call our tool routes.
//
// Starts a cloudflared quick tunnel and writes its URL to .env.development.local as PUBLIC_URL,
// which `next dev` picks up without a restart. The file is removed when the tunnel stops.
// Quick tunnels get a new URL on every start, so keep this running for the whole session.
//
// Run: pnpm run tunnel
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT || 3000;
const ENV_FILE = '.env.development.local';
const MARKER = '# Written by scripts/tunnel.mjs; removed when the tunnel stops.';

if (existsSync(ENV_FILE) && !readFileSync(ENV_FILE, 'utf8').startsWith(MARKER)) {
  console.error(`${ENV_FILE} exists and was not written by this script. Move it away, then run again.`);
  process.exit(1);
}

const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let published = false;
const scan = (chunk) => {
  const match = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!match || published) return;
  published = true;
  writeFileSync(ENV_FILE, `${MARKER}\nPUBLIC_URL=${match[0]}\n`);
  console.log(`Tunnel up: ${match[0]} -> http://localhost:${PORT}`);
  console.log(`PUBLIC_URL written to ${ENV_FILE}. Keep this running; press Ctrl+C to stop.`);
};
tunnel.stdout.on('data', scan);
tunnel.stderr.on('data', scan);

tunnel.on('error', (error) => {
  console.error(`Could not start cloudflared: ${error.message}`);
  process.exit(1);
});
tunnel.on('exit', (code) => {
  rmSync(ENV_FILE, { force: true });
  console.log('Tunnel stopped; PUBLIC_URL removed.');
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => tunnel.kill());
