import { getAiRuntime } from '../server/runtime.mjs';
import { sameSite, sendJson } from '../server/http.mjs';

export function createUsageHandler(runtimeFactory = getAiRuntime) {
  return async function handler(req, res) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendJson(res, 405, { error: 'method_not_allowed' }); }
    if (!sameSite(req)) return sendJson(res, 403, { error: 'forbidden' });
    try { return sendJson(res, 200, await runtimeFactory().quota.usageSummary()); }
    catch { return sendJson(res, 503, { error: 'temporarily_unavailable' }); }
  };
}
export default createUsageHandler();
