import React, { useState } from 'react';
import { KeyRound, Link2, Loader2, LogIn, Power, Server, ShieldCheck, User, Hash, PlayCircle } from 'lucide-react';
import { FocusScope } from './FocusScope';
import { rommApi } from '../services/rommApi';
import { bridge, isNativeApp } from '../services/bridge';
import { soundService } from '../services/soundService';
import { NavigationAction } from '../types';

type Method = 'password' | 'token' | 'code';

interface LoginOverlayProps {
  initialUrl: string;
  initialUsername?: string;
  reason?: string;
  canCancel: boolean;
  onCancel: () => void;
  onLoggedIn: () => void;
  onDemo: () => void;
}

/**
 * Gamepad-first sign-in. Every field is a normal <input> that opens the
 * on-screen keyboard on A; LB/RB switch the auth method; Start submits.
 * Also offers "Exit to Steam" so a user is never trapped here in Game Mode.
 */
export const LoginOverlay: React.FC<LoginOverlayProps> = ({ initialUrl, initialUsername, reason, canCancel, onCancel, onLoggedIn, onDemo }) => {
  const [url, setUrl] = useState(initialUrl);
  const [method, setMethod] = useState<Method>('password');
  const [username, setUsername] = useState(initialUsername || '');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<'test' | 'login' | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(reason ? { ok: false, text: reason } : null);

  const methods: Method[] = ['password', 'token', 'code'];

  const test = async () => {
    if (!url.trim()) return setStatus({ ok: false, text: 'Enter your RomM server address first.' });
    setBusy('test');
    const r = await rommApi.testServer(url).catch((e) => ({ ok: false, message: String(e?.message || e) }) as any);
    setBusy(null);
    if (r.ok && r.baseUrl) setUrl(r.baseUrl);
    setStatus({ ok: r.ok, text: r.ok ? `Connected to RomM ${r.version || ''} at ${r.baseUrl}` : r.message });
    r.ok ? soundService.playSuccess() : soundService.playBack();
  };

  const login = async () => {
    if (!url.trim()) return setStatus({ ok: false, text: 'Enter your RomM server address first.' });
    setBusy('login');
    setStatus(null);
    try {
      const r =
        method === 'password'
          ? await rommApi.loginWithPassword(url, username.trim(), password, remember)
          : method === 'token'
          ? await rommApi.loginWithToken(url, token.trim())
          : await rommApi.loginWithPairingCode(url, code.replace(/\D/g, ''));
      if (r.ok) {
        soundService.playSuccess();
        setPassword('');
        onLoggedIn();
      } else {
        soundService.playBack();
        setStatus({ ok: false, text: r.message || 'Sign-in failed' });
      }
    } catch (e: any) {
      setStatus({ ok: false, text: e?.message || String(e) });
    } finally {
      setBusy(null);
    }
  };

  const onAction = (a: NavigationAction) => {
    if (a === 'PREV_PLATFORM' || a === 'NEXT_PLATFORM') {
      const i = methods.indexOf(method);
      setMethod(methods[(i + (a === 'NEXT_PLATFORM' ? 1 : methods.length - 1)) % methods.length]);
      return true;
    }
    if (a === 'MENU') {
      void login();
      return true;
    }
    if (a === 'ACTION_X') {
      void test();
      return true;
    }
    return a === 'FILTER' || a === 'ACTION_Y' || a === 'VIEW_MODE_TOGGLE';
  };

  const input = 'deck-input w-full h-12 rounded-xl bg-[#0a0e15] border-2 border-deck-line px-4 text-lg text-deck-text placeholder:text-deck-dim/70';
  const label = 'text-sm font-semibold text-deck-dim mb-1.5 flex items-center gap-2';

  return (
    <div className="fixed inset-0 z-[150] bg-deck-bg/95 backdrop-blur flex items-center justify-center deck-enter">
      <FocusScope
        name="login"
        onBack={canCancel ? onCancel : undefined}
        onAction={onAction}
        initialFocus={url ? (method === 'password' ? '#login-user' : '#login-secret') : '#login-url'}
        className="w-[760px] max-h-[760px] deck-scroll rounded-2xl bg-deck-panel border border-deck-line shadow-2xl p-7"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="h-12 w-12 rounded-xl bg-deck-accent/20 flex items-center justify-center">
            <ShieldCheck className="text-deck-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold">Connect to RomM</h1>
            <p className="text-sm text-deck-dim">Credentials are encrypted on this device. You only sign in once.</p>
          </div>
        </div>

        <div className={label}><Server size={15} /> Server address</div>
        <div className="flex gap-3 mb-5">
          <input
            id="login-url"
            data-focusable
            data-keyboard-mode="ip_address"
            data-keyboard-title="RomM server address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.20:8080"
            className={`${input} font-mono`}
          />
          <button data-focusable onClick={test} disabled={busy !== null} className="h-12 px-5 shrink-0 rounded-xl bg-deck-panel-2 border border-deck-line font-bold flex items-center gap-2">
            {busy === 'test' ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />} Test
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold text-deck-dim">L1</span>
          {methods.map((m) => (
            <button
              key={m}
              data-focusable
              onClick={() => setMethod(m)}
              className={`deck-chip h-10 px-4 rounded-full border text-sm font-semibold ${
                method === m ? 'bg-deck-text text-deck-bg border-deck-text' : 'border-deck-line text-deck-text'
              }`}
            >
              {m === 'password' ? 'Username & password' : m === 'token' ? 'API token (rmm_)' : 'Pairing code'}
            </button>
          ))}
          <span className="text-xs font-bold text-deck-dim">R1</span>
        </div>

        {method === 'password' && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className={label}><User size={15} /> Username</div>
              <input id="login-user" data-focusable data-keyboard-title="RomM username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className={input} />
            </div>
            <div>
              <div className={label}><KeyRound size={15} /> Password</div>
              <input
                id="login-secret"
                data-focusable
                type="password"
                data-keyboard-mode="password"
                data-keyboard-title="RomM password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={input}
              />
            </div>
            <button data-focusable role="checkbox" aria-checked={remember} data-nav-down="#login-submit" onClick={() => setRemember((r) => !r)} className="deck-row col-span-2 h-11 px-3 rounded-xl flex items-center gap-3 text-left bg-deck-panel-2/60">
              <span className={`h-6 w-6 rounded-md border-2 flex items-center justify-center ${remember ? 'bg-deck-accent border-deck-accent' : 'border-deck-dim'}`}>
                {remember && <span className="text-white text-sm font-black">{'\u2713'}</span>}
              </span>
              <span className="text-sm">Remember password (encrypted) for automatic re-login when the session expires</span>
            </button>
          </div>
        )}
        {method === 'token' && (
          <div className="mb-4">
            <div className={label}><KeyRound size={15} /> Client API token</div>
            <input
              id="login-secret"
              data-focusable
              type="password"
              data-keyboard-mode="password"
              data-keyboard-title="Client API token (rmm_...)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="rmm_..."
              className={`${input} font-mono`}
            />
            <p className="text-xs text-deck-dim mt-2">Create one in RomM: Profile &gt; Client API Tokens.</p>
          </div>
        )}
        {method === 'code' && (
          <div className="mb-4">
            <div className={label}><Hash size={15} /> 8-digit pairing code</div>
            <input
              id="login-secret"
              data-focusable
              data-keyboard-mode="code"
              data-keyboard-title="Pairing code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="12345678"
              className={`${input} font-mono tracking-[0.3em]`}
            />
            <p className="text-xs text-deck-dim mt-2">In RomM open Client API Tokens, choose Pair device and enter the code shown (valid 5 minutes).</p>
          </div>
        )}

        {status && (
          <div className={`mb-4 rounded-xl px-4 py-3 text-sm border ${status.ok ? 'border-deck-ok/60 bg-deck-ok/10 text-green-200' : 'border-deck-danger/60 bg-deck-danger/10 text-red-200'}`}>
            {status.text}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button id="login-submit" data-focusable onClick={login} disabled={busy !== null} className="h-12 px-6 rounded-xl bg-deck-accent text-white font-bold flex items-center gap-2">
            {busy === 'login' ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />} Sign in
          </button>
          <button data-focusable onClick={onDemo} className="h-12 px-5 rounded-xl bg-deck-panel-2 border border-deck-line font-semibold flex items-center gap-2">
            <PlayCircle size={18} /> Demo library
          </button>
          {canCancel && (
            <button data-focusable onClick={onCancel} className="h-12 px-5 rounded-xl bg-deck-panel-2 border border-deck-line font-semibold">
              Cancel
            </button>
          )}
          {isNativeApp && (
            <button data-focusable onClick={() => bridge.app.quit()} className="ml-auto h-12 px-5 rounded-xl bg-deck-danger/15 border border-deck-danger/60 text-red-200 font-semibold flex items-center gap-2">
              <Power size={18} /> Exit to Steam
            </button>
          )}
        </div>
        <p className="text-xs text-deck-dim mt-4">A: edit field / press  -  X: test server  -  L1/R1: sign-in method  -  Start: sign in</p>
      </FocusScope>
    </div>
  );
};
