import { getAiRuntime } from '../server/runtime.mjs';
import { readJsonBody, requestClientId, sameSite, sendJson } from '../server/http.mjs';

export function createMeaningHandler(runtimeFactory = getAiRuntime) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { error: 'method_not_allowed' }); }
    if (!sameSite(req)) return sendJson(res, 403, { error: 'forbidden' });
    let body;
    try {
      body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.term !== 'string' || !body.term.trim() || body.term.length > 160 || (body.context !== undefined && typeof body.context !== 'string') || (body.context?.length || 0) > 1000) throw new Error();
    } catch { return sendJson(res, 400, { error: 'invalid_request' }); }
    try {
      const clientId = requestClientId(req);
      const runtime = runtimeFactory();
      await runtime.quota.admitRequest(clientId);
      const result = await runtime.service.getMeaning({ term: body.term, context: body.context || '' });
      return sendJson(res, 200, result);
    } catch (error) {
      const quota = ['daily_limit', 'quota_exhausted', 'budget_exhausted'].includes(error.code);
      if (error.code === 'rate_limit') { res.setHeader('Retry-After', '60'); return sendJson(res, 429, { error: 'rate_limit' }); }
      return sendJson(res, quota ? 429 : 503, { error: quota ? 'daily_limit' : 'temporarily_unavailable' });
    }
  };
}
export default createMeaningHandler();
