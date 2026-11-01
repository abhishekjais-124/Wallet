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
* Card look: every card gets drawn artwork (waves, honeycomb, rays, …) picked from its name, in its own colours, or
  one you choose. "Photo of the card" uses your own photo as the background (centre-cropped, 640 px JPEG, encrypted
  with the card); "Colours only" just takes the two main colours and discards the photo. Presets and colour pickers
  cover the rest. The app never downloads banks' card artwork.
* Detail view: tap the card to flip it. Copy buttons for the number, name, expiry, CVV, last four and bank.
* Search by bank, nickname, name, category, network or last four digits. Filters for favourites, credit, debit,
  each category and each network. Sort by recent, bank or expiry. "Expires soon" (60 days) and "Expired" badges.
* Light, dark or system theme. Phone-first layout, installable PWA, works offline.

* IDs tab: Aadhaar, PAN and driving licence, each drawn as its own card (our own designs, not the government
  artwork), with name, number (masked to the last four by default), date of birth and, for a licence, valid till.
  Attach front/back photos (resized to 1600 px JPEG) and/or the PDF (up to 10 MB). Share the files, or the details
  as text with the number masked unless switched on.
* Where ID files live (`web/src/blobs.ts`): not in the vault. Each file is encrypted with its own random AES-GCM
  key, which is stored in the file's record inside the encrypted vault. The encrypted bytes are cached in this
  device's IndexedDB and uploaded to the Google Drive app folder as `blob-<id>`; another device (or this one after
  Safari clears storage) fetches a file from Drive the first time it is shown. Changes made while signed out or
  offline wait in a queue and go up at the next sync. The vault itself stays small (cards, ID details, file keys).
  Backups include the encrypted files, so a backup restores everything without Drive.

## Security model

| What | How |
| --- | --- |
| Encryption | The 9-digit PIN (older vaults: a passphrase) is stretched with PBKDF2-SHA256 (600,000 iterations, random 16-byte salt) into a non-extractable AES-256-GCM key (`shared/vault.ts`). The whole card list is sealed as one blob with a fresh IV on every save. |
| Storage | The sealed vault is written to `localStorage`; encrypted ID files to IndexedDB and, when signed in, the Google Drive app folder. Plaintext lives in memory while unlocked. Nothing is sent to the app's server. |
| PIN | Nine digits on a phone-style number pad. Never stored. There is no recovery: a forgotten PIN means the cards cannot be decrypted. A 9-digit PIN is far weaker than a long passphrase against someone who steals the vault or a backup file and tests PINs offline, so keep backup files private. |
| Face ID / Touch ID | Optional, per device (`web/src/bio.ts`). A passkey on the device's own authenticator is created with the WebAuthn PRF extension; the secret it returns after a successful biometric check is run through HKDF and wraps the PIN with AES-GCM. Only the wrapped PIN is stored, on that device. Unlocking still derives the vault key from the PIN. Changing the PIN, erasing the wallet, or a wrap that no longer opens turns it off. Needs iOS 18 / Safari 18 / a recent Chrome; otherwise the section says so and the PIN pad is the only way in. |
| Masking | Number and CVV are masked by default. Revealing them hides them again after 20 seconds. |
| Clipboard | A copied number or CVV is overwritten in the clipboard after 30 seconds (best effort: browsers allow this only while the page is focused). |
| Auto-lock | Locks after 1, 5 or 15 minutes without input (Settings), and when the app returns after a minute in the background. The page is blurred while hidden so app-switcher snapshots show no card data. |
| Card PIN | No field exists for it. Never asked for, never stored. |
| Browser | Card inputs opt out of browser and password-manager autofill saving. The server sends a strict CSP (`script-src 'self'`, `connect-src 'self'`, no framing), `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`. |

**Sync with Google.** Settings → Sign in with Google (or "Restore with Google" on a new device). Sign-in is a
full-page redirect (OAuth implicit token flow, scope `drive.appdata` only), so it works inside the Home Screen app.
Only the sealed vault is uploaded, as `wallet-vault.json` in the Drive app-data folder, which is invisible in Drive
and readable only by this OAuth client. Each device still needs the PIN. The newest save wins; a device with
unsynced edits merges instead: the newest copy of each card and ID, minus anything deleted on either device. Deletes
are recorded as tombstones in the vault (kept 180 days), so a delete is not undone by the other device's older copy;
an edit made after a delete elsewhere wins. The 1-hour access token is kept in `localStorage`; when
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
