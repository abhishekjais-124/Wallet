# Wallet

A personal card wallet in the style of [OFD](https://aj124.com/OFD). Keep every credit and debit card in one
place, shown as a realistic digital card that keeps the bank's colours, with copy buttons for each detail.

Cards are encrypted in the browser and unlocked with your 9-digit PIN. They live on the device, and optionally sync between
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

* Apple Wallet layout: a spotlight stack where one card is open and the others are strips above and below; a short scroll moves the spotlight to the next card and snaps it into place. Tap a strip to bring it in; tap the open card and it glides to the top with its details, the rest drop into a pile at the bottom (View Transitions). + and ••• in the header, search button at the bottom right.
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

* IDs (a second stack under the cards): Aadhaar, PAN and driving licence, each drawn as its own card (our own designs, not the government
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
| Encryption | The vault is sealed with a random 256-bit master key (AES-256-GCM, fresh IV on every save, `shared/vault.ts`). The master key is stored only wrapped: by the PIN (PBKDF2-SHA256, 600,000 iterations, random salt) on this device, and by the recovery key (24 random characters, ~120 bits) for the Google Drive copy and backup files. Older vaults (sealed straight with the PIN) are upgraded at the next PIN unlock. |
| Storage | The sealed vault is written to `localStorage`; encrypted ID files to IndexedDB and, when signed in, the Google Drive app folder. Plaintext lives in memory while unlocked. Nothing is sent to the app's server. |
| PIN | Nine digits on a phone-style number pad. Never stored. It wraps the master key on this device only; the PIN wrap is never uploaded or exported, so a stolen Drive copy or backup cannot be opened by trying PINs. Someone with the unlocked device's storage could still try PINs offline. |
| Recovery key | Shown once when the wallet is made or upgraded (copy, save as file). Never stored. Opens the Drive copy or a backup on a new device, which then sets its own PIN. Settings → Make a new recovery key re-wraps the master key; older backups still open with the old key. Losing both the PIN and the recovery key means the data cannot be decrypted. |
| Face ID / Touch ID | Optional, per device (`web/src/bio.ts`). A passkey on the device's own authenticator is created with the WebAuthn PRF extension; the secret it returns after a successful biometric check is run through HKDF and wraps the PIN with AES-GCM. Only the wrapped PIN is stored, on that device. Unlocking still derives the vault key from the PIN. Changing the PIN, erasing the wallet, or a wrap that no longer opens turns it off. Needs iOS 18 / Safari 18 / a recent Chrome; otherwise the section says so and the PIN pad is the only way in. |
| Masking | Number and CVV are masked by default. Revealing them hides them again after 20 seconds. |
| Clipboard | A copied number or CVV is overwritten in the clipboard after 30 seconds (best effort: browsers allow this only while the page is focused). |
| Auto-lock | Locks after 1, 5 or 15 minutes without input (Settings), and when the app returns after a minute in the background. The page is blurred while hidden so app-switcher snapshots show no card data. |
| Card PIN | No field exists for it. Never asked for, never stored. |
| Browser | Card inputs opt out of browser and password-manager autofill saving. The server sends a strict CSP (`script-src 'self'`, `connect-src 'self'`, no framing), `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`. |

**Sync with Google.** Settings → Sign in with Google (or "Restore with Google" on a new device). Sign-in is a
full-page redirect (OAuth implicit token flow, scope `drive.appdata` only), so it works inside the Home Screen app.
Only the sealed vault is uploaded, as `wallet-vault.json` in the Drive app-data folder, which is invisible in Drive
and readable only by this OAuth client. The uploaded copy carries only the recovery wrap: a new device opens it with
the recovery key once, then sets its own PIN. A device still on the older format that finds an upgraded copy asks for
the recovery key and merges its own cards in, so there is only ever one master key. The newest save wins; a device with
unsynced edits merges instead: the newest copy of each card and ID, minus anything deleted on either device. Deletes
are recorded as tombstones in the vault (kept 180 days), so a delete is not undone by the other device's older copy;
an edit made after a delete elsewhere wins. The 1-hour access token is kept in `localStorage`; when
it runs out, the app does one silent redirect to Google at the next launch.

**Backups.** Settings → Export backup downloads the sealed vault (and encrypted ID files) as JSON. It opens with the
recovery key; backups made before the upgrade open with the PIN they were made with. Import merges cards into the current vault (the more recently edited copy of a card wins). On a new device,
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

## iPhone app (`ios/`)

A small Swift app that shows the same web app in a web view, so Face ID is a plain face scan (no Safari passkey
sheet). The 9-digit PIN is kept in the iOS Keychain behind Face ID (`biometryCurrentSet`, this device only) and handed
to the page through the `walletBio` message handler, which answers only aj124.com's main frame. Files the page saves
(backups, the recovery key, ID files) open the share sheet. Google blocks its sign-in inside web views, so the app
signs in through Safari's own sheet with a separate iOS OAuth client (code + PKCE, `ios/Wallet/Google.swift`), keeps
the refresh token in the Keychain and hands the page short-lived access tokens (`walletGoogle` handler). The consent
screen is published (In production) so the refresh token does not expire after 7 days; `drive.appdata` is a
non-sensitive scope, so no Google review is needed. Its required privacy page is `web/public/privacy.html`.

**Dynamic Island.** The fifth action on an open card (`web/src/island.ts`, `ios/Wallet/Island.swift`) copies the
number and starts a Live Activity drawn by the `WalletIsland` widget extension (`ios/WalletIsland/`): the card's
bank, name, last four, expiry and network in the Dynamic Island and on the lock screen, with a countdown. Only what is
printed on the face goes to the island; the full number sits in the clipboard with a one-minute expiry that iOS
enforces. The activity stays live for the minute (an ended one leaves the island), then turns to a "cleared" tick on
its own; Wallet ends it then if it is still awake, otherwise the next time it opens. Needs an iPhone with the Dynamic Island
(iPhone 14 Pro or later) and Live Activities allowed for Wallet. The app has its own storage, separate from the Safari
home-screen app: restore with Google or a backup the first time.

Build and install on a connected iPhone (automatic signing, team set in the project):

```bash
cd ios && xcodebuild -project Wallet.xcodeproj -scheme Wallet -configuration Release -destination 'id=<device udid>' -allowProvisioningUpdates build
xcrun devicectl device install app --device <device udid> <derived data>/Build/Products/Release-iphoneos/Wallet.app
```

`WALLET_URL=http://localhost:8788/Wallet/` in the launch environment points it at a local build.
