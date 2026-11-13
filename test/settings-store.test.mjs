import { test, mock } from 'node:test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, exportSettings, restoreSettings, previewSettings } from '../src/settings-store.mjs';
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'mb-settings-')); t.after(()=>rm(dir,{recursive:true,force:true})); return dir; }
test('legacy migration preserves values and backup without changing credentials', async t => {
 const dir=await fixture(t); const legacy={timeoutSeconds:61,loggingToFile:false,excluded:['hidden'],aliases:[{name:'real',alias:'friendly',fork:true}]};
 await writeFile(join(dir,'direct-preferences.json'),JSON.stringify(legacy)); await writeFile(join(dir,'accounts.dpapi'),'OPAQUE');
 const s=await loadSettings(dir); assert.equal(s.values.timeoutSeconds,61); assert.deepEqual(s.values.aliases,legacy.aliases);
 const saved=await saveSettings(dir,{revision:s.revision,values:{...s.values,timeoutSeconds:62}});
 assert.equal(saved.values.timeoutSeconds,62); assert.deepEqual(JSON.parse(await readFile(join(dir,'direct-preferences.pre-upgrade.json'),'utf8')),legacy);
 assert.equal(await readFile(join(dir,'accounts.dpapi'),'utf8'),'OPAQUE');
});
test('stale revision and invalid restore leave disk and draft unchanged',async t=>{
 const dir=await fixture(t), s=await loadSettings(dir), draft={...s.values,timeoutSeconds:70};
 await saveSettings(dir,{revision:s.revision,values:draft}); const before=await readFile(join(dir,'settings.json'),'utf8');
 await assert.rejects(()=>saveSettings(dir,{revision:s.revision,values:{...s.values,timeoutSeconds:80}}),e=>e.details.httpStatus===409);
 await assert.rejects(()=>restoreSettings(dir,{revision:(JSON.parse(before)).revision,document:{schemaVersion:1,values:{...draft,access_token:'SECRET'}}}));
 assert.equal(await readFile(join(dir,'settings.json'),'utf8'),before); assert.equal(draft.timeoutSeconds,70);
});
test('backup excludes secrets and rejects unknown nested keys and alias cycles',async t=>{
 const s=await loadSettings(await fixture(t)); const b=exportSettings({...s,access_token:'SECRET'});
 assert.ok(!JSON.stringify(b).includes('SECRET')); assert.equal(b.schemaVersion,1);
 assert.ok(previewSettings(s,{...s.values,aliases:[{name:'a',alias:'b',fork:true},{name:'b',alias:'a',fork:false}]}).errors.length);
 assert.ok(previewSettings(s,{...s.values,aliases:[{name:'a',alias:'b',fork:true,token:'SECRET'}]}).errors.length);
});
test('failed atomic replacement keeps the last valid config',async t=>{
 const dir=await fixture(t), s=await loadSettings(dir); await saveSettings(dir,{revision:s.revision,values:s.values});
 // A filesystem rename failure must not destroy the previous persisted document.
 const current=await loadSettings(dir); const mocked=mock.method(fs,'rename',async()=>{throw new Error('simulated filesystem rename failure');}); t.after(()=>mocked.mock.restore());
 await assert.rejects(()=>saveSettings(dir,{revision:current.revision,values:{...current.values,timeoutSeconds:90}}));
 assert.equal((await loadSettings(dir)).values.timeoutSeconds,180);
 mocked.mock.restore();
});
test('concurrent writers cannot both commit the same revision',async t=>{
 const dir=await fixture(t), s=await loadSettings(dir);
 const results=await Promise.allSettled([60,90].map(timeoutSeconds=>saveSettings(dir,{revision:s.revision,values:{...s.values,timeoutSeconds}})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
