import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(root, 'public');
const outputDir = path.join(root, 'deployment');
const archive = path.join(outputDir, 'word-trail-web.zip');
const temporaryArchive = path.join(outputDir, 'word-trail-web.pending.zip');

async function collect(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`배포 파일은 일반 파일이어야 합니다: ${relative}`);
  }
  return files.sort();
}

const files = await collect(publicDir);
for (const required of ['index.html', 'app.js', 'styles.css', 'config.js', '_headers', 'data/catalog.json']) {
  if (!files.includes(required)) throw new Error(`배포 필수 파일 누락: ${required}`);
}
if (files.length > 1000) throw new Error('Cloudflare 화면 업로드의 파일 수 한도를 초과했습니다. CLI 배포를 사용하세요.');
for (const file of files) {
  if ((await stat(path.join(publicDir, file))).size > 25 * 1024 * 1024) throw new Error(`25 MiB 파일 한도 초과: ${file}`);
}

await mkdir(outputDir, { recursive: true });
await rm(temporaryArchive, { force: true });
const zipped = spawnSync('zip', ['-q', '-X', temporaryArchive, '-@'], {
  cwd: publicDir, input: `${files.join('\n')}\n`, encoding: 'utf8'
});
if (zipped.error || zipped.status !== 0) throw new Error(zipped.error?.message || zipped.stderr || 'ZIP 생성 실패');
await rename(temporaryArchive, archive);
await writeFile(path.join(outputDir, 'files.txt'), `${files.join('\n')}\n`);
console.log(`Hosting archive: ${archive}\n${files.length} files; ${(await stat(archive)).size} bytes`);
