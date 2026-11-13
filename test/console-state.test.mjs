import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDraft,editDraft,receiveSnapshot,OperationEpoch,failedItems} from '../web/src/console-state.mjs';
test('refresh and save conflicts keep the users draft until explicit discard',()=>{
 const d=editDraft(createDraft({revision:'one',values:{timeoutSeconds:180}}),{timeoutSeconds:90});
 const next=receiveSnapshot(d,{revision:'two',values:{timeoutSeconds:60}});
 assert.equal(next.values.timeoutSeconds,90);assert.equal(next.revision,'one');assert.equal(next.conflict,true);
 assert.equal(receiveSnapshot(next,{revision:'two',values:{timeoutSeconds:60}},{discard:true}).values.timeoutSeconds,60);
});
test('late results from old targets are ignored and retry selects failed items only',()=>{
 const e=new OperationEpoch();const old=e.begin('a'),current=e.begin('b');assert.equal(e.current(old,'a'),false);assert.equal(e.current(current,'b'),true);e.invalidate();assert.equal(e.current(current,'b'),false);
 assert.deepEqual(failedItems([{key:'a',state:'failed'},{key:'b',state:'cancelled'},{key:'c',state:'succeeded'}]),['a']);
});
