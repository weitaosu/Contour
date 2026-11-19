"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { desk } from "./desk";

const KEY = "contour.paperAccount.v1";

/**
 * This browser's paper account: a random id kept in localStorage, made the first time it's needed.
 * Null until mounted (localStorage doesn't exist on the server). If storage is blocked, the id lasts
 * for this visit only.
 */
export function usePaperAccount(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let v: string | null = null;
    try {
      v = localStorage.getItem(KEY);
    } catch {
      // storage blocked: fall through to a session-only id
    }
    if (!v || !/^[A-Za-z0-9-]{8,64}$/.test(v)) {
      v = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `acct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        localStorage.setItem(KEY, v);
      } catch {
        // keep it for this visit
      }
    }
    setId(v);
  }, []);
  return id;
}

/** Positions are revalued at the live bids this often (Kalshi-style cash-out estimates). */
export const PORTFOLIO_MS = 10_000;

export function usePortfolio() {
  const account = usePaperAccount();
  const q = useQuery({
    queryKey: ["paper", account],
    queryFn: () => desk.paperPortfolio(account!),
    enabled: !!account,
    refetchInterval: PORTFOLIO_MS,
    placeholderData: (prev) => prev,
  });
  return { account, ...q };
}

export function usePaperPosition(id: string) {
  const account = usePaperAccount();
  const q = useQuery({
    queryKey: ["paper", account, id],
    queryFn: () => desk.paperPosition(account!, id),
    enabled: !!account,
    refetchInterval: PORTFOLIO_MS,
    placeholderData: (prev) => prev,
    retry: false,
  });
  return { account, ...q };
}

/** Plain words for a strategy, for tags and headings. */
export const strategyName = { view: "Your view", near: "Stays near", spread: "Spread", protect: "Protection" } as const;
