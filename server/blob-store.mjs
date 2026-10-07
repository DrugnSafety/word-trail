import { randomUUID } from 'node:crypto';

// Isolate the versioned wire protocol used by Vercel's official Blob client.
// Private origin reads bypass the CDN; conditional writes never overwrite a newer ledger.
// Protocol reference: vercel/storage packages/blob/src/{api,put-helpers,get}.ts.
export function createBlobLedgerStore({ token, pathname = 'word-trail/ai-ledger-v1.json', fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const storeId = String(token || '').match(/^vercel_blob_rw_([A-Za-z0-9]+)_/)?.[1];
  if (!storeId || !/^[a-zA-Z0-9/_-]+\.json$/.test(pathname)) throw new Error('AI usage storage is not configured.');
  const readUrl = `https://${storeId.toLowerCase()}.private.blob.vercel-storage.com/${pathname}?cache=0`;
  return {
    async read() {
      const response = await fetchImpl(readUrl, {
        headers: { Authorization: `Bearer ${token}`, 'accept-encoding': 'identity' },
        cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), redirect: 'error'
      });
      if (response.status === 404) return { value: null, etag: null };
      if (!response.ok) throw new Error('AI usage storage could not be read.');
      const etag = response.headers.get('etag');
      if (!etag || etag.startsWith('W/')) throw new Error('AI usage storage returned no version.');
      const body = await response.text();
      if (Buffer.byteLength(body) > 4_000_000) throw new Error('AI usage storage is too large.');
      return { value: JSON.parse(body), etag };
    },
    async compareAndSwap(value, etag) {
      const body = JSON.stringify(value);
      if (Buffer.byteLength(body) > 4_000_000) throw new Error('AI usage storage is too large.');
      const headers = {
        Authorization: `Bearer ${token}`, 'x-api-version': '12',
        'x-vercel-blob-store-id': storeId,
        'x-api-blob-request-id': `${storeId}:${randomUUID()}`,
        'x-api-blob-request-attempt': '0', 'x-vercel-blob-access': 'private',
        'x-content-type': 'application/json', 'x-add-random-suffix': '0',
        'x-allow-overwrite': etag ? '1' : '0', 'x-cache-control-max-age': '60'
      };
      if (etag) headers['x-if-match'] = etag;
      const response = await fetchImpl(`https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`, {
        method: 'PUT', headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'error'
      });
      if (response.status === 412) return false;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.error?.code === 'precondition_failed' || (!etag && data.error?.code === 'blob_already_exists')) return false;
        throw new Error('AI usage storage could not be updated.');
      }
      const result = await response.json();
      if (!result.etag || result.pathname !== pathname) throw new Error('AI usage storage returned an invalid write.');
      return true;
    }
  };
}
