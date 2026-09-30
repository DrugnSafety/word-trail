const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = request.headers.get('Authorization') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!authorization.startsWith('Bearer ') || !supabaseUrl || !anonKey || !serviceRole) {
    return json({ error: 'unauthorized' }, 401);
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!userResponse.ok) return json({ error: 'unauthorized' }, 401);
  const user = await userResponse.json();
  if (!user?.id) return json({ error: 'unauthorized' }, 401);

  const deletion = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole },
  });
  if (!deletion.ok) {
    const detail = await deletion.text();
    console.error('Auth account deletion failed', deletion.status, detail);
    return json({ error: 'delete_failed' }, 502);
  }
  return json({ deleted: true }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
