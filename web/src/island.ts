import { last4, NETWORK_LABEL, type Card } from "@shared/card.ts";

/**
 * The card in the iPhone's Dynamic Island while its number is in the clipboard, for one minute (ios/Wallet/Island.swift
 * and the WalletIsland extension). Only what is printed on the face goes to the island; the full number goes to the
 * clipboard, which clears itself after the minute. Nothing here works outside the Wallet iPhone app.
 */
type Native = { postMessage: (m: Record<string, unknown>) => Promise<unknown> };
const native = (window as { webkit?: { messageHandlers?: { walletIsland?: Native } } }).webkit?.messageHandlers?.walletIsland;

export const islandSupported = !!native;

export async function islandAvailable(): Promise<boolean> {
  return !!(await native?.postMessage({ op: "available" }).catch(() => false));
}

export async function showInIsland(card: Card): Promise<void> {
  if (!native) throw new Error("Only in the Wallet iPhone app.");
  await native.postMessage({
    op: "show", number: card.number, bank: card.bank, name: card.nickname || card.bank, last4: last4(card.number),
    expiry: card.expiry, network: NETWORK_LABEL[card.network], color1: card.colors[0], color2: card.colors[1],
  });
}
