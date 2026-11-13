import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyFailure} from '../src/diagnostics.mjs';
test('diagnostics separate validation, network, quota and upstream failures without leaking text',()=>{
 const cases=[
 [Object.assign(new Error('SECRET user text'),{details:{httpStatus:400,code:'unsupported_parameter',param:'reasoning.effort',source:'client'}}),'validation',400,'client'],
 [new TypeError('fetch failed SECRET'),'network',502,'network'],
 [Object.assign(new Error('SECRET'),{name:'TimeoutError'}),'timeout',504,'network'],
 [Object.assign(new Error('SECRET'),{details:{httpStatus:429,code:'usage_limit_reached',source:'upstream'}}),'quota',429,'upstream'],
 [Object.assign(new Error('SECRET'),{details:{httpStatus:429,code:'rate_limit_exceeded',source:'upstream'}}),'rate_limit',429,'upstream'],
 [Object.assign(new Error('SECRET'),{details:{httpStatus:401,code:'invalid_grant',source:'upstream'}}),'authentication',401,'upstream']];
 for(const [error,category,status,source] of cases){const r=classifyFailure(error,{requestId:'r1',stage:'connect'});assert.equal(r.category,category);assert.equal(r.httpStatus,status);assert.equal(r.source,source);assert.equal(r.requestId,'r1');assert.ok(!JSON.stringify(r).includes('SECRET'));assert.ok(r.nextAction);}
});
