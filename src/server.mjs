import { mkdir, open, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeError } from './service.mjs';
import { StandaloneService } from './standalone-service.mjs';
import { createApp } from './http.mjs';
import { loadVault, saveVault } from './vault.mjs';

const dataDir = fileURLToPath(new URL('../.local/', import.meta.url));
await mkdir(dataDir, { recursive: true });
const lockPath = join(dataDir, 'runtime.lock');
let lock, server;
try {
  lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  const service = new StandaloneService({ dataDir }); await service.init();
  const controlKey = randomBytes(32).toString('base64url');
  let gateway;
  try{gateway=await loadVault(join(dataDir,'gateway-key.dpapi'));}catch(error){if(error.code!=='ENOENT')throw error;gateway={key:'mb_'+randomBytes(32).toString('base64url')};await saveVault(join(dataDir,'gateway-key.dpapi'),gateway);}
  server = createApp({ service, controlKey, gatewayKey:gateway.key });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.MODELBRIDGE_PORT || 43821), '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await writeFile(join(dataDir, 'control.json'), JSON.stringify({ base, key: controlKey, pid: process.pid }), { mode: 0o600 });
  console.log(`ModelBridge verification console: ${base}`);
  let stopping = false;
  async function stop() {
    if (stopping) return; stopping = true;
    service.cancel(); server.close(); server.closeAllConnections();
    await lock.close(); await unlink(lockPath); await unlink(join(dataDir, 'control.json'));
  }
  process.on('SIGINT', () => stop().finally(() => process.exit(0)));
  process.on('SIGTERM', () => stop().finally(() => process.exit(0)));
} catch (error) {
  if (lock) { await lock.close(); await unlink(lockPath).catch(() => {}); }
  server?.close();
  console.error(error.code === 'EEXIST' ? 'ModelBridge runtime lock exists; check the running instance before removing a stale lock.' : JSON.stringify(safeError(error)));
  process.exitCode = 1;
}
