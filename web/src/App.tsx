import React, { useCallback, useEffect, useMemo, useState } from "react";
import { digits, expiryState, last4, NETWORK_LABEL, type Card } from "@shared/card.ts";
import { seal, type SealedVault, type VaultKey } from "@shared/vault.ts";
import { CardFace } from "./components/CardFace.tsx";
import { Detail } from "./components/Detail.tsx";
import { Editor } from "./components/Editor.tsx";
import { Lock } from "./components/Lock.tsx";
import { Settings } from "./components/Settings.tsx";
import { eraseSealed, getPref, loadSealed, saveSealed, setPref, type SortBy, type ThemePref } from "./store.ts";
import { Icon, ToastHost } from "./ui.tsx";

interface Session {
  vk: VaultKey;
  cards: Card[];
}

const HIDDEN_LOCK_MS = 60_000;

export function App() {
  const [sealed, setSealed] = useState<SealedVault | null>(loadSealed);
  const [session, setSession] = useState<Session | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => getPref<ThemePref>("theme", "system"));
  const [lockMinutes, setLockMinutes] = useState(() => getPref<number>("lockMinutes", 5));
  useTheme(theme);

  const lock = useCallback(() => setSession(null), []);
  useAutoLock(!!session, lockMinutes, lock);

  // every change re-seals the whole vault with a fresh IV before the UI shows it
  const persist = useCallback(async (cards: Card[], vk: VaultKey) => {
    const s = await seal({ cards }, vk);
    saveSealed(s);
    setSealed(s);
    setSession({ vk, cards });
  }, []);

  return (
    <ToastHost>
      {!session || !sealed ? (
        <Lock sealed={sealed} onCreated={setSealed} onOpen={(vk, data) => setSession({ vk, cards: data.cards })} />
      ) : (
        <WalletView
          cards={session.cards}
          save={(cards) => persist(cards, session.vk)}
          onLock={lock}
          settings={{
            theme,
            onTheme: (t) => { setTheme(t); setPref("theme", t); },
            lockMinutes,
            onLockMinutes: (m) => { setLockMinutes(m); setPref("lockMinutes", m); },
            sealed,
            cards: session.cards,
            onReplace: (cards) => persist(cards, session.vk),
            onRekey: (vk) => persist(session.cards, vk),
            onErase: () => { eraseSealed(); setSealed(null); setSession(null); },
          }}
        />
      )}
    </ToastHost>
  );
}

type SettingsProps = Omit<React.ComponentProps<typeof Settings>, "onClose">;

function WalletView({ cards, save, onLock, settings }: {
  cards: Card[];
  save: (cards: Card[]) => Promise<void>;
  onLock: () => void;
  settings: SettingsProps;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortBy>(() => getPref<SortBy>("sort", "recent"));
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | "new" | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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
    const q = query.trim().toLowerCase();
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
  }, [cards, query, filter, sortBy]);

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
          <span className="eyebrow">{cards.length} card{cards.length === 1 ? "" : "s"} · encrypted on this device</span>
          <div className="hero-row">
            <h1>Your cards</h1>
            <button className="btn primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add card</button>
          </div>
        </section>

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
            <div className="empty-card"><CardFace card={{ bank: "Your first card", holder: "", kind: "credit", network: "visa", number: "", expiry: "", cvv: "", colors: ["#6f86ff", "#9a73ff"] }} /></div>
            <h2>No cards yet</h2>
            <p className="muted">Add a card and snap a photo of it to keep its colours. Everything stays encrypted on this device.</p>
            <button className="btn primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add your first card</button>
          </div>
        ) : shown.length === 0 ? (
          <p className="muted center pad">No cards match.</p>
        ) : (
          <ul className="card-grid">
            {shown.map((c, i) => {
              const exp = expiryState(c.expiry);
              return (
                <li key={c.id} style={{ "--i": i } as React.CSSProperties}>
                  <CardFace card={c} onClick={() => setOpenId(c.id)} label={`Open ${c.nickname || c.bank} ending ${last4(c.number)}`} />
                  <div className="card-meta">
                    <span className="card-name">{c.favorite && <Icon name="star" size={13} />}{c.nickname || c.bank}</span>
                    <span className="card-sub">
                      {exp !== "ok" && <span className={`chip ${exp === "expired" ? "danger" : "warn"}`}>{exp === "expired" ? "Expired" : "Expires soon"}</span>}
                      {c.category}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
