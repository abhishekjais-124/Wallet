import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { digits, expiryState, last4, NETWORK_LABEL, type Card } from "@shared/card.ts";
import { mergeById, type IdDoc } from "@shared/doc.ts";
import { isPin, open as openVault, seal, type SealedVault, type VaultKey } from "@shared/vault.ts";
import { available as bioAvailable, bioLabel, enrolled as bioEnrolled, forget as bioForget } from "./bio.ts";
import { bioIcon, BioSetup } from "./components/BioSetup.tsx";
import { account, CLIENT_ID, signIn, signOut, takeRedirect, token } from "./google.ts";
import { flushBlobs } from "./blobs.ts";
import { clearMeta, meta, pull, push, setMeta, whoAmI } from "./sync.ts";
import { CardFace } from "./components/CardFace.tsx";
import { Detail } from "./components/Detail.tsx";
import { DocsView } from "./components/Docs.tsx";
import { Editor } from "./components/Editor.tsx";
import { Lock } from "./components/Lock.tsx";
import { Settings } from "./components/Settings.tsx";
import { eraseSealed, getPref, loadSealed, saveSealed, setPref, type SortBy, type ThemePref, type VaultData } from "./store.ts";
import { Icon, ToastHost } from "./ui.tsx";

interface Session {
  vk: VaultKey;
  cards: Card[];
  docs: IdDoc[];
}

export interface SyncState {
  status: "off" | "syncing" | "ok" | "error";
  email?: string | null;
  message?: string | undefined;
  at?: number;
}

const HIDDEN_LOCK_MS = 60_000;
const SILENT_KEY = "wallet.google.silentTried";

export function App() {
  const [sealed, setSealed] = useState<SealedVault | null>(loadSealed);
  const [session, setSession] = useState<Session | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => getPref<ThemePref>("theme", "system"));
  const [lockMinutes, setLockMinutes] = useState(() => getPref<number>("lockMinutes", 5));
  useTheme(theme);

  const lock = useCallback(() => { setSession(null); setKnownPin(null); }, []);
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

  // every change re-seals the whole vault with a fresh IV before the UI shows it; docs default to the open ones
  const persist = useCallback(async (cards: Card[], vk: VaultKey, docs: IdDoc[] = sessionRef.current?.docs ?? []) => {
    const s = await seal({ cards, docs }, vk);
    saveSealed(s);
    setSealed(s);
    setSession({ vk, cards, docs });
    upload(s);
  }, [upload]);

  /** Takes the newer Drive copy. Open on this device, it is decrypted with the current key; a different PIN locks. */
  const adopt = useCallback(async (remote: SealedVault) => {
    saveSealed(remote);
    setSealed(remote);
    setMeta({ syncedAt: remote.savedAt ?? 0, dirty: false });
    const open = sessionRef.current;
    if (!open) return;
    try {
      const data = await openVault<VaultData>(remote, open.vk);
      setSession({ vk: open.vk, cards: data.cards, docs: data.docs ?? [] });
    } catch {
      setSession(null);
    }
  }, []);

  /** Both sides changed: union of cards and of documents, the more recently edited copy of each wins. */
  const merge = useCallback(async (remote: SealedVault, vk: VaultKey, cards: Card[], docs: IdDoc[]) => {
    pendingMerge.current = null;
    try {
      const theirs = await openVault<VaultData>(remote, vk);
      await persist(mergeById(cards, theirs.cards), vk, mergeById(docs, theirs.docs ?? []));
    } catch {
      // still open this device's own cards; only the merge is skipped
      setSession({ vk, cards, docs });
      setSync({ status: "error", email: account(), message: "The wallet in Google Drive uses a different PIN, so it was not merged. Set the same PIN on both devices, then Sync now." });
    }
  }, [persist]);

  const syncNow = useCallback(async () => {
    if (!CLIENT_ID || !account()) return setSync({ status: "off" });
    if (!token()) {
      // one silent round trip to Google per app launch, only while locked so nothing in progress is lost
      if (!sessionRef.current && !sessionStorage.getItem(SILENT_KEY)) {
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
      } else if (remoteAt === localAt) {
        setMeta({ syncedAt: remoteAt, dirty: false });
      } else if (m.syncedAt === 0 || (m.dirty && remoteAt > m.syncedAt)) {
        // never synced here, or both sides changed: merge, never overwrite the Drive copy blindly
        const open = sessionRef.current;
        if (open) await merge(remote, open.vk, open.cards, open.docs);
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

  useEffect(() => {
    const back = takeRedirect();
    if (back && !back.ok) setSync({ status: "error", email: account(), message: back.error === "interaction_required" || back.error === "login_required" ? "Sign in again to sync." : back.error });
    (back?.ok ? whoAmI().then(() => sessionStorage.removeItem(SILENT_KEY), () => {}) : Promise.resolve()).then(() => void syncNow());
    const onVisible = () => document.visibilityState === "visible" && void syncNow();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [syncNow]);

  return (
    <ToastHost>
      {!session || !sealed ? (
        <Lock sealed={sealed} onCreated={(s) => { setSealed(s); void syncNow(); }} onOpen={(vk, data, secret) => {
          setKnownPin(isPin(secret) ? secret : null); // kept only while unlocked, so Face ID can be set up without retyping it
          const remote = pendingMerge.current;
          const docs = data.docs ?? [];
          if (remote) void merge(remote, vk, data.cards, docs);
          // an older vault opened with nine digits is re-sealed once, so it is marked as a PIN vault from now on
          else if (vk.pin && sealed && !sealed.pin) void persist(data.cards, vk, docs);
          else setSession({ vk, cards: data.cards, docs });
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
            onRekey: (vk) => { if (bioOn) { bioForget(); setBioOn(false); } setKnownPin(null); return persist(session.cards, vk); },
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
  const [sortBy, setSortBy] = useState<SortBy>(() => getPref<SortBy>("sort", "recent"));
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | "new" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bioDismissed, setBioDismissed] = useState(false);
  const [tab, setTabState] = useState<"cards" | "ids">(() => (getPref<string>("tab", "cards") === "ids" ? "ids" : "cards"));
  const setTab = (t: "cards" | "ids") => { setTabState(t); setPref("tab", t); };
  const [addingDoc, setAddingDoc] = useState(false);
  const doneAddingDoc = useCallback(() => setAddingDoc(false), []);

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
      .sort((a, b) =>
        Number(b.favorite) - Number(a.favorite)
        || (sortBy === "bank" ? a.bank.localeCompare(b.bank)
          : sortBy === "expiry" ? expiryKey(a.expiry) - expiryKey(b.expiry)
            : b.updatedAt - a.updatedAt));
  }, [cards, deferredQuery, filter, sortBy]);

  const open = cards.find((c) => c.id === openId) ?? null;
  const upsert = async (card: Card) => {
    await save(cards.some((c) => c.id === card.id) ? cards.map((c) => (c.id === card.id ? card : c)) : [...cards, card]);
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="wordmark"><span className="dot" />Wallet</span>
          <div className="topbar-actions">
            <button className="btn icon ghost" onClick={() => settings.onTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
              <Icon name={document.documentElement.dataset.theme === "dark" ? "sun" : "moon"} />
            </button>
            <button className="btn icon ghost" onClick={() => setShowSettings(true)} aria-label="Settings"><Icon name="settings" /></button>
            <button className="btn icon ghost" onClick={onLock} aria-label="Lock"><Icon name="lock" /></button>
          </div>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <span className="eyebrow">
            {tab === "cards" ? `${cards.length} card${cards.length === 1 ? "" : "s"}` : `${docs.length} ID${docs.length === 1 ? "" : "s"}`} · encrypted on this device
          </span>
          <div className="hero-row">
            <h1>{tab === "cards" ? "Your cards" : "Your IDs"}</h1>
            <button className="btn primary" onClick={() => (tab === "cards" ? setEditing("new") : setAddingDoc(true))}>
              <Icon name="plus" /> {tab === "cards" ? "Add card" : "Add ID"}
            </button>
          </div>
          <div className="tabs" role="tablist" aria-label="Wallet sections">
            <button role="tab" aria-selected={tab === "cards"} className={tab === "cards" ? "on" : ""} onClick={() => setTab("cards")}>
              <Icon name="card" size={17} /> Cards <span className="count">{cards.length}</span>
            </button>
            <button role="tab" aria-selected={tab === "ids"} className={tab === "ids" ? "on" : ""} onClick={() => setTab("ids")}>
              <Icon name="idcard" size={17} /> IDs <span className="count">{docs.length}</span>
            </button>
          </div>
        </section>

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

        {tab === "ids" ? <DocsView docs={docs} save={saveDocs} adding={addingDoc} onAdded={doneAddingDoc} /> : <>
        {cards.length > 0 && (
          <div className="toolbar">
            <div className="search">
              <Icon name="search" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search bank, name, last four…" aria-label="Search cards" autoComplete="off" />
            </div>
            <div className="filter-row">
              <div className="chips" role="tablist" aria-label="Filter cards">
                {filters.map((f) => (
                  <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip-btn${filter === f.id ? " on" : ""}`} onClick={() => setFilter(f.id)}>{f.label}</button>
                ))}
              </div>
              <select className="sort" value={sortBy} onChange={(e) => { setSortBy(e.target.value as SortBy); setPref("sort", e.target.value); }} aria-label="Sort cards">
                <option value="recent">Recent</option>
                <option value="bank">Bank</option>
                <option value="expiry">Expiry</option>
              </select>
            </div>
          </div>
        )}

        {cards.length === 0 ? (
          <div className="empty">
            <div className="empty-card"><CardFace card={{ bank: "Your first card", nickname: "Wallet", kind: "credit", network: "visa", number: "", expiry: "", cvv: "", colors: ["#6f86ff", "#9a73ff"] }} /></div>
            <h2>No cards yet</h2>
            <p className="muted">Add a card, then snap a photo of it so it looks like the real one. Everything stays encrypted on this device.</p>
            <button className="btn primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add your first card</button>
          </div>
        ) : shown.length === 0 ? (
          <p className="muted center pad">No cards match.</p>
        ) : (
          <ul className="card-grid">
            {shown.map((c, i) => <CardTile key={c.id} card={c} index={i} onOpen={setOpenId} />)}
          </ul>
        )}
        </>}
      </main>

      {open && (
        <Detail card={open} onClose={() => setOpenId(null)}
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

// memoised so typing in search or opening a sheet does not re-render every card in a long list
const CardTile = React.memo(function CardTile({ card: c, index, onOpen }: { card: Card; index: number; onOpen: (id: string) => void }) {
  const exp = expiryState(c.expiry);
  const open = useCallback(() => onOpen(c.id), [onOpen, c.id]);
  return (
    <li style={{ "--i": index } as React.CSSProperties}>
      <CardFace card={c} onClick={open} label={`Open ${c.nickname || c.bank} ending ${last4(c.number)}`} />
      {(c.favorite || exp !== "ok") && (
        <div className="card-badges">
          {c.favorite && <span className="chip fav"><Icon name="star" size={11} /></span>}
          {exp !== "ok" && <span className={`chip ${exp === "expired" ? "danger" : "warn"}`}>{exp === "expired" ? "Expired" : "Expires soon"}</span>}
        </div>
      )}
    </li>
  );
});

const expiryKey = (e: string) => {
  const [mm, yy] = e.split("/").map(Number);
  return (yy ?? 0) * 12 + (mm ?? 0);
};

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
