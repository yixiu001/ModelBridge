import { spawn } from 'node:child_process';
import { writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

function dpapi(bytes, operation) {
  if (process.platform !== 'win32') throw new Error('Windows DPAPI is required; plaintext fallback is disabled');
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; try { $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${operation}($data,[Text.Encoding]::UTF8.GetBytes('ModelBridge/v1'),[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result)) } catch { [Console]::Error.Write('DPAPI operation failed'); exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill(), 15_000);
    child.stdout.on('data', b => { out += b; if (out.length > 2_000_000) child.kill(); });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('DPAPI unavailable')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.from(out.trim(), 'base64')) : reject(new Error('DPAPI operation failed; no plaintext fallback')); });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes.toString('base64'));
  });
}
export const seal = bytes => dpapi(bytes, 'Protect');
export const unseal = bytes => dpapi(bytes, 'Unprotect');
export async function saveVault(path, data) {
  const encrypted = await seal(Buffer.from(JSON.stringify(data), 'utf8'));
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function loadVault(path) {
  return JSON.parse((await unseal(await readFile(path))).toString('utf8'));
}
