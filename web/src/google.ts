/**
 * Google sign-in for sync, as a full-page redirect (OAuth implicit token flow). Popups are unreliable in Home Screen
 * web apps, a redirect always comes back to the app. The only scope is drive.appdata: the app's hidden Drive folder,
 * nothing else in Drive. The short-lived access token (1 h) is kept in localStorage; it can only read and write
 * that folder, which holds nothing but the encrypted vault.
 */
import { BASE } from "./store.ts";

export const CLIENT_ID = __WALLET_GOOGLE_CLIENT_ID__;
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const TOKEN_KEY = "wallet.google.token";
const ACCOUNT_KEY = "wallet.google.account";
const STATE_KEY = "wallet.google.state";

interface Token {
  value: string;
  expiresAt: number;
}

const redirectUri = () => `${location.origin}${BASE}/`;

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

/** The signed-in Google account, kept after the token expires so the next sign-in can be silent. */
export const account = (): string | null => read<string>(ACCOUNT_KEY);

/** A token with at least a minute left, or null. */
export function token(): string | null {
  const t = read<Token>(TOKEN_KEY);
  return t && t.expiresAt - Date.now() > 60_000 ? t.value : null;
}

/** Leaves the app for Google's consent page. `silent` re-uses an earlier consent without showing anything. */
export function signIn(silent = false): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "token",
    scope: SCOPE,
    state,
    include_granted_scopes: "true",
    prompt: silent ? "none" : "select_account",
  });
  const hint = account();
  if (hint) params.set("login_hint", hint);
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

/** Reads Google's answer from the URL fragment on the way back, then removes it from the address bar. */
export function takeRedirect(): { ok: boolean; error?: string } | null {
  if (!location.hash.includes("state=")) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search);
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!expected || p.get("state") !== expected) return { ok: false, error: "Sign-in answer did not match this request." };
  const value = p.get("access_token");
  if (!value) return { ok: false, error: p.get("error") ?? "Sign-in was cancelled." };
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ value, expiresAt: Date.now() + Number(p.get("expires_in") ?? 3600) * 1000 }));
  return { ok: true };
}

export function rememberAccount(email: string): void {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(email));
}

export async function signOut(): Promise<void> {
  const t = token();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  if (t) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: t }) }).catch(() => {});
}
