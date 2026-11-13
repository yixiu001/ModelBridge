import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ClientAccess} from '../src/client-access.mjs';
import {saveVault} from '../src/vault.mjs';
const models=[{slug:'chosen',displayName:'Chosen',selectable:true,checks:{tools:{status:'passed'}},declared:{}}];
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'mb-client-access-'));t.after(()=>rm(dir,{recursive:true,force:true}));const target=join(dir,'models.json');await writeFile(target,JSON.stringify([{id:'personal',name:'Personal',apiKey:'FOREIGN_SECRET',url:'https://example.test'}]));await saveVault(join(dir,'gateway-key.dpapi'),{key:'OLD_SECRET'});const a=new ClientAccess({dataDir:dir,targetPath:target,base:'http://127.0.0.1:43821',getModels:()=>models});await a.init();return {a,dir,target};}
test('preview is secret-free and concurrent WorkBuddy edits preserve old access',async t=>{
 const {a,target}=await setup(t);const preview=await a.preview();assert.doesNotMatch(JSON.stringify(preview),/FOREIGN_SECRET|OLD_SECRET/);
 const rotation=await a.begin();await writeFile(target,'[]');await assert.rejects(()=>a.apply({rotationId:rotation.rotationId,expectedClientRevision:preview.revision}),e=>e.details.httpStatus===409);
 assert.equal(a.accepts('OLD_SECRET'),true);assert.equal(await readFile(target,'utf8'),'[]');
});
test('rotation survives restart, preserves foreign entries and can rollback',async t=>{
 const {a,dir,target}=await setup(t);const before=await readFile(target,'utf8');const {rotationId}=await a.begin();const key=a.copyKey();await a.apply({rotationId,expectedClientRevision:(await a.preview()).revision});
 const updated=JSON.parse(await readFile(target,'utf8'));assert.equal(updated.find(m=>m.id==='personal').apiKey,'FOREIGN_SECRET');assert.equal(updated.find(m=>m.id==='chosen').apiKey,key);
 const restarted=new ClientAccess({dataDir:dir,targetPath:target,base:a.base,getModels:()=>models});await restarted.init();assert.equal(restarted.accepts(key),true);assert.equal(restarted.accepts('OLD_SECRET'),true);
 await restarted.rollback(rotationId);assert.equal(await readFile(target,'utf8'),before);assert.equal(restarted.accepts(key),false);assert.equal(restarted.accepts('OLD_SECRET'),true);
});
test('old key is revoked only after explicit completion and a verified new-key request',async t=>{
 const {a}=await setup(t);const {rotationId}=await a.begin();const key=a.copyKey();await a.apply({rotationId,expectedClientRevision:(await a.preview()).revision});
 await assert.rejects(()=>a.complete(rotationId));await a.noteSuccessfulKey(key);await a.complete(rotationId);assert.equal(a.accepts('OLD_SECRET'),false);assert.equal(a.accepts(key),true);assert.equal(a.status().rotation,null);assert.equal(a.status().lastBackup,null);
});

test('completion refuses client edits after verification and retains both keys',async t=>{
 const {a,target}=await setup(t);const {rotationId}=await a.begin(),key=a.copyKey();await a.apply({rotationId,expectedClientRevision:(await a.preview()).revision});await a.noteSuccessfulKey(key);
 await writeFile(target,'[]');await assert.rejects(()=>a.complete(rotationId),e=>e.details.httpStatus===409);assert.equal(a.accepts('OLD_SECRET'),true);assert.equal(a.accepts(key),true);
});
