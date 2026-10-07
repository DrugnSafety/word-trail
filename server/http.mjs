import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export function requestClientId(req, { vercel = process.env.VERCEL === '1' } = {}) {
  // Vercel overwrites these headers to prevent client IP spoofing. Local mode uses the socket only.
  const address = vercel ? req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for'] : req.socket?.remoteAddress;
  if (typeof address !== 'string' || !isIP(address.trim())) throw new Error('untrusted_client');
  return createHash('sha256').update(`word-trail:ai-client:${address.trim()}`).digest('hex');
}

export function sendJson(res, status, value) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.statusCode = status;
  res.end(JSON.stringify(value));
}

export function sameSite(req) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['https:', 'http:'].includes(url.protocol) && url.host === req.headers.host;
  } catch { return false; }
}

export async function readJsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) throw new Error('invalid_request');
  if (Number(req.headers?.['content-length']) > 4096) throw new Error('invalid_request');
  if (req.body !== undefined) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (Buffer.byteLength(JSON.stringify(body)) > 4096) throw new Error('invalid_request');
    return body;
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 4096) throw new Error('invalid_request');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
