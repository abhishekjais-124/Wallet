import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { digits, expiryState, last4, NETWORK_LABEL, type Card } from "@shared/card.ts";
import { mergeLive, mergeTombstones, type IdDoc, type Tombstones } from "@shared/doc.ts";
import {
  createKeys, deriveKey, isPin, isV2, newRecoveryKey, open as openVault, rewrapLocal, rewrapRecovery, seal, unlock, unlockWithRecovery,
  type SealedVault, type VaultKey,
} from "@shared/vault.ts";
import { available as bioAvailable, bioLabel, enrolled as bioEnrolled, forget as bioForget } from "./bio.ts";
import { bioIcon, BioSetup } from "./components/BioSetup.tsx";
import { account, CLIENT_ID, inApp, refresh, SIGNED_IN, signIn, signOut, takeRedirect, token } from "./google.ts";
import { flushBlobs } from "./blobs.ts";
import { clearMeta, meta, pull, push, setMeta, whoAmI } from "./sync.ts";
import { CardFace } from "./components/CardFace.tsx";
import { Detail } from "./components/Detail.tsx";
import { DocsView } from "./components/Docs.tsx";
import { Editor } from "./components/Editor.tsx";
import { Lock } from "./components/Lock.tsx";
import { RecoverySheet } from "./components/Recovery.tsx";
import { Settings } from "./components/Settings.tsx";
import { eraseSealed, getPref, loadSealed, saveSealed, setPref, type ThemePref, type VaultData } from "./store.ts";
import { useSpotlight } from "./spotlight.ts";
import { glide, haptic, Icon, Menu, ToastHost, transition } from "./ui.tsx";

interface Session {
  vk: VaultKey;
  cards: Card[];
  docs: IdDoc[];
  deleted: Tombstones;
}

export interface SyncState {
  status: "off" | "syncing" | "ok" | "error";
  email?: string | null;
  message?: string | undefined;
  at?: number;
}

const HIDDEN_LOCK_MS = 60_000;
const JOIN_MESSAGE = "This wallet was upgraded on another device. Enter its recovery key below to keep syncing.";

// which key a vault is sealed with: the master key id (v2) or the PIN salt (v1)
const keyOf = (s: SealedVault): string => (isV2(s) ? s.kid : s.salt);
const vkId = (vk: VaultKey): string => vk.kid ?? vk.salt ?? "";
const SILENT_KEY = "wallet.google.silentTried";

export function App() {
  const [sealed, setSealed] = useState<SealedVault | null>(loadSealed);
  const [session, setSession] = useState<Session | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => getPref<ThemePref>("theme", "system"));
  const [lockMinutes, setLockMinutes] = useState(() => getPref<number>("lockMinutes", 5));
  useTheme(theme);

  const lock = useCallback(() => transition(() => { setSession(null); setKnownPin(null); }, "lock"), []);
  useAutoLock(!!session, lockMinutes, lock);

  const [knownPin, setKnownPin] = useState<string | null>(null);
  const [bioOk, setBioOk] = useState(false);
  const [bioOn, setBioOn] = useState(bioEnrolled);
  useEffect(() => { void bioAvailable().then(setBioOk); }, []);

  const [sync, setSync] = useState<SyncState>({ status: "off" });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // a Drive copy that changed while this device also had unsynced edits; merged at the next unlock
  const pendingMerge = useRef<SealedVault | null>(null);
  // a Drive copy sealed with another master key (made on another device): joined with its recovery key
  const [joinRemote, setJoinRemote] = useState<SealedVault | null>(null);
  // a recovery key just made, shown once
  const [recoveryShown, setRecoveryShown] = useState<string | null>(null);

  const upload = useCallback((s: SealedVault) => {
    if (!account()) return;
    setMeta({ dirty: true });
    if (!token()) return setSync({ status: "error", email: account(), message: "Saved on this device. Sign in again to sync." });
    setSync({ status: "syncing", email: account() });
    push(s).then(
      () => setSync({ status: "ok", email: account(), at: Date.now() }),
      (err: Error) => setSync({ status: "error", email: account(), message: `Saved on this device, not synced: ${err.message}` }),
    );
  }, []);

  // every change re-seals the whole vault with a fresh IV before the UI shows it; docs default to the open ones.
  // Anything that was open before and is gone now was deleted here: it gets a tombstone so a merge with another
  // device does not bring it back. Anything present has none (a restore or an edit after a delete wins).
  const persist = useCallback(async (cards: Card[], vk: VaultKey, docs: IdDoc[] = sessionRef.current?.docs ?? [], base?: Tombstones) => {
    const prev = sessionRef.current;
    const deleted: Tombstones = { ...(base ?? prev?.deleted ?? {}) };
    const now = Date.now();
    const present = new Set([...cards, ...docs].map((x) => x.id));
    for (const x of [...(prev?.cards ?? []), ...(prev?.docs ?? [])]) if (!present.has(x.id)) deleted[x.id] = now;
    for (const id of present) delete deleted[id];
    const tombstones = mergeTombstones(deleted, {}, now);
    const s = await seal({ cards, docs, deleted: tombstones }, vk);
    saveSealed(s);
    setSealed(s);
    setSession({ vk, cards, docs, deleted: tombstones });
    upload(s);
  }, [upload]);

  /** Takes the newer Drive copy. Open on this device, it is decrypted with the current key; a different PIN locks. */
  const adopt = useCallback(async (remote: SealedVault) => {
    // the Drive copy has no PIN wrap; this device keeps its own while the master key is the same
    const local = loadSealed();
    const kept = isV2(remote) && local && isV2(local) && local.kid === remote.kid && local.wraps.local
      ? { ...remote, wraps: { ...remote.wraps, local: local.wraps.local } } : remote;
    saveSealed(kept);
    setSealed(kept);
    setMeta({ syncedAt: remote.savedAt ?? 0, dirty: false });
    const open = sessionRef.current;
    if (!open) return;
    try {
      const data = await openVault<VaultData>(kept, open.vk);
      const vk = isV2(kept) ? { ...open.vk, wraps: kept.wraps } : open.vk;
      setSession({ vk, cards: data.cards, docs: data.docs ?? [], deleted: data.deleted ?? {} });
    } catch {
      setSession(null);
    }
  }, []);

  /**
   * Both sides changed: the newest copy of each card and document, minus anything either device deleted (both
   * devices' tombstones are combined, so a delete on one is not undone by the other's older copy).
   */
  const merge = useCallback(async (remote: SealedVault, vk: VaultKey, cards: Card[], docs: IdDoc[], deleted: Tombstones) => {
    pendingMerge.current = null;
    if (keyOf(remote) !== vkId(vk) && isV2(remote)) {
      setSession({ vk, cards, docs, deleted });
      setJoinRemote(remote);
      return setSync({ status: "error", email: account(), message: JOIN_MESSAGE });
    }
    try {
      const theirs = await openVault<VaultData>(remote, vk);
      const both = mergeTombstones(deleted, theirs.deleted);
      // a recovery key made since on the other device replaces this one
      if (isV2(remote) && vk.wraps && (remote.savedAt ?? 0) > (loadSealed()?.savedAt ?? 0)) vk = { ...vk, wraps: { ...vk.wraps, recovery: remote.wraps.recovery } };
      // the session holds this device's lists, so items removed by the other device's tombstones are not re-stamped
      setSession({ vk, cards, docs, deleted: both });
      sessionRef.current = { vk, cards, docs, deleted: both };
      const liveCards = mergeLive(cards, theirs.cards, both);
      const liveDocs = mergeLive(docs, theirs.docs ?? [], both);
      await persist(liveCards, vk, liveDocs, both);
    } catch {
      // still open this device's own cards; only the merge is skipped
      setSession({ vk, cards, docs, deleted });
      setSync({ status: "error", email: account(), message: "The wallet in Google Drive uses a different PIN, so it was not merged. Set the same PIN on both devices, then Sync now." });
    }
  }, [persist]);

  const syncNow = useCallback(async () => {
    if (!CLIENT_ID || !account()) return setSync({ status: "off" });
    if (!token() && !(await refresh())) {
      // one silent round trip to Google per app launch, only while locked so nothing in progress is lost
      if (!inApp && !sessionRef.current && !sessionStorage.getItem(SILENT_KEY)) {
        sessionStorage.setItem(SILENT_KEY, "1");
        return signIn(true);
      }
      return setSync({ status: "error", email: account(), message: "Sign in again to sync." });
    }
    setSync({ status: "syncing", email: account() });
    try {
      const remote = await pull();
      const local = loadSealed();
      const m = meta();
      const remoteAt = remote?.savedAt ?? 0;
      const localAt = local?.savedAt ?? 0;
      if (!remote) {
        if (local) await push(local);
      } else if (!local) {
        await adopt(remote);
      } else if (keyOf(remote) !== keyOf(local)) {
        // upgraded on another device: join it with the recovery key, which merges this device's cards in. An older
        // copy in Drive (v1) is replaced by this upgraded one; that device joins in the same way.
        if (isV2(remote)) {
          setJoinRemote(remote);
          return setSync({ status: "error", email: account(), message: JOIN_MESSAGE });
        }
        if (isV2(local)) await push(local);
      } else if (remoteAt === localAt) {
        setMeta({ syncedAt: remoteAt, dirty: false });
      } else if (m.syncedAt === 0 || (m.dirty && remoteAt > m.syncedAt)) {
        // never synced here, or both sides changed: merge, never overwrite the Drive copy blindly
        const open = sessionRef.current;
        if (open) await merge(remote, open.vk, open.cards, open.docs, open.deleted);
        else pendingMerge.current = remote;
      } else if (m.dirty || localAt > remoteAt) {
        await push(local);
      } else {
        await adopt(remote);
      }
      setSync({ status: "ok", email: account(), at: Date.now() });
      void flushBlobs(); // ID files added or removed while offline or signed out
    } catch (err) {
      setSync({ status: "error", email: account(), message: (err as Error).message });
    }
  }, [adopt, merge]);

  /**
   * An older vault (sealed straight with the PIN) gets a master key and a recovery key, so the copies that leave the
   * device stop being crackable from the PIN. A wallet already upgraded on another device is joined instead, so there
   * is one recovery key; a newer older-format Drive copy is merged in first.
   */
  const upgrade = useCallback(async (old: VaultKey, data: VaultData, pin: string) => {
    let cards = data.cards, docs = data.docs ?? [], deleted = data.deleted ?? {};
    sessionRef.current = { vk: old, cards, docs, deleted };
    setSession(sessionRef.current);
    if (account() && token()) {
      const remote = await pull().catch(() => null);
      if (remote && isV2(remote)) {
        setJoinRemote(remote);
        return setSync({ status: "error", email: account(), message: JOIN_MESSAGE });
      }
      if (remote && remote.savedAt !== loadSealed()?.savedAt) {
        try {
          const theirs = await openVault<VaultData>(remote, await deriveKey(pin, remote.salt, remote.iter));
          deleted = mergeTombstones(deleted, theirs.deleted);
          cards = mergeLive(cards, theirs.cards, deleted);
          docs = mergeLive(docs, theirs.docs ?? [], deleted);
        } catch { /* a different PIN there: that device joins with the recovery key and merges its own cards */ }
      }
    }
    const recovery = newRecoveryKey();
    await persist(cards, await createKeys(pin, recovery), docs, deleted);
    setRecoveryShown(recovery);
  }, [persist]);

  /** Takes the master key of the wallet in Drive (opened with its recovery key) and merges this device's cards in. */
  const join = useCallback(async (recovery: string, pin: string) => {
    const open = sessionRef.current;
    const local = loadSealed();
    if (!joinRemote || !isV2(joinRemote) || !open || !local) return;
    // the PIN stays this device's PIN, so a typo cannot lock the wallet
    await unlock(local, pin).catch(() => { throw new Error("Wrong PIN for this device."); });
    const { data, vk } = await unlockWithRecovery<VaultData>(joinRemote, recovery);
    const both = mergeTombstones(open.deleted, data.deleted);
    sessionRef.current = { ...open, deleted: both };
    await persist(mergeLive(open.cards, data.cards, both), await rewrapLocal(vk, pin), mergeLive(open.docs, data.docs ?? [], both), both);
    setJoinRemote(null);
  }, [joinRemote, persist]);

  useEffect(() => {
    const back = takeRedirect();
    if (back && !back.ok) setSync({ status: "error", email: account(), message: back.error === "interaction_required" || back.error === "login_required" ? "Sign in again to sync." : back.error });
    (back?.ok ? whoAmI().then(() => sessionStorage.removeItem(SILENT_KEY), () => {}) : Promise.resolve()).then(() => void syncNow());
    const onVisible = () => document.visibilityState === "visible" && void syncNow();
    document.addEventListener("visibilitychange", onVisible);
    // the iPhone app's sign-in sheet closed: same as coming back from Google's redirect on the web
    const onSignedIn = (e: Event) => {
      const error = (e as CustomEvent<string | undefined>).detail;
      if (error) return setSync({ status: "error", email: account(), message: error });
      void whoAmI().then(() => syncNow(), (err: Error) => setSync({ status: "error", email: account(), message: err.message }));
    };
    window.addEventListener(SIGNED_IN, onSignedIn);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SIGNED_IN, onSignedIn);
    };
  }, [syncNow]);

  return (
    <ToastHost>
      {!session || !sealed ? (
        <Lock sealed={sealed} onCreated={(s) => { setSealed(s); void syncNow(); }} onOpen={(vk, data, secret, recovery) => {
          setKnownPin(isPin(secret) ? secret : null); // kept only while unlocked, so Face ID can be set up without retyping it
          if (recovery) setRecoveryShown(recovery);
          const remote = pendingMerge.current;
          const docs = data.docs ?? [];
          const deleted = data.deleted ?? {};
          // an older vault opened with nine digits gets a recovery key (a letters passphrase does when it switches to a PIN)
          if (!vk.raw && isPin(secret)) void upgrade(vk, data, secret);
          else if (remote) void merge(remote, vk, data.cards, docs, deleted);
          else transition(() => setSession({ vk, cards: data.cards, docs, deleted }), "unlock");
          haptic("success");
        }} />
      ) : (
        <WalletView
          cards={session.cards}
          save={(cards) => persist(cards, session.vk)}
          docs={session.docs}
          saveDocs={(docs) => persist(session.cards, session.vk, docs)}
          onLock={lock}
          settings={{
            theme,
            onTheme: (t) => { setTheme(t); setPref("theme", t); },
            lockMinutes,
            onLockMinutes: (m) => { setLockMinutes(m); setPref("lockMinutes", m); },
            sealed,
            cards: session.cards,
            docs: session.docs,
            onReplace: (cards, docs) => persist(cards, session.vk, docs),
            onRekey: (vk, recovery) => {
              if (bioOn) { bioForget(); setBioOn(false); }
              setKnownPin(null);
              if (recovery) setRecoveryShown(recovery);
              return persist(session.cards, vk);
            },
            recovery: {
              on: !!session.vk.raw,
              onNew: async () => {
                const code = newRecoveryKey();
                await persist(session.cards, await rewrapRecovery(session.vk, code));
                setRecoveryShown(code);
              },
              join: !!joinRemote,
              onJoin: join,
            },
            onErase: () => { eraseSealed(); bioForget(); setBioOn(false); setSealed(null); setSession(null); },
            bio: {
              label: bioLabel(),
              available: bioOk,
              enrolled: bioOn,
              pin: knownPin,
              offer: bioOk && !bioOn && !!knownPin && !getPref("bioOffered", ""),
              onEnrolled: () => { setBioOn(true); setKnownPin(null); },
              onForget: () => { bioForget(); setBioOn(false); },
              onDismissOffer: () => setPref("bioOffered", "1"),
            },
            sync: {
              ...sync,
              enabled: !!CLIENT_ID,
              onSignIn: () => signIn(),
              onSignOut: () => { void signOut().then(() => { clearMeta(); setSync({ status: "off" }); }); },
              onSyncNow: () => void syncNow(),
            },
          }}
        />
      )}
      {recoveryShown && session && <RecoverySheet code={recoveryShown} onDone={() => setRecoveryShown(null)} />}
    </ToastHost>
  );
}

type SettingsProps = Omit<React.ComponentProps<typeof Settings>, "onClose">;

function WalletView({ cards, save, docs, saveDocs, onLock, settings }: {
  cards: Card[];
  save: (cards: Card[]) => Promise<void>;
  docs: IdDoc[];
  saveDocs: (docs: IdDoc[]) => Promise<void>;
  onLock: () => void;
  settings: SettingsProps;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query); // typing stays instant; the list catches up
  const [filter, setFilter] = useState("all");
  const [searching, setSearching] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | "new" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bioDismissed, setBioDismissed] = useState(false);
  const [addingDoc, setAddingDoc] = useState(false);
  const doneAddingDoc = useCallback(() => setAddingDoc(false), []);
  const dark = document.documentElement.dataset.theme === "dark";

  const categories = useMemo(() => [...new Set(cards.map((c) => c.category))].sort(), [cards]);
  const networks = useMemo(() => [...new Set(cards.map((c) => c.network))], [cards]);
  const filters = [
    { id: "all", label: "All" },
    { id: "fav", label: "Favourites" },
    { id: "kind:credit", label: "Credit" },
    { id: "kind:debit", label: "Debit" },
    ...categories.map((c) => ({ id: `cat:${c}`, label: c })),
    ...(networks.length > 1 ? networks.map((n) => ({ id: `net:${n}`, label: NETWORK_LABEL[n] })) : []),
  ];

  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const qDigits = digits(q);
    const [kind, value] = filter.split(":");
    return cards
      .filter((c) =>
        filter === "all" ? true
          : filter === "fav" ? c.favorite
            : kind === "kind" ? c.kind === value
              : kind === "cat" ? c.category === value
                : c.network === value)
      .filter((c) => !q || [c.bank, c.nickname, c.holder, c.category, NETWORK_LABEL[c.network], c.kind].some((s) => s.toLowerCase().includes(q))
        || (qDigits.length >= 2 && qDigits.length <= 4 && last4(c.number).includes(qDigits)))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  }, [cards, deferredQuery, filter]);

  const open = cards.find((c) => c.id === openId) ?? null;
  // the scroller with the spotlight: a tap on the open tile shows its details, a tap on a strip brings it in
  const spotRef = useRef<HTMLDivElement>(null);
  const spot = useSpotlight(spotRef, `${shown.map((c) => c.id).join()}|${docs.length}|${filter}`);
  const openCard = useCallback((id: string) => {
    if (spot.activeId !== id) return spot.bring(id);
    glide(id, () => setOpenId(id), true);
  }, [spot]);
  const closeCard = useCallback(() => { if (openId) glide(openId, () => setOpenId(null), false); }, [openId]);
  const upsert = async (card: Card) => {
    await save(cards.some((c) => c.id === card.id) ? cards.map((c) => (c.id === card.id ? card : c)) : [...cards, card]);
  };
  const stopSearch = () => { setSearching(false); setQuery(""); setFilter("all"); };

  return (
    <>
      <div className="status-scrim" aria-hidden="true" />
      <main className="page wallet">
        {searching ? (
          <div className="searchbar">
            <div className="search-row">
              <div className="search">
                <Icon name="search" />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Bank, name, last four…"
                  aria-label="Search cards and IDs" autoComplete="off" autoFocus />
              </div>
              <button type="button" className="pill-btn" onClick={stopSearch}>Cancel</button>
            </div>
            {cards.length > 0 && (
              <div className="chips" role="tablist" aria-label="Filter cards">
                {filters.map((f) => (
                  <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip-btn${filter === f.id ? " on" : ""}`} onClick={() => setFilter(f.id)}>{f.label}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <header className="wallet-head">
            <h1>Wallet</h1>
            <div className="head-actions">
              <Menu label="Add" icon="plus" items={[
                { label: "Add card", icon: "card", onClick: () => setEditing("new") },
                { label: "Add ID", icon: "idcard", onClick: () => setAddingDoc(true) },
              ]} />
              <Menu label="More" icon="more" items={[
                { label: "Settings", icon: "settings", onClick: () => setShowSettings(true) },
                { label: dark ? "Light mode" : "Dark mode", icon: dark ? "sun" : "moon", onClick: () => settings.onTheme(dark ? "light" : "dark") },
                { label: "Lock", icon: "lock", onClick: onLock },
              ]} />
            </div>
          </header>
        )}

        {settings.bio.offer && !bioDismissed && (
          <div className="banner bio-offer">
            <Icon name={bioIcon()} size={22} />
            <div className="grow">
              <strong>Unlock with {settings.bio.label} next time?</strong>
              <BioSetup compact pin={settings.bio.pin} sealed={settings.sealed} onDone={settings.bio.onEnrolled}
                onCancel={() => { settings.bio.onDismissOffer(); setBioDismissed(true); }} />
            </div>
          </div>
        )}

        {!settings.sealed.pin && (
          <div className="banner">
            <Icon name="key" />
            <span className="grow">Switch from your passphrase to a 9-digit PIN to unlock with the number pad.</span>
            <button className="btn sm" onClick={() => setShowSettings(true)}>Switch</button>
          </div>
        )}

        {settings.recovery.join && (
          <div className="banner">
            <Icon name="key" />
            <span className="grow">This wallet was upgraded on another device. Enter its recovery key to keep syncing.</span>
            <button className="btn sm" onClick={() => setShowSettings(true)}>Enter</button>
          </div>
        )}

        <div className="spot" ref={spotRef}>
        {cards.length === 0 ? (
          !searching && (
            <div className="empty">
              <div className="empty-card"><CardFace card={{ bank: "Your first card", nickname: "Wallet", kind: "credit", network: "visa", number: "", expiry: "", cvv: "", colors: ["#0a84ff", "#5e5ce6"] }} /></div>
              <h2>No cards yet</h2>
              <p className="muted">Add a card, then snap a photo of it so it looks like the real one. Everything stays encrypted on this device.</p>
              <button className="btn primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add your first card</button>
            </div>
          )
        ) : shown.length === 0 ? (
          <p className="muted center pad">No cards match.</p>
        ) : (
          <ul className="stack" aria-label="Cards">
            {shown.map((c, i) => <CardTile key={c.id} card={c} index={i} onOpen={openCard} />)}
          </ul>
        )}

        <DocsView docs={docs} save={saveDocs} adding={addingDoc} onAdded={doneAddingDoc} query={filter === "all" ? deferredQuery : null}
          activeId={spot.activeId} onBring={spot.bring} />

        {!searching && (cards.length > 0 || docs.length > 0) && (
          <p className="wallet-foot">
            {cards.length} card{cards.length === 1 ? "" : "s"}{docs.length ? ` · ${docs.length} ID${docs.length === 1 ? "" : "s"}` : ""} · encrypted on this device
          </p>
        )}
        </div>
      </main>

      {!searching && (cards.length > 0 || docs.length > 0) && (
        <button type="button" className="search-fab" onClick={() => setSearching(true)} aria-label="Search"><Icon name="search" size={24} /></button>
      )}

      {open && (
        <Detail card={open} onClose={closeCard}
          pile={shown.filter((c) => c.id !== open.id).slice(0, 4).map((c, k) => (
            <div key={c.id} className="pile-card" style={{ "--k": k } as React.CSSProperties}><CardFace card={c} /></div>
          ))}
          onEdit={() => { setEditing(open); setOpenId(null); }}
          onToggleFavorite={() => upsert({ ...open, favorite: !open.favorite, updatedAt: Date.now() })}
          onDelete={async () => { await save(cards.filter((c) => c.id !== open.id)); setOpenId(null); }} />
      )}
      {editing && (
        <Editor card={editing === "new" ? null : editing} categories={categories} onClose={() => setEditing(null)}
          onSave={async (card) => { await upsert(card); setEditing(null); setOpenId(card.id); }} />
      )}
      {showSettings && <Settings {...settings} onClose={() => setShowSettings(false)} />}
    </>
  );
}

// memoised so typing in search or opening a card does not re-render every card in a long list
const CardTile = React.memo(function CardTile({ card: c, index, onOpen }: { card: Card; index: number; onOpen: (id: string) => void }) {
  const exp = expiryState(c.expiry);
  const open = useCallback(() => { haptic(); onOpen(c.id); }, [onOpen, c.id]);
  return (
    <li data-tile={c.id} style={{ "--i": index } as React.CSSProperties}>
      <CardFace card={c} onClick={open} label={`Open ${c.nickname || c.bank} ending ${last4(c.number)}`} />
      {exp !== "ok" && (
        <div className="card-badges">
          <span className={`chip ${exp === "expired" ? "danger" : "warn"}`}>{exp === "expired" ? "Expired" : "Expires soon"}</span>
        </div>
      )}
    </li>
  );
});

function useTheme(pref: ThemePref) {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const t = pref === "system" ? (mq.matches ? "dark" : "light") : pref;
      document.documentElement.dataset.theme = t;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#08090d" : "#f5f6fa");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);
}

/** Locks after `minutes` without input, and when the page comes back after a minute in the background. Veils it while hidden. */
function useAutoLock(active: boolean, minutes: number, lock: () => void) {
  useEffect(() => {
    if (!active) return;
    let timer = setTimeout(lock, minutes * 60_000);
    let hiddenAt = 0;
    const poke = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, minutes * 60_000);
    };
    const onVisibility = () => {
      document.body.classList.toggle("veiled", document.hidden);
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_LOCK_MS) lock();
      else poke();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, poke, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, poke));
      document.removeEventListener("visibilitychange", onVisibility);
      document.body.classList.remove("veiled");
    };
  }, [active, minutes, lock]);
}
