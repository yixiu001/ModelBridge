import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seal, unseal, saveVault, loadVault } from '../src/vault.mjs';

test('Windows vault round-trips credentials without plaintext persistence', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-vault-'));
  try {
    const path = join(directory, 'credentials.dpapi');
    const credentials = { access_token: 'test-sensitive-令牌', refresh_token: 'rotate-me' };
    await saveVault(path, credentials);
    const bytes = await readFile(path, 'utf8');
    assert.equal(bytes.includes('test-sensitive'), false);
    assert.deepEqual(await loadVault(path), credentials);
    await saveVault(path, { access_token: 'replacement' });
    assert.deepEqual(await loadVault(path), { access_token: 'replacement' });
    await assert.rejects(() => unseal(Buffer.from('invalid cipher')));
    assert.notDeepEqual(await seal(Buffer.from('secret')), Buffer.from('secret'));
  } finally { await rm(directory, { recursive: true }); }
});
