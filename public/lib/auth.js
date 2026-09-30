const AUTH_PREFIX = 'wordtrail:auth:v1:';

function cleanUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function storageFor(config) {
  return Object.hasOwn(config, 'storage') ? config.storage : (globalThis.localStorage || null);
}

function sessionView(raw) {
  if (!raw?.access_token || !raw?.user?.id) return null;
  return {
    user: { id: raw.user.id, email: raw.user.email || '' },
    access_token: raw.access_token,
  };
}

function errorMessage(payload, fallback) {
  return payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback;
}

export function createAuth(config = {}) {
  const supabaseUrl = cleanUrl(config.supabaseUrl);
  const anonKey = String(config.supabaseAnonKey || '');
  const configured = Boolean(supabaseUrl && anonKey);
  const fetcher = config.fetch || globalThis.fetch?.bind(globalThis);
  const storage = storageFor(config);
  const location = config.location || globalThis.location;
  const history = config.history || globalThis.history;
  const key = `${AUTH_PREFIX}${supabaseUrl || 'guest'}`;
  const listeners = new Set();
  let refreshPromise = null;
  let revision = 0;

  function readRaw() {
    if (!storage) return null;
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
  }

  function emit(raw) {
    const value = sessionView(raw);
    for (const listener of listeners) listener(value);
  }

  function writeRaw(raw, notify = true) {
    revision += 1;
    if (storage) {
      if (raw) storage.setItem(key, JSON.stringify(raw));
      else storage.removeItem(key);
    }
    if (notify) emit(raw);
  }

  async function request(path, options = {}) {
    if (!configured) throw new Error('계정 기능이 설정되지 않았습니다. 게스트 모드로 이용해 주세요.');
    if (!fetcher) throw new Error('이 브라우저에서는 계정 네트워크 요청을 사용할 수 없습니다.');
    const response = await fetcher(`${supabaseUrl}${path}`, {
      ...options,
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* empty response */ }
    if (!response.ok) throw new Error(errorMessage(payload, `계정 요청에 실패했습니다 (${response.status}).`));
    return payload;
  }

  function clearAuthCallback() {
    if (!configured || !location) return null;
    const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    const query = new URLSearchParams(String(location.search || '').replace(/^\?/, ''));
    const hasError = ['error', 'error_description'].some((name) => hash.has(name) || query.has(name));
    const authNames = ['access_token', 'refresh_token', 'token_hash', 'code', 'error', 'error_description', 'type'];
    const hasAuthPayload = authNames.some((name) => hash.has(name) || query.has(name));
    if (!hasAuthPayload) return null;
    for (const name of authNames) query.delete(name);
    const remainingQuery = query.toString();
    if (history?.replaceState) {
      history.replaceState(null, '', `${location.pathname || '/'}${remainingQuery ? `?${remainingQuery}` : ''}`);
    }
    return hasError ? 'error' : 'returned';
  }

  async function refresh(raw) {
    if (!raw?.refresh_token) {
      writeRaw(null);
      return null;
    }
    if (!refreshPromise) {
      const startRevision = revision;
      refreshPromise = request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: raw.refresh_token }),
      }).then((next) => {
        if (revision !== startRevision) return readRaw();
        writeRaw(next);
        return next;
      }).catch((error) => {
        if (revision === startRevision) writeRaw(null);
        throw error;
      }).finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  async function getSession() {
    if (!configured) return null;
    const raw = readRaw();
    if (!raw) return null;
    if (Number(raw.expires_at || 0) <= Math.floor(Date.now() / 1000) + 60) {
      return sessionView(await refresh(raw));
    }
    return sessionView(raw);
  }

  async function signUp(email, password) {
    const redirectTo = config.emailRedirectTo || (location ? `${location.origin}${location.pathname}` : undefined);
    const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    const payload = await request(`/auth/v1/signup${query}`, {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    if (payload?.access_token) writeRaw(payload);
    return { session: sessionView(payload), user: payload?.user ? { id: payload.user.id, email: payload.user.email || email } : null };
  }

  async function signIn(email, password) {
    const payload = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    writeRaw(payload);
    return sessionView(payload);
  }

  async function signOut() {
    const raw = readRaw();
    try {
      if (raw?.access_token) await request('/auth/v1/logout', {
        method: 'POST', headers: { Authorization: `Bearer ${raw.access_token}` },
      });
    } finally { writeRaw(null); }
  }

  async function deleteAccount() {
    const session = await getSession();
    if (!session) throw new Error('계정 삭제를 위해 다시 로그인해 주세요.');
    await request('/functions/v1/delete-account', {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: '{}',
    });
    try { storage?.removeItem(`wordtrail:cloud:${session.user.id}:v1`); } catch { /* optional cache */ }
    writeRaw(null);
  }

  function subscribe(listener) {
    listeners.add(listener);
    const onStorage = (event) => {
      if (event.key !== key) return;
      revision += 1;
      emit(readRaw());
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      listeners.delete(listener);
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }

  const confirmationStatus = clearAuthCallback();
  return {
    configured, getSession, subscribe, signUp, signIn, signOut, deleteAccount,
    confirmationStatus,
    config: { supabaseUrl, supabaseAnonKey: anonKey, fetch: config.fetch }, storage,
  };
}
