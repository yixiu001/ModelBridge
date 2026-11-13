import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectAccountState} from '../src/account-state.mjs';
import {StandaloneService} from '../src/standalone-service.mjs';
test('inference and quota health remain independent and do not expose tokens',()=>{
 const a={access_token:'SECRET',expiresAt:2000,quotaAuth:{access_token:'QUOTA_SECRET',expiresAt:500}};
 const r=projectAccountState(a,{accountKey:'a',inferenceVerifiedAt:'proof'},1000);
 assert.equal(r.inference.state,'ready');assert.equal(r.quota.state,'expired');assert.equal(r.credentialRevision,1);assert.equal(r.inference.lastVerifiedAt,'proof');assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('terminal refresh rejection requests sign-in while transient failures allow retry',()=>{
 const a={access_token:'secret',expiresAt:0,refreshError:{httpStatus:401,code:'invalid_grant'}};
 assert.equal(projectAccountState(a,{},1000).inference.state,'sign_in_required');
 a.refreshError={httpStatus:502,code:'network_error'};
 assert.equal(projectAccountState(a,{},1000).inference.state,'refresh_failed');
 assert.equal(projectAccountState(a,{},1000).quota.state,'missing');
});
test('targeted login binds the requested account and cancelling leaves both grants intact',()=>{
 const s=new StandaloneService({dataDir:'.local/unused'});s.hostId='host';
 s.vault={active:'a',accounts:{a:{subject:'a',client_id:'ca',access_token:'A'},b:{subject:'b',client_id:'cb',access_token:'B',quotaAuth:{access_token:'Q'}}}};
 const before=structuredClone(s.vault);
 s.startLogin('http://127.0.0.1:43821/auth/callback',false,'b');
 assert.equal(s.pending.account.subject,'b');assert.equal(s.pending.targetAccountKey,'b');
 s.cancelLogin();assert.deepEqual(s.vault,before);
});
