import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diffCatalog,previewModelRules,verificationKey} from '../src/model-catalog.mjs';
const catalog=[{slug:'a',selectable:true,declared:{context_window:100}},{slug:'b',selectable:false}];
test('catalog diffs identify additions, removals and changed capabilities',()=>{
 const d=diffCatalog(catalog,[{slug:'a',selectable:true,declared:{context_window:200}},{slug:'c',selectable:true}]);
 assert.deepEqual(d.added,['c']);assert.deepEqual(d.removed,['b']);assert.deepEqual(d.changed,['a']);
});
test('rule preview rejects unavailable aliases and collisions and reports client impact',()=>{
 for(const aliases of [[{name:'b',alias:'friendly',fork:true}],[{name:'a',alias:'b',fork:true}],[{name:'a',alias:'x',fork:true},{name:'x',alias:'a',fork:false}]])assert.ok(previewModelRules({catalog,rules:{excluded:[],aliases}}).errors.length);
 const p=previewModelRules({catalog,rules:{excluded:[],aliases:[{name:'a',alias:'friendly',fork:false}]}});
 assert.deepEqual(p.effectiveModels.filter(m=>m.selectable).map(m=>m.slug),['friendly']);assert.deepEqual(p.changes.removed,['a']);assert.deepEqual(p.changes.added,['friendly']);
});
test('verification identity separates accounts grants catalog rules adapter and scenario',()=>{
 const base={accountKey:'a',credentialRevision:1,catalogRevision:'c',rulesRevision:'r',adapterVersion:4,model:'m',scenario:'tools'},key=verificationKey(base);
 for(const field of Object.keys(base))assert.notEqual(verificationKey({...base,[field]:'different'}),key);
 assert.equal(verificationKey({...base}),key);
});
