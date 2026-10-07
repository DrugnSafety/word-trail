import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function files(dir) {
  const results = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await files(filename));
    else if (/\.(m?js)$/.test(entry.name)) results.push(filename);
  }
  return results;
}
let failed = false;
const scripts = (await Promise.all(['public', 'scripts', 'tests', 'server', 'api'].map(files))).flat();
for (const filename of scripts) {
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(result.stderr); failed = true; }
}
console.log(`Syntax checked ${scripts.length} JavaScript files.`);
process.exitCode = failed ? 1 : 0;
