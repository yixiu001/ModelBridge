import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildWorkBuddyModel} from '../src/workbuddy-config.mjs';
test('reasoning-only catalog models cannot be configured as thinking-disabled in WorkBuddy',()=>{
  const model={slug:'chosen',displayName:'Chosen',declared:{default_reasoning_level:'medium',supported_reasoning_levels:[{effort:'low'},{effort:'medium'},{effort:'high'},{effort:'max'},{effort:'ultra'}]}};
  const result=buildWorkBuddyModel(model,{url:'http://127.0.0.1/bridge',key:'test'});
  assert.equal(result.supportsReasoning,true);assert.equal(result.onlyReasoning,true);assert.equal(result.reasoning.canDisableThinking,false);
  assert.equal(result.reasoning.defaultEffort,'medium');assert.deepEqual(result.reasoning.supportedEfforts,['low','medium','high','max']);
  assert.equal(result.thinkingLevelMap.off,null);assert.equal(result.thinkingLevelMap.max,'max');assert.equal(result.id,'chosen');
});
