'use strict';
/**
 * Main-process RomM HTTP client.
 *
 * All network I/O to the RomM server runs here, never in the renderer:
 *   - no CORS problems, so the BrowserWindow keeps webSecurity enabled
 *   - bearer tokens never enter renderer memory / DevTools
 *   - JSON parsing of large ROM lists happens off the React render thread
 *   - a persistent Electron session partition keeps RomM session cookies
 *
 * Supported auth methods (https://docs.romm.app/latest/developers/api-authentication/):
 *   token    - Client API Token `rmm_...` sent as `Authorization: Bearer rmm_...`
 *   oauth    - OAuth2 password grant on POST /api/token, auto refresh via refresh_token
 *   session  - cookie session (POST /api/auth/login, or legacy POST /api/login + Basic)
 */
const { URL, URLSearchParams } = require('url');

const CRED_KEY = 'romm.credentials';
const OAUTH_SCOPES = [
  'me.read',
  'roms.read',
  'roms.user.read',
  'roms.user.write',
  'platforms.read',
  'assets.read',
  'assets.write',
  'firmware.read',
  'collections.read',
].join(' ');

const DEFAULT_TIMEOUT_MS = 20000;

function normalizeBaseUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('Server URL is empty');
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  const u = new URL(raw);
  // Strip trailing slash and any accidental /api suffix.
  let pathname = u.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/api')) pathname = pathname.slice(0, -4);
  return `${u.protocol}//${u.host}${pathname}`;
}

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.authRequired = true;
  }
}

class RommClient {
  /**
   * @param {{ secureStore: import('./secureStore.cjs').SecureStore, getSession: () => Electron.Session, onAuthRequired: (info: any) => void, log: (...a: any[]) => void }} deps
   */
  constructor({ secureStore, getSession, onAuthRequired, log }) {
    this.secure = secureStore;
    this.getSession = getSession;
    this.onAuthRequired = onAuthRequired;
    this.log = log || (() => {});
    this.refreshPromise = null;
  }

  // ------------------------------------------------------------ credentials
  getCreds() {
    return this.secure.get(CRED_KEY);
  }

  saveCreds(creds) {
    this.secure.set(CRED_KEY, { ...creds, savedAt: Date.now() });
  }

  status() {
    const c = this.getCreds();
    if (!c || !c.baseUrl) return { authenticated: false, baseUrl: null, method: null, username: null };
    const refreshExpired = c.method === 'oauth' && c.refreshExpiresAt && c.refreshExpiresAt < Date.now() && !c.password;
    return {
      authenticated: !refreshExpired,
      baseUrl: c.baseUrl,
      method: c.method,
      username: c.username || null,
      rememberPassword: Boolean(c.password),
      storage: this.secure.describe().backend,
    };
  }

  async logout() {
    const c = this.getCreds();
    if (c && c.baseUrl && c.method === 'session') {
      try {
        await this.rawFetch(`${c.baseUrl}/api/auth/logout`, { method: 'POST' }, 5000);
      } catch {
        /* ignore */
      }
    }
    this.secure.delete(CRED_KEY);
    try {
      await this.getSession().clearStorageData({ storages: ['cookies'] });
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  // ------------------------------------------------------------ low level
  async rawFetch(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const ses = this.getSession();
    const signal = init.signal || AbortSignal.timeout(timeoutMs);
    return ses.fetch(url, { ...init, signal, credentials: 'include' });
  }

  authHeaders(creds) {
    if (!creds) return {};
    if (creds.method === 'token' && creds.clientToken) return { Authorization: `Bearer ${creds.clientToken}` };
    if (creds.method === 'oauth' && creds.accessToken) return { Authorization: `Bearer ${creds.accessToken}` };
    return {}; // session: cookie jar handles it
  }

  // ------------------------------------------------------------ login flows
  /** Unauthenticated probe: /api/heartbeat returns the server version. */
  async testServer(baseUrlInput) {
    let baseUrl;
    try {
      baseUrl = normalizeBaseUrl(baseUrlInput);
    } catch (e) {
      return { ok: false, message: e.message };
    }
    try {
      const res = await this.rawFetch(`${baseUrl}/api/heartbeat`, {}, 8000);
      if (!res.ok) return { ok: false, baseUrl, message: `Server answered HTTP ${res.status} on /api/heartbeat` };
      const data = await res.json().catch(() => ({}));
      const version = (data && data.SYSTEM && data.SYSTEM.VERSION) || data.VERSION || 'unknown';
      return { ok: true, baseUrl, version, message: `RomM ${version} reachable` };
    } catch (e) {
      return { ok: false, baseUrl, message: `Cannot reach ${baseUrl}: ${e.message}` };
    }
  }

  async verify(creds) {
    const res = await this.rawFetch(`${creds.baseUrl}/api/users/me`, { headers: this.authHeaders(creds) }, 10000);
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(res.status, res.status === 401 ? 'Credentials rejected by RomM' : 'Token is missing required scopes (403)');
    }
    if (!res.ok) throw new Error(`RomM /api/users/me returned HTTP ${res.status}`);
    const me = await res.json().catch(() => ({}));
    return me;
  }

  async loginWithToken({ baseUrl: rawUrl, token }) {
    const baseUrl = normalizeBaseUrl(rawUrl);
    const clientToken = String(token || '').trim();
    if (!clientToken) return { ok: false, message: 'Token is empty' };
    if (!clientToken.startsWith('rmm_')) {
      this.log('[auth] token does not start with rmm_, trying anyway');
    }
    const creds = { baseUrl, method: 'token', clientToken };
    try {
      const me = await this.verify(creds);
      this.saveCreds({ ...creds, username: me.username || null });
      return { ok: true, username: me.username || null, message: `Signed in as ${me.username || 'token user'}` };
    } catch (e) {
      return { ok: false, status: e.status, message: e.message };
    }
  }

  /** Exchange an 8-digit pairing code (RomM >= 4.9) for a Client API Token. */
  async loginWithPairingCode({ baseUrl: rawUrl, code }) {
    const baseUrl = normalizeBaseUrl(rawUrl);
    try {
      const res = await this.rawFetch(`${baseUrl}/api/client-tokens/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(code || '').replace(/\D/g, '') }),
      });
      if (!res.ok) return { ok: false, status: res.status, message: `Pairing failed (HTTP ${res.status})` };
      const data = await res.json();
      const token = data.token || data.raw_token || data.access_token;
      if (!token) return { ok: false, message: 'Server did not return a token' };
      return this.loginWithToken({ baseUrl, token });
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async loginWithPassword({ baseUrl: rawUrl, username, password, remember = true }) {
    const baseUrl = normalizeBaseUrl(rawUrl);
    if (!username || !password) return { ok: false, message: 'Username and password are required' };

    // 1) OAuth2 password grant (preferred - expiring JWT + refresh token)
    try {
      const tokens = await this.passwordGrant(baseUrl, username, password);
      const creds = {
        baseUrl,
        method: 'oauth',
        username,
        ...tokens,
        password: remember ? password : undefined,
      };
      const me = await this.verify(creds);
      this.saveCreds({ ...creds, username: me.username || username });
      return { ok: true, method: 'oauth', username: me.username || username, message: `Signed in as ${me.username || username}` };
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        return { ok: false, status: e.status, message: 'Invalid username or password' };
      }
      this.log('[auth] OAuth password grant failed, trying session login:', e.message);
    }

    // 2) Session cookie login (current: form POST /api/auth/login, legacy: POST /api/login with Basic)
    const attempts = [
      () =>
        this.rawFetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username, password }).toString(),
        }),
      () =>
        this.rawFetch(`${baseUrl}/api/login`, {
          method: 'POST',
          headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
        }),
    ];
    for (const attempt of attempts) {
      try {
        const res = await attempt();
        if (res.status === 401 || res.status === 403) {
          return { ok: false, status: res.status, message: 'Invalid username or password' };
        }
        if (!res.ok) continue;
        const creds = { baseUrl, method: 'session', username, password: remember ? password : undefined };
        const me = await this.verify(creds);
        this.saveCreds({ ...creds, username: me.username || username });
        return { ok: true, method: 'session', username: me.username || username, message: `Signed in as ${me.username || username}` };
      } catch (e) {
        this.log('[auth] session login attempt failed:', e.message);
      }
    }
    return { ok: false, message: 'Login failed. Check the server URL and that RomM is version 3.0 or newer.' };
  }

  async passwordGrant(baseUrl, username, password) {
    const res = await this.rawFetch(`${baseUrl}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'password', username, password, scope: OAUTH_SCOPES }).toString(),
    });
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      throw new AuthError(401, 'Invalid username or password');
    }
    if (!res.ok) throw new Error(`/api/token returned HTTP ${res.status}`);
    return this.parseTokenResponse(await res.json());
  }

  parseTokenResponse(data) {
    if (!data || !data.access_token) throw new Error('Token response missing access_token');
    const now = Date.now();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      accessExpiresAt: now + (Number(data.expires) || 1800) * 1000,
      refreshExpiresAt: data.refresh_expires ? now + Number(data.refresh_expires) * 1000 : null,
    };
  }

  /** Refresh the OAuth access token. Serialized so parallel requests share one refresh. */
  async refresh(creds) {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        if (creds.method === 'oauth' && creds.refreshToken && (!creds.refreshExpiresAt || creds.refreshExpiresAt > Date.now())) {
          const res = await this.rawFetch(`${creds.baseUrl}/api/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken }).toString(),
          });
          if (res.ok) {
            const tokens = this.parseTokenResponse(await res.json());
            const next = { ...creds, ...tokens, refreshToken: tokens.refreshToken || creds.refreshToken };
            this.saveCreds(next);
            return next;
          }
        }
        // Refresh token expired / rejected: silent re-login if the user opted to remember the password.
        if (creds.password && creds.username) {
          const r = await this.loginWithPassword({ baseUrl: creds.baseUrl, username: creds.username, password: creds.password, remember: true });
          if (r.ok) return this.getCreds();
        }
        return null;
      } catch (e) {
        this.log('[auth] refresh failed:', e.message);
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  async ensureFresh(creds) {
    if (creds.method === 'oauth' && creds.accessExpiresAt && creds.accessExpiresAt - 60000 < Date.now()) {
      return (await this.refresh(creds)) || creds;
    }
    return creds;
  }

  // ------------------------------------------------------------ requests
  buildUrl(baseUrl, reqPath, query) {
    const u = new URL(reqPath.startsWith('http') ? reqPath : `${baseUrl}${reqPath.startsWith('/') ? '' : '/'}${reqPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) v.forEach((item) => u.searchParams.append(k, String(item)));
        else u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  /**
   * Perform an authenticated fetch and return the raw Response.
   * Retries once after refreshing credentials on 401.
   */
  async authedFetch(reqPath, { method = 'GET', query, headers = {}, body, timeoutMs, signal, silent = false } = {}) {
    let creds = this.getCreds();
    if (!creds || !creds.baseUrl) {
      const info = { status: 401, message: 'Not signed in to a RomM server' };
      if (!silent) this.onAuthRequired(info);
      throw new AuthError(401, info.message);
    }
    creds = await this.ensureFresh(creds);

    const doFetch = (c) =>
      this.rawFetch(
        this.buildUrl(c.baseUrl, reqPath, query),
        { method, headers: { Accept: 'application/json', ...headers, ...this.authHeaders(c) }, body, signal },
        timeoutMs
      );

    let res = await doFetch(creds);
    if (res.status === 401) {
      const refreshed = await this.refresh(creds);
      if (refreshed) res = await doFetch(refreshed);
    }
    if (res.status === 401 || res.status === 403) {
      const info = {
        status: res.status,
        message: res.status === 401 ? 'Your RomM session expired. Please sign in again.' : 'Your RomM account or token lacks permission for this action (403).',
      };
      if (!silent) this.onAuthRequired(info);
      throw new AuthError(res.status, info.message);
    }
    return res;
  }

  /** JSON request used by the renderer via IPC. Never throws - returns an envelope. */
  async request(req) {
    try {
      const res = await this.authedFetch(req.path, req);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, status: res.status, message: `RomM returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}` };
      }
      if (req.responseType === 'none' || res.status === 204) return { ok: true, status: res.status, data: null };
      const data = req.responseType === 'text' ? await res.text() : await res.json();
      return { ok: true, status: res.status, data };
    } catch (e) {
      return { ok: false, status: e.status || 0, authRequired: Boolean(e.authRequired), message: e.message || String(e) };
    }
  }
}

module.exports = { RommClient, normalizeBaseUrl, AuthError };
