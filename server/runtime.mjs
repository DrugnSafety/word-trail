import { createBlobLedgerStore } from './blob-store.mjs';
import { createAiMeaningService } from './ai-service.mjs';
import { createQuotaManager } from './quota.mjs';

let runtime;
export function createAiRuntime(env = process.env) {
  let keys;
  try { keys = JSON.parse(env.OPENAI_KEYS_JSON || '[]'); } catch { throw new Error('AI is not configured.'); }
  if (!Array.isArray(keys) || !keys.length || keys.some(item => !/^key-[1-9]\d*$/.test(item?.id) || !/^sk-/.test(item?.key))) throw new Error('AI is not configured.');
  if (new Set(keys.map(item => item.id)).size !== keys.length) throw new Error('AI is not configured.');
  const store = createBlobLedgerStore({ token: env.BLOB_READ_WRITE_TOKEN });
  const settings = { store, keyIds: keys.map(item => item.id), dailyLimit: 1_000_000, timezone: 'America/New_York' };
  return { service: createAiMeaningService({ ...settings, keys }), quota: createQuotaManager(settings), store };
}
export function getAiRuntime() { return runtime ||= createAiRuntime(); }
