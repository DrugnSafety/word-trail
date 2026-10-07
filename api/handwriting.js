import { getAiRuntime } from '../server/runtime.mjs';
import { readJsonBody, requestClientId, sameSite, sendJson } from '../server/http.mjs';

export function createHandwritingHandler(runtimeFactory = getAiRuntime) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { error: 'method_not_allowed' }); }
    if (!sameSite(req)) return sendJson(res, 403, { error: 'forbidden' });
    let body;
    try {
      body = await readJsonBody(req, 512 * 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.image !== 'string' || !['letter', 'word'].includes(body.mode)
          || Object.keys(body).some(key => !['image', 'mode'].includes(key))) throw new Error();
    } catch { return sendJson(res, 400, { error: 'invalid_request' }); }
    try {
      const runtime = runtimeFactory();
      await runtime.quota.admitRequest(requestClientId(req));
      return sendJson(res, 200, await runtime.studyService.recognizeHandwriting(body));
    } catch (error) {
      if (error.code === 'invalid_input') return sendJson(res, 400, { error: 'invalid_request' });
      if (error.code === 'rate_limit') { res.setHeader('Retry-After', '60'); return sendJson(res, 429, { error: 'rate_limit' }); }
      const limited = ['daily_limit', 'quota_exhausted', 'budget_exhausted'].includes(error.code);
      return sendJson(res, limited ? 429 : 503, { error: limited ? 'daily_limit' : 'temporarily_unavailable' });
    }
  };
}
export default createHandwritingHandler();
