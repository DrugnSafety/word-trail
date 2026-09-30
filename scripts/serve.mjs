import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const requestPath = decodeURIComponent(url.pathname);
      const filename = path.resolve(root, `.${requestPath === '/' ? '/index.html' : requestPath}`);
      if (!filename.startsWith(root) || !['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(403).end('Forbidden'); return;
      }
      const info = await stat(filename);
      if (!info.isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cache-Control': 'no-cache'
      });
      res.end(req.method === 'HEAD' ? undefined : await readFile(filename));
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Not found');
    }
  });
}

export async function isWordTrailRunning(port, { get = http.get } = {}) {
  let deadline;
  try {
    const expected = await readFile(path.join(root, 'index.html'));
    return await new Promise(resolve => {
      const request = get({ hostname: '127.0.0.1', port, path: '/', timeout: 1500, agent: false }, response => {
        response.on('error', () => resolve(false));
        response.on('aborted', () => resolve(false));
        if (response.statusCode !== 200) {
          response.resume();
          request.destroy();
          resolve(false);
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > expected.length) {
            request.destroy();
            resolve(false);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks).equals(expected)));
      });
      deadline = setTimeout(() => { request.destroy(); resolve(false); }, 1500);
      request.on('error', () => resolve(false));
      request.on('timeout', () => { request.destroy(); resolve(false); });
    });
  } catch {
    return false;
  } finally {
    clearTimeout(deadline);
  }
}

export async function startServer({ port = Number(process.env.PORT || 4173), server = createAppServer(), checkExisting = isWordTrailRunning } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('포트는 1부터 65535 사이의 정수여야 합니다.');
  const url = `http://localhost:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        server.removeListener('listening', onListening);
        server.removeListener('error', onError);
      };
      const onListening = () => { cleanup(); resolve(); };
      const onError = error => { cleanup(); reject(error); };
      server.once('error', onError);
      server.once('listening', onListening);
      try { server.listen(port, '127.0.0.1'); } catch (error) { onError(error); }
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE' && await checkExisting(port)) return { url, reused: true, server: null };
    throw error;
  }
  return { url, reused: false, server };
}

export function serverErrorMessage(error, port) {
  if (error.code === 'EADDRINUSE') return `${port}번 포트가 사용 중이며 실행 중인 Word Trail을 확인하지 못했습니다. 기존 앱 창을 확인해 주세요.`;
  if (['EACCES', 'EPERM'].includes(error.code)) return '이 환경에는 로컬 서버를 실행할 권한이 없습니다.';
  return `Word Trail 실행 실패: ${error.message}`;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 4173);
  startServer({ port }).then(({ url, reused }) => {
    console.log(reused ? `이미 실행 중인 Word Trail: ${url}` : `Word Trail: ${url}`);
    if (process.argv.includes('--open') && process.platform === 'darwin') {
      const browser = spawn('open', [url], { stdio: 'ignore' });
      browser.on('error', () => console.log(`브라우저에서 직접 열어 주세요: ${url}`));
      browser.on('exit', code => { if (code) console.log(`브라우저에서 직접 열어 주세요: ${url}`); });
    }
  }).catch(error => {
    console.error(serverErrorMessage(error, port));
    process.exitCode = 1;
  });
}
