import { writeFile } from 'node:fs/promises';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) throw new Error('Set both SUPABASE_URL and SUPABASE_ANON_KEY.');
if (!supabaseUrl) {
  console.log('Using existing public/config.js; account backend settings were not provided.');
} else {
  const parsed = new URL(supabaseUrl);
  if (parsed.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS.');
  if (supabaseAnonKey.startsWith('sb_secret_')) throw new Error('Never publish a Supabase secret key.');
  if (supabaseAnonKey.startsWith('eyJ')) {
    const payload = JSON.parse(Buffer.from(supabaseAnonKey.split('.')[1], 'base64url').toString());
    if (payload.role !== 'anon') throw new Error('Only the Supabase anon key can be published.');
  } else if (!supabaseAnonKey.startsWith('sb_publishable_')) throw new Error('Use a Supabase publishable or anon key.');
  await writeFile(new URL('../public/config.js', import.meta.url), `// Public Supabase project settings.\nwindow.WORD_TRAIL_CONFIG = ${JSON.stringify({ supabaseUrl, supabaseAnonKey }, null, 2)};\n`);
  console.log('Public account backend configuration generated.');
}
