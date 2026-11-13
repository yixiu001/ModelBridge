export function normalizeCatalog(payload) {
  if (!Array.isArray(payload?.models)) throw new Error('unexpected model catalog format');
  const seen = new Set();
  return payload.models.map(model => {
    if (typeof model.slug !== 'string' || !model.slug || model.slug.length > 256) throw new Error('invalid catalog model slug');
    if (seen.has(model.slug)) throw new Error('duplicate catalog slug');
    seen.add(model.slug);
    const capabilityKeys = ['input_modalities','output_modalities','supports_parallel_tool_calls','tool_mode','supported_in_api','default_reasoning_level','supported_reasoning_levels','supports_reasoning_effort_updates','context_window','max_context_window','support_verbosity','default_verbosity','supports_image_detail_original','web_search_tool_type','apply_patch_tool_type','minimal_client_version'];
    const declared = Object.fromEntries(capabilityKeys.filter(key => Object.hasOwn(model,key)).map(key => [key,structuredClone(model[key])]));
    return { slug: model.slug, displayName: model.display_name || model.slug, visibility: model.visibility ?? 'unknown', selectable: model.visibility === 'list', verification: 'unverified', declared };
  });
}
export function requireModel(catalog, slug) {
  const model = catalog.find(m => m.slug === slug);
  if (!model) throw new Error('unknown model; refresh catalog, no fallback applied');
  if (!model.selectable) throw new Error('model is not selectable in this account catalog');
  return model;
}
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.:/\[\]-]{1,180}$/.test(value) ? value : undefined;
export async function httpFailure(response) {
  let data;
  try { data = JSON.parse((await response.text()).slice(0, 100_000)); } catch { data = {}; }
  const code = safeCode(data?.error?.code) || safeCode(typeof data?.error === 'string' ? data.error : null) || 'upstream_error';
  const error = new Error(`HTTP ${response.status}: ${code}`);
  error.details = { httpStatus: response.status, code, param: safeCode(data?.error?.param), requestId: safeCode(response.headers.get('x-request-id')), bodyShape: data?.detail ? 'detail' : data?.error ? 'error' : 'other' };
  return error;
}
export async function readResponseStream(response, { signal, onEvent } = {}) {
  if (!response.ok) throw await httpFailure(response);
  if (response.headers.get('content-type') && !response.headers.get('content-type').includes('text/event-stream')) {
    const contentType = response.headers.get('content-type');
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = null; }
    const error = new Error('expected SSE response');
    error.details = { httpStatus: response.status, contentType, requestId: safeCode(response.headers.get('x-request-id')), bytes: Buffer.byteLength(text), bodyKeys: body && typeof body === 'object' ? Object.keys(body).map(safeCode).filter(Boolean) : [], code: safeCode(body?.error?.code), bodyStatus: safeCode(body?.status), bodyObject: safeCode(body?.object), looksLikeSSE: text.trimStart().startsWith('event:') || text.trimStart().startsWith('data:') };
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', total = 0, completed;
  const stats = { argumentDeltas: 0, textDeltas: 0, events: 0, missingContentType: !response.headers.get('content-type') };
  const argumentsByItem = new Map();
  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  function event(frame) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const e = JSON.parse(data); stats.events++;
    if (e.type === 'response.function_call_arguments.delta') {
      if (typeof e.delta !== 'string') throw new Error('invalid argument delta');
      stats.argumentDeltas++;
      const key = e.item_id ?? e.output_index;
      argumentsByItem.set(key, (argumentsByItem.get(key) || '') + e.delta);
    }
    if (e.type === 'response.output_text.delta') stats.textDeltas++;
    if (e.type === 'response.failed' || e.type === 'error') {
      const code = safeCode(e.response?.error?.code || e.code) || 'response.failed';
      const error = new Error(code); error.details = { code, requestId: safeCode(response.headers.get('x-request-id')) }; throw error;
    }
    if (e.type === 'response.incomplete') throw new Error('response.incomplete');
    if (e.type === 'response.completed') {
      if (e.response?.status !== 'completed' || !Array.isArray(e.response.output)) throw new Error('invalid completed response');
      for (const [i, item] of e.response.output.entries()) {
        if (item.type !== 'function_call') continue;
        const accumulated = argumentsByItem.get(item.id) ?? argumentsByItem.get(i);
        if (accumulated !== undefined && accumulated !== item.arguments) throw new Error('streamed tool arguments mismatch');
      }
      completed = { ...e.response, stream: stats };
    }
    onEvent?.(e);
  }
  try {
    while (!completed) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 16*1024*1024) throw new Error('response exceeds verification size limit');
      buffer += decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        event(frame);
        if (completed) break;
      }
    }
    signal?.throwIfAborted();
    if (!completed) throw new Error('stream interrupted before response.completed');
    return completed;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export const ECHO_TOOLS = [{ type: 'namespace', name: 'modelbridge', description: 'Safe local verification functions. No filesystem or network access.', tools: [{ type: 'function', name: 'echo', description: 'Return the supplied text unchanged.', strict: true, parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] }];
export function outputText(response) {
  return response.output.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
}
export async function verifyToolLoop({ model, request, maxRounds = 4, signal }) {
  const input = [{ role: 'user', content: 'Call modelbridge.echo with text MODELBRIDGE_OK. After receiving the tool result, reply with exactly MODELBRIDGE_OK. This is a safe tool round-trip test.' }];
  const seen = new Set();
  let calls = 0, argumentDeltas = 0;
  for (let round=1; round<=maxRounds; round++) {
    signal?.throwIfAborted();
    const response = await request({ model, input: structuredClone(input), tools: ECHO_TOOLS, store: false, stream: true, include: ['reasoning.encrypted_content'] });
    argumentDeltas += response.stream?.argumentDeltas || 0;
    const toolCalls = response.output.filter(item => item.type === 'function_call');
    if (response.output.some(item => item.type === 'custom_tool_call')) throw new Error('unexpected tool type');
    if (!toolCalls.length) {
      if (!calls) throw new Error('model did not call the verification tool');
      if (outputText(response).trim() !== 'MODELBRIDGE_OK') throw new Error('tool result was not confirmed in final answer');
      return { status: 'passed', model, rounds: round, calls, argumentDeltas, final: 'MODELBRIDGE_OK', scope: 'local echo loop; WorkBuddy not tested' };
    }
    input.push(...response.output);
    for (const call of toolCalls) {
      signal?.throwIfAborted();
      if (call.name !== 'echo' || call.namespace !== 'modelbridge') throw new Error('unexpected tool; execution refused');
      if (typeof call.call_id !== 'string' || !call.call_id || seen.has(call.call_id)) throw new Error('duplicate or invalid call_id');
      if (++calls > 12) throw new Error('tool call limit reached');
      seen.add(call.call_id);
      let args;
      try { args = JSON.parse(call.arguments); } catch { throw new Error('invalid tool JSON arguments'); }
      if (!args || typeof args.text !== 'string' || args.text.length > 4096 || Object.keys(args).length !== 1) throw new Error('invalid echo arguments');
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ text: args.text }) });
    }
  }
  throw new Error('tool verification round limit reached');
}
