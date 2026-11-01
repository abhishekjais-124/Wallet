# Wallet

A personal card wallet in the style of [OFD](https://aj124.com/OFD). Keep every credit and debit card in one
place, shown as a realistic digital card that keeps the bank's colours, with copy buttons for each detail.

Cards are encrypted in the browser with your 9-digit PIN. They live on the device, and optionally sync between
devices through a hidden app folder in your own Google Drive. The server ships the app and nothing else.

## Quick start

```bash
npm install
npm run dev                         # http://localhost:5181
npm test && npm run typecheck
WALLET_BASE=/Wallet npm run build   # production build mounted at /Wallet
WALLET_BASE=/Wallet npm start       # http://localhost:8788/Wallet/
```

## Features

* Add, edit, delete and favourite cards. Fields: bank, nickname, name on card, credit or debit, network
  (detected from the number: Visa, Mastercard, RuPay, Amex, Diners, Discover, Maestro, JCB), number, expiry, CVV and category.
* Card design from a photo: pick a photo of the card front and the two main colours become the card's gradient.
  The photo is read in memory and discarded; it is never stored. Presets and colour pickers cover the rest.
* Detail view: tap the card to flip it. Copy buttons for the number, name, expiry, CVV, last four and bank.
* Search by bank, nickname, name, category, network or last four digits. Filters for favourites, credit, debit,
  each category and each network. Sort by recent, bank or expiry. "Expires soon" (60 days) and "Expired" badges.
* Light, dark or system theme. Phone-first layout, installable PWA, works offline.

## Security model

| What | How |
| --- | --- |
| Encryption | The 9-digit PIN (older vaults: a passphrase) is stretched with PBKDF2-SHA256 (600,000 iterations, random 16-byte salt) into a non-extractable AES-256-GCM key (`shared/vault.ts`). The whole card list is sealed as one blob with a fresh IV on every save. |
| Storage | Only the sealed blob is written to `localStorage`. Plaintext lives in memory while unlocked. Nothing is sent to the server. |
| PIN | Nine digits on a phone-style number pad. Never stored. There is no recovery: a forgotten PIN means the cards cannot be decrypted. A 9-digit PIN is far weaker than a long passphrase against someone who steals the vault or a backup file and tests PINs offline, so keep backup files private. |
| Masking | Number and CVV are masked by default. Revealing them hides them again after 20 seconds. |
| Clipboard | A copied number or CVV is overwritten in the clipboard after 30 seconds (best effort: browsers allow this only while the page is focused). |
| Auto-lock | Locks after 1, 5 or 15 minutes without input (Settings), and when the app returns after a minute in the background. The page is blurred while hidden so app-switcher snapshots show no card data. |
| Card PIN | No field exists for it. Never asked for, never stored. |
| Browser | Card inputs opt out of browser and password-manager autofill saving. The server sends a strict CSP (`script-src 'self'`, `connect-src 'self'`, no framing), `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`. |

**Sync with Google.** Settings → Sign in with Google (or "Restore with Google" on a new device). Sign-in is a
full-page redirect (OAuth implicit token flow, scope `drive.appdata` only), so it works inside the Home Screen app.
Only the sealed vault is uploaded, as `wallet-vault.json` in the Drive app-data folder, which is invisible in Drive
and readable only by this OAuth client. Each device still needs the PIN. The newest save wins; a device with
unsynced edits merges instead (union of cards, the more recently edited copy of each card wins), so a card deleted on
one device while the other had offline edits can come back. The 1-hour access token is kept in `localStorage`; when
it runs out, the app does one silent redirect to Google at the next launch.

**Backups.** Settings → Export backup downloads the sealed vault as JSON. It opens only with the passphrase it was made
with. Import merges cards into the current vault (the more recently edited copy of a card wins). On a new device,
"Restore from a backup" on the first screen installs it directly.

**Eviction.** Safari can clear website storage after 7 days without a visit unless the app is added to the Home
Screen, so install it as a PWA on iPhone and keep a recent backup.

## Deploy (same setup as OFD)

1. **Render**: New → Blueprint → this repo. `render.yaml` builds with `WALLET_BASE=/Wallet`, starts `npm start`,
   health check `/healthz`. No secrets. Note the `*.onrender.com` host.
2. **Cloudflare** (aj124.com zone): create a Worker named `wallet` with the code below, set `ORIGIN` to the Render
   host, and add the route `aj124.com/Wallet*`. Do not connect the Worker to this Git repo: Cloudflare would try to
   build the app as a Worker, which fails (this is the red "Workers Builds: ofd" check on OFD).

   ```js
   export default {
     async fetch(request) {
       const url = new URL(request.url);
       url.hostname = "ORIGIN.onrender.com"; // path stays /Wallet/...
       return fetch(new Request(url, request));
     },
   };
   ```
3. **Google sign-in**: in Google Cloud (abhishekjaiswal124@gmail.com, project `wallet-513414`, already done), create an OAuth client of type *Web application* with
   authorised JavaScript origins `https://aj124.com` and `http://localhost:8788`, and authorised redirect URIs
   `https://aj124.com/Wallet/` and `http://localhost:8788/Wallet/`. Enable the Google Drive API, add the
   `.../auth/drive.appdata` scope to the consent screen and your Gmail as a test user. Put the client id in Render as
   `WALLET_GOOGLE_CLIENT_ID` and redeploy. Without it the Google buttons are hidden.
4. Check: `https://aj124.com/Wallet` redirects to `/Wallet/`, the page loads, and `/Wallet/sw.js` returns 200.

## Layout

```
server/index.ts           Express: static files, security headers, /healthz, WALLET_BASE mount
shared/card.ts            card model, network detection, Luhn, formatting, masking, expiry
shared/vault.ts           PBKDF2 + AES-GCM seal / open
web/src/App.tsx           lock state, wallet list, search, filters, auto-lock, theme
web/src/components/       CardFace, Lock, Editor, Detail, Settings
web/src/palette.ts        colours from a card photo
web/public/sw.js          offline app shell
```
