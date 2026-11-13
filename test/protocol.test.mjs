import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalog, requireModel, readResponseStream, verifyToolLoop } from '../src/protocol.mjs';

function stream(events, bytesPerChunk = 7) {
  const bytes = Buffer.from(events.map(e => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) { for (let i=0; i<bytes.length; i+=bytesPerChunk) controller.enqueue(bytes.subarray(i,i+bytesPerChunk)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
test('dynamic catalog preserves every server slug and never marks discovery as validated', () => {
  const c = normalizeCatalog({ models: [{ slug: 'new-model-2030', display_name: '新模型', visibility: 'list', input_modalities: ['image','text'] }, { slug: 'hidden', visibility: 'hidden' }] });
  assert.equal(c.length, 2);
  assert.equal(c[0].slug, 'new-model-2030');
  assert.equal(c[0].verification, 'unverified');
  assert.deepEqual(c[0].declared.input_modalities, ['image', 'text']);
  assert.equal(c[1].selectable, false);
  assert.throws(() => requireModel(c, 'missing'), /unknown/);
  assert.equal(requireModel(c, 'new-model-2030').slug, 'new-model-2030');
  assert.throws(() => normalizeCatalog({ data: [] }), /catalog/);
  assert.throws(() => normalizeCatalog({ models: [{ slug: 'a' }, { slug: 'a' }] }), /duplicate/);
});
test('model catalog only exposes capability metadata, never server prompt templates', () => {
  const [model] = normalizeCatalog({ models: [{ slug:'future', visibility:'list', input_modalities:['text'], model_messages:{instructions_template:'private server template'}, base_instructions:'untrusted instructions', supports_parallel_tool_calls:true }] });
  assert.equal(model.declared.supports_parallel_tool_calls,true);
  assert.equal(JSON.stringify(model).includes('private server template'),false);
  assert.equal(JSON.stringify(model).includes('untrusted instructions'),false);
});
test('SSE handles UTF-8, split CRLF and interleaved streaming arguments until completion', async () => {
  const output = [{ type: 'function_call', id: 'f1', call_id: 'c1', name: 'echo', namespace: 'modelbridge', arguments: '{"text":"中文"}' }];
  const result = await readResponseStream(stream([
    { type: 'response.output_item.added', output_index: 0, item: { ...output[0], arguments: '' } },
    { type: 'response.function_call_arguments.delta', item_id: 'f1', output_index: 0, delta: '{"text":' },
    { type: 'response.function_call_arguments.delta', item_id: 'f1', output_index: 0, delta: '"中文"}' },
    { type: 'response.completed', response: { id: 'r1', status: 'completed', output } },
  ], 1));
  assert.deepEqual(result.output, output);
  assert.equal(result.stream.argumentDeltas, 2);
});
test('SSE does not mistake truncated, failed or incomplete streams for success', async () => {
  await assert.rejects(() => readResponseStream(stream([{ type: 'response.output_text.delta', delta: 'partial' }])), /interrupted/);
  await assert.rejects(() => readResponseStream(stream([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])), /subscription_sharing_usage_limit_exceeded/);
  await assert.rejects(() => readResponseStream(stream([{ type: 'response.incomplete', response: { status: 'incomplete' } }])), /incomplete/);
  await assert.rejects(() => readResponseStream(new Response('oops', { status: 401 })), /HTTP 401/);
});
test('unexpected content type records safe response shape without exposing payload', async () => {
  await assert.rejects(() => readResponseStream(Response.json({ error: { code: 'unsupported', message: 'private body' } }, { headers: { 'x-request-id': 'req_test' } })), error => {
    assert.equal(error.details.contentType, 'application/json');
    assert.equal(error.details.code, 'unsupported');
    assert.equal(JSON.stringify(error.details).includes('private body'), false);
    return true;
  });
});
test('valid completed SSE is accepted without a Content-Type header and records the deviation', async () => {
  const fixture = stream([{ type:'response.completed', response:{ status:'completed', output:[] } }]);
  const result = await readResponseStream(new Response(await fixture.arrayBuffer()));
  assert.equal(result.status, 'completed');
  assert.equal(result.stream.missingContentType, true);
  await assert.rejects(() => readResponseStream(new Response(Buffer.from('{"status":"completed"}'))), /interrupted/);
});
test('tool probe returns exact results with original reasoning/call state on the next request', async () => {
  let round = 0;
  const reasoning = { type: 'reasoning', id: 'reason', encrypted_content: 'opaque', summary: [] };
  const calls = [{ type: 'function_call', id: 'f1', call_id: 'c1', name: 'echo', namespace: 'modelbridge', arguments: '{"text":"MODELBRIDGE_OK"}' }, { type: 'function_call', id: 'f2', call_id: 'c2', name: 'echo', namespace: 'modelbridge', arguments: '{"text":"SECOND"}' }];
  const result = await verifyToolLoop({ model: 'chosen', request: async body => {
    assert.equal(body.model, 'chosen'); assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.equal('previous_response_id' in body, false);
    if (round++ === 0) return { output: [reasoning,...calls], stream: { argumentDeltas: 3 } };
    assert.deepEqual(body.input.slice(1,4), [reasoning,...calls]);
    assert.deepEqual(body.input.slice(4), [{ type: 'function_call_output', call_id: 'c1', output: '{"text":"MODELBRIDGE_OK"}' }, { type: 'function_call_output', call_id: 'c2', output: '{"text":"SECOND"}' }]);
    return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'MODELBRIDGE_OK' }] }], stream: { argumentDeltas: 0 } };
  }});
  assert.equal(result.status, 'passed'); assert.equal(result.calls, 2); assert.equal(result.rounds, 2);
});
test('tool probe refuses unadvertised execution and stops at bounded rounds', async () => {
  await assert.rejects(() => verifyToolLoop({ model: 'x', request: async () => ({ output: [{ type: 'function_call', call_id: 'c', name: 'shell', arguments: '{}' }] }) }), /unexpected tool/);
  await assert.rejects(() => verifyToolLoop({ model: 'x', maxRounds: 2, request: async () => ({ output: [{ type: 'function_call', call_id: 'c', namespace: 'modelbridge', name: 'echo', arguments: '{"text":"x"}' }] }) }), /duplicate|round/);
});
