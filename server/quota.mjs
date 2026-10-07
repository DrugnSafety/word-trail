import { randomUUID } from 'node:crypto';

const LEGACY_LEDGER_VERSION = 1;
const LEDGER_VERSION = 2;

export class QuotaStoreError extends Error {
  constructor(message = 'The usage ledger is temporarily unavailable.') {
    super(message);
    this.name = 'QuotaStoreError';
    this.code = 'quota_store_unavailable';
  }
}

export class QuotaUnavailableError extends Error {
  constructor(code = 'quota_unavailable') {
    super('The AI service is temporarily unavailable.');
    this.name = 'QuotaUnavailableError';
    this.code = code;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validIdentifier(value, maxLength = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function freshKeyState() {
  return { disabled: false, cooldownUntil: 0, days: {} };
}

function freshLedger(keyIds) {
  return {
    version: LEDGER_VERSION,
    cursor: 0,
    keys: Object.fromEntries(keyIds.map(id => [id, freshKeyState()])),
    cache: {},
    clients: {}
  };
}

function normalizeLedger(raw, keyIds) {
  if (raw === null) return freshLedger(keyIds);
  const legacyShape = isPlainObject(raw) && hasExactKeys(raw, ['cache', 'cursor', 'keys', 'version']);
  const currentShape = isPlainObject(raw) && hasExactKeys(raw, ['cache', 'clients', 'cursor', 'keys', 'version']);
  const validVersionShape = (legacyShape && raw.version === LEGACY_LEDGER_VERSION)
    || (currentShape && raw.version === LEDGER_VERSION);
  if (!validVersionShape || !isNonNegativeInteger(raw.cursor)
      || !isPlainObject(raw.keys) || !isPlainObject(raw.cache)) {
    throw new QuotaStoreError();
  }

  const keys = {};
  for (const [id, current] of Object.entries(raw.keys)) {
    if (!validIdentifier(id) || !isPlainObject(current)
        || !hasExactKeys(current, ['cooldownUntil', 'days', 'disabled'])
        || typeof current.disabled !== 'boolean' || !isNonNegativeInteger(current.cooldownUntil)
        || !isPlainObject(current.days)) throw new QuotaStoreError();
    const days = {};
    for (const [day, entry] of Object.entries(current.days)) {
      if (!validDay(day) || !isPlainObject(entry) || !hasExactKeys(entry, ['holds', 'used'])
          || !isNonNegativeInteger(entry.used) || !isPlainObject(entry.holds)) throw new QuotaStoreError();
      const holds = {};
      let accounted = entry.used;
      for (const [reservationId, amount] of Object.entries(entry.holds)) {
        if (!validIdentifier(reservationId) || !Number.isSafeInteger(amount) || amount <= 0
            || !Number.isSafeInteger(accounted + amount)) throw new QuotaStoreError();
        holds[reservationId] = amount;
        accounted += amount;
      }
      days[day] = { used: entry.used, holds };
    }
    keys[id] = { disabled: current.disabled, cooldownUntil: current.cooldownUntil, days };
  }
  if (keyIds.some(id => !Object.hasOwn(keys, id))) throw new QuotaStoreError();

  const cache = {};
  for (const [cacheKey, entry] of Object.entries(raw.cache)) {
    if (typeof cacheKey !== 'string' || !cacheKey || cacheKey.length > 256 || !isPlainObject(entry)
        || !hasExactKeys(entry, ['touchedAt', 'value']) || !isNonNegativeInteger(entry.touchedAt)) {
      throw new QuotaStoreError();
    }
    cache[cacheKey] = { value: clone(entry.value), touchedAt: entry.touchedAt };
  }
  const clients = {};
  if (currentShape) {
    if (!isPlainObject(raw.clients)) throw new QuotaStoreError();
    for (const [clientId, entry] of Object.entries(raw.clients)) {
      if (!validIdentifier(clientId) || !isPlainObject(entry)
          || !hasExactKeys(entry, ['days', 'minute', 'touchedAt'])
          || !Array.isArray(entry.minute) || !isPlainObject(entry.days)
          || !isNonNegativeInteger(entry.touchedAt)) throw new QuotaStoreError();
      const minute = [];
      for (const timestamp of entry.minute) {
        if (!isNonNegativeInteger(timestamp)) throw new QuotaStoreError();
        minute.push(timestamp);
      }
      const days = {};
      for (const [day, count] of Object.entries(entry.days)) {
        if (!validDay(day) || !isNonNegativeInteger(count)) throw new QuotaStoreError();
        days[day] = count;
      }
      clients[clientId] = { minute, days, touchedAt: entry.touchedAt };
    }
  }
  return {
    version: LEDGER_VERSION,
    cursor: raw.cursor,
    keys,
    cache,
    clients
  };
}

function localDay(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sumHolds(day) {
  return Object.values(day.holds).reduce((total, amount) => total + amount, 0);
}

function ensureActiveDay(ledger, activeDay, keyIds) {
  for (const id of keyIds) {
    if (!ledger.keys[id].days[activeDay]) ledger.keys[id].days[activeDay] = { used: 0, holds: {} };
  }
}

function pruneCache(cache, limit) {
  const entries = Object.entries(cache);
  if (entries.length <= limit) return;
  entries.sort((left, right) => left[1].touchedAt - right[1].touchedAt || left[0].localeCompare(right[0]));
  for (const [cacheKey] of entries.slice(0, entries.length - limit)) delete cache[cacheKey];
}

export function createQuotaManager({
  store,
  keyIds,
  dailyLimit = 1_000_000,
  timezone = 'America/New_York',
  now = () => new Date(),
  maxRetries = 12,
  cooldownMs = 60_000,
  cacheLimit = 500,
  requestMinuteLimit = 30,
  requestDailyLimit = 1_000,
  clientLimit = 10_000
} = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.compareAndSwap !== 'function') {
    throw new TypeError('store must implement read() and compareAndSwap(value, etag).');
  }
  if (!Array.isArray(keyIds) || keyIds.length === 0 || new Set(keyIds).size !== keyIds.length
      || keyIds.some(id => !validIdentifier(id))) {
    throw new TypeError('keyIds must be a non-empty list of unique strings.');
  }
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit <= 0) throw new TypeError('dailyLimit must be a positive integer.');
  if (!Number.isSafeInteger(maxRetries) || maxRetries <= 0) throw new TypeError('maxRetries must be a positive integer.');
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit <= 0) throw new TypeError('cacheLimit must be a positive integer.');
  if (!Number.isSafeInteger(requestMinuteLimit) || requestMinuteLimit <= 0) throw new TypeError('requestMinuteLimit must be a positive integer.');
  if (!Number.isSafeInteger(requestDailyLimit) || requestDailyLimit <= 0) throw new TypeError('requestDailyLimit must be a positive integer.');
  if (!Number.isSafeInteger(clientLimit) || clientLimit <= 0) throw new TypeError('clientLimit must be a positive integer.');
  localDay(new Date(0), timezone);

  async function transact(mutator) {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      let snapshot;
      try {
        snapshot = await store.read();
      } catch {
        throw new QuotaStoreError();
      }
      const instant = now();
      const day = localDay(instant, timezone);
      if (!isPlainObject(snapshot) || !Object.hasOwn(snapshot, 'value') || !Object.hasOwn(snapshot, 'etag')
          || (snapshot.etag !== null && typeof snapshot.etag !== 'string')) throw new QuotaStoreError();
      let ledger;
      try {
        ledger = normalizeLedger(snapshot.value, keyIds);
      } catch {
        throw new QuotaStoreError();
      }
      ensureActiveDay(ledger, day, keyIds);
      const outcome = mutator(ledger, { day, nowMs: instant.getTime() });
      if (outcome?.write === false) return outcome.result;
      let swapped;
      try {
        swapped = await store.compareAndSwap(ledger, snapshot?.etag ?? null);
      } catch {
        throw new QuotaStoreError();
      }
      if (swapped) return outcome?.result;
    }
    throw new QuotaStoreError();
  }

  async function reserve(amount, { excludeKeyIds = [] } = {}) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > dailyLimit) throw new QuotaUnavailableError();
    const excluded = new Set(excludeKeyIds);
    return transact((ledger, { day, nowMs }) => {
      let budgetBlocked = false;
      for (let offset = 0; offset < keyIds.length; offset += 1) {
        const index = (ledger.cursor + offset) % keyIds.length;
        const keyId = keyIds[index];
        const key = ledger.keys[keyId];
        const usage = key.days[day];
        if (excluded.has(keyId) || key.disabled || key.cooldownUntil > nowMs) continue;
        if (usage.used + sumHolds(usage) + amount > dailyLimit) {
          budgetBlocked = true;
          continue;
        }
        const reservationId = randomUUID();
        usage.holds[reservationId] = amount;
        ledger.cursor = (index + 1) % keyIds.length;
        return { result: Object.freeze({ keyId, reservationId, day, amount }) };
      }
      throw new QuotaUnavailableError(budgetBlocked ? 'daily_limit' : 'quota_unavailable');
    });
  }

  async function settle(reservation, totalTokens) {
    if (!Number.isSafeInteger(totalTokens) || totalTokens < 0) throw new TypeError('totalTokens must be a non-negative integer.');
    return transact(ledger => {
      const key = ledger.keys[reservation?.keyId];
      const usage = key?.days?.[reservation?.day];
      if (!usage || !(reservation?.reservationId in usage.holds)) return { write: false, result: false };
      if (totalTokens > usage.holds[reservation.reservationId]) {
        key.disabled = true;
        return { result: false };
      }
      if (!Number.isSafeInteger(usage.used + totalTokens)) {
        key.disabled = true;
        return { result: false };
      }
      delete usage.holds[reservation.reservationId];
      usage.used += totalTokens;
      return { result: true };
    });
  }

  async function disable(reservation) {
    return transact(ledger => {
      const key = ledger.keys[reservation?.keyId];
      if (!key) return { write: false, result: false };
      key.disabled = true;
      return { result: true };
    });
  }

  async function cooldown(reservation, retryAfterMs = cooldownMs) {
    const duration = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, 3_600_000) : cooldownMs;
    return transact((ledger, { nowMs }) => {
      const key = ledger.keys[reservation?.keyId];
      if (!key) return { write: false, result: false };
      key.cooldownUntil = Math.max(key.cooldownUntil, nowMs + duration);
      return { result: true };
    });
  }

  async function seedUsage(keyId, totalTokens) {
    if (!keyIds.includes(keyId)) throw new TypeError('Unknown key ID.');
    if (!Number.isSafeInteger(totalTokens) || totalTokens < 0) throw new TypeError('totalTokens must be a non-negative integer.');
    return transact((ledger, { day }) => {
      if (!Number.isSafeInteger(ledger.keys[keyId].days[day].used + totalTokens)) throw new QuotaStoreError();
      ledger.keys[keyId].days[day].used += totalTokens;
      return { result: true };
    });
  }

  async function getCached(cacheKey) {
    if (typeof cacheKey !== 'string' || !cacheKey) return null;
    return transact((ledger, { nowMs }) => {
      const entry = ledger.cache[cacheKey];
      if (!entry) return { write: false, result: null };
      entry.touchedAt = nowMs;
      return { result: clone(entry.value) };
    });
  }

  async function putCached(cacheKey, value) {
    if (typeof cacheKey !== 'string' || !cacheKey) throw new TypeError('cacheKey must be a non-empty string.');
    return transact((ledger, { nowMs }) => {
      ledger.cache[cacheKey] = { value: clone(value), touchedAt: nowMs };
      pruneCache(ledger.cache, cacheLimit);
      return { result: true };
    });
  }

  async function usageSummary() {
    return transact((ledger, { day }) => ({
      write: false,
      result: {
        day,
        timezone,
        dailyLimit,
        keys: keyIds.map(id => {
          const key = ledger.keys[id];
          const usage = key.days[day];
          const reserved = sumHolds(usage);
          return {
            id,
            used: usage.used,
            reserved,
            remaining: Math.max(0, dailyLimit - usage.used - reserved),
            disabled: key.disabled
          };
        })
      }
    }));
  }

  async function admitRequest(clientId) {
    if (!validIdentifier(clientId)) throw new TypeError('clientId must be a safe non-empty identifier.');
    return transact((ledger, { day, nowMs }) => {
      const minuteStart = Math.max(0, nowMs - 60_000);
      for (const [storedId, client] of Object.entries(ledger.clients)) {
        client.minute = client.minute.filter(timestamp => timestamp > minuteStart);
        for (const storedDay of Object.keys(client.days)) {
          if (storedDay !== day) delete client.days[storedDay];
        }
        if (client.minute.length === 0 && !Object.hasOwn(client.days, day)) delete ledger.clients[storedId];
      }

      let client = ledger.clients[clientId];
      if (!client) {
        if (Object.keys(ledger.clients).length >= clientLimit) throw new QuotaUnavailableError('rate_limit');
        client = { minute: [], days: {}, touchedAt: nowMs };
        ledger.clients[clientId] = client;
      }
      const dailyCount = client.days[day] ?? 0;
      if (client.minute.length >= requestMinuteLimit || dailyCount >= requestDailyLimit) {
        throw new QuotaUnavailableError('rate_limit');
      }
      client.minute.push(nowMs);
      client.days[day] = dailyCount + 1;
      client.touchedAt = nowMs;
      return { result: true };
    });
  }

  return Object.freeze({ reserve, settle, disable, cooldown, seedUsage, getCached, putCached, usageSummary, admitRequest });
}
