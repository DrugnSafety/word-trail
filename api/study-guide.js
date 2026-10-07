import { getAiRuntime } from '../server/runtime.mjs';
import { readJsonBody, requestClientId, sameSite, sendJson } from '../server/http.mjs';

export function createStudyGuideHandler(runtimeFactory = getAiRuntime) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { error: 'method_not_allowed' }); }
    if (!sameSite(req)) return sendJson(res, 403, { error: 'forbidden' });
    let body;
    try {
      body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !['word', 'sentence'].includes(body.kind) || typeof body.text !== 'string'
          || !body.text.trim() || body.text.length > (body.kind === 'word' ? 160 : 500) || (body.context !== undefined && typeof body.context !== 'string')
          || (body.context?.length || 0) > 1_000 || Object.keys(body).some(key => !['kind', 'text', 'context'].includes(key))) throw new Error();
    } catch { return sendJson(res, 400, { error: 'invalid_request' }); }
    try {
      const runtime = runtimeFactory();
      await runtime.quota.admitRequest(requestClientId(req));
      return sendJson(res, 200, await runtime.studyService.getStudyGuide({ ...body, context: body.context || '' }));
    } catch (error) {
      if (error.code === 'invalid_input') return sendJson(res, 400, { error: 'invalid_request' });
      if (error.code === 'rate_limit') { res.setHeader('Retry-After', '60'); return sendJson(res, 429, { error: 'rate_limit' }); }
      const limited = ['daily_limit', 'quota_exhausted', 'budget_exhausted'].includes(error.code);
      return sendJson(res, limited ? 429 : 503, { error: limited ? 'daily_limit' : 'temporarily_unavailable' });
    }
  };
}
export default createStudyGuideHandler();
