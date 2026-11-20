"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, MessageCircle, RotateCcw, X } from "lucide-react";
import { env } from "@/lib/env";

type Msg = { role: "user" | "assistant"; content: string };

/** Questions to start from: general ones everywhere, plus two about the market on screen. */
const GENERAL = ["Which markets are busiest today, and why?", "What's moving prediction markets this week?", "How does Contour's curve differ from one contract?"];
const ON_MARKET = ["Why is this price moving?", "What do these odds imply?"];

/** What Grok is doing while it works, in the order it usually does it; the last one stays. */
const STEPS = ["Searching the web…", "Reading posts on X…", "Checking the market's odds…", "Thinking it through…"];

/** While Grok works (searches take 20–30 s): three bouncing dots and a status line that moves through STEPS. */
function Thinking() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4_500);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="flex items-center gap-2.5 py-0.5 text-slate" role="status" aria-live="polite">
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="think-dot" />
        <span className="think-dot" />
        <span className="think-dot" />
      </span>
      <span key={step} className="think-text text-[13.5px]">
        {STEPS[step]}
      </span>
    </span>
  );
}

/** A markdown link, including Grok's citations ("[[1]](url)", shown as a small numbered source link). */
const LINK = /(\[\[?[^\]]+\]?\]\(https?:\/\/[^\s)]+\))/g;

function Inline({ s }: { s: string }) {
  return (
    <>
      {s.split(LINK).map((part, i) => {
        const link = part.match(/^\[(\[?)([^\]]+)\]?\]\((https?:\/\/[^\s)]+)\)$/);
        if (link) {
          const [, cite, label, href] = link;
          return cite ? (
            <a key={i} href={href} target="_blank" rel="noreferrer" title={href} className="mx-0.5 align-super text-[10.5px] font-bold text-slate no-underline hover:text-inkstone">
              [{label}]
            </a>
          ) : (
            <a key={i} href={href} target="_blank" rel="noreferrer" className="link">
              {label}
            </a>
          );
        }
        return part.split(/(\*\*[^*]+\*\*)/g).map((p, k) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={`${i}-${k}`}>{p.slice(2, -2)}</b> : <Fragment key={`${i}-${k}`}>{p}</Fragment>));
      })}
    </>
  );
}

/** Bold, links and Grok's source citations, and lines starting with "- " or "* " as bullets: enough markdown to read well. */
function Rich({ text }: { text: string }) {
  const inline = (s: string) => <Inline s={s} />;
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length)
      blocks.push(
        <ul key={`u${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-5">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^#{1,6}\s+/, "");
    const m = line.match(/^\s*[-*•]\s+(.*)$/);
    if (m) {
      bullets.push(m[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`} className="my-1">{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

/**
 * "Ask Grok": a chat bubble in the bottom-right corner. Questions go to the desk, which answers with
 * xAI's Grok and live market data (and the market on screen, on a market page). Replies stream in.
 */
export function GrokChat() {
  const path = usePathname();
  const ticker = path.startsWith("/m/") ? decodeURIComponent(path.slice(3).split("/")[0]) : null;
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const status = useQuery({
    queryKey: ["chat-status"],
    queryFn: () => fetch(`${env.deskUrl}/chat/status`).then((r) => r.json() as Promise<{ enabled: boolean; model: string }>),
    staleTime: 60_000,
    enabled: open,
  });

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [msgs, open]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => () => abort.current?.abort(), []);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history: Msg[] = [...msgs, { role: "user", content: question }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setText("");
    setErr(null);
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const res = await fetch(`${env.deskUrl}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-20), ...(ticker ? { ticker } : {}) }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        let msg = `The chat isn't answering (${res.status}).`;
        try {
          msg = ((await res.json()) as { error?: string }).error ?? msg;
        } catch {}
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let answer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += dec.decode(value, { stream: true });
        setMsgs([...history, { role: "assistant", content: answer }]);
      }
      if (!answer.trim()) throw new Error("Grok sent back an empty answer. Try asking again.");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr((e as Error).message);
      setMsgs(history); // drop the empty reply; the question stays so it can be retried
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  const suggestions = ticker ? [...ON_MARKET, GENERAL[0]] : GENERAL;
  const off = status.data && !status.data.enabled;

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="Ask Grok"
          className="fade-up fixed bottom-[140px] right-3 z-40 flex h-[min(600px,calc(100dvh-170px))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] bg-porcelain shadow-[0_24px_64px_-20px_rgba(0,0,0,0.35)] ring-1 ring-mist lg:bottom-[76px] lg:right-5 lg:h-[min(620px,calc(100dvh-110px))]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-mist px-4 py-3">
            <div>
              <p className="text-[15px] font-bold text-inkstone">Ask Grok</p>
              <p className="text-[12.5px] text-slate">{ticker ? "About this market, or any other" : "Which markets to watch, why prices move"}</p>
            </div>
            <div className="flex items-center gap-1">
              {msgs.length > 0 && (
                <button
                  type="button"
                  className="rounded-full p-2 text-slate hover:bg-cloud hover:text-inkstone"
                  aria-label="Start a new chat"
                  title="New chat"
                  onClick={() => {
                    abort.current?.abort();
                    setMsgs([]);
                    setErr(null);
                    setBusy(false);
                  }}
                >
                  <RotateCcw size={16} />
                </button>
              )}
              <button type="button" className="rounded-full p-2 text-slate hover:bg-cloud hover:text-inkstone" aria-label="Close chat" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
          </header>

          <div ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 text-[14px] leading-snug">
            {off ? (
              <p className="rounded-[16px] bg-cloud px-4 py-3 text-slate">Ask Grok isn&apos;t set up yet: the desk needs an xAI API key (XAI_API_KEY).</p>
            ) : msgs.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-slate">Ask about markets to watch, why a price is moving, or what the odds are saying. Grok sees Contour&apos;s live markets{ticker ? " and this one" : ""}.</p>
                <div className="mt-1 flex flex-col items-start gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="ease rounded-full border border-mist px-3 py-1.5 text-left text-[13px] font-bold text-inkstone hover:border-ash" onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              msgs.map((m, i) =>
                m.role === "user" ? (
                  <p key={i} className="max-w-[85%] self-end whitespace-pre-wrap rounded-[18px] rounded-br-[6px] bg-night px-3.5 py-2 text-porcelain">
                    {m.content}
                  </p>
                ) : (
                  <div key={i} className="max-w-[92%] self-start rounded-[18px] rounded-bl-[6px] bg-cloud px-3.5 py-2 text-inkstone">
                    {m.content ? <Rich text={m.content} /> : <Thinking />}
                  </div>
                ),
              )
            )}
            {err && <p className="rounded-[16px] bg-cloud px-4 py-3 text-[13.5px] text-inkstone">{err}</p>}
          </div>

          <form
            className="flex items-end gap-2 border-t border-mist px-3 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
          >
            <textarea
              ref={input}
              rows={1}
              value={text}
              disabled={!!off}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(text);
                }
              }}
              placeholder={ticker ? "Ask about this market…" : "Ask about the markets…"}
              aria-label="Your question"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-[16px] bg-cloud px-3.5 py-2.5 text-[14px] text-inkstone outline-none placeholder:text-smoke focus:ring-2 focus:ring-mist"
            />
            <button type="submit" disabled={busy || !text.trim() || !!off} aria-label="Send" className="btn btn-primary !h-10 !w-10 shrink-0 !p-0">
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          </form>
          <p className="px-4 pb-2.5 text-center text-[11.5px] text-smoke">Grok can be wrong. Not investment advice.</p>
        </section>
      )}

      {/* The bubble: above the phone order bar on small screens, in the corner on wide ones. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close Ask Grok" : "Ask Grok about the markets"}
        className="ease fixed bottom-[84px] right-3 z-40 flex h-12 items-center gap-2 rounded-full bg-night pl-4 pr-5 text-[14px] font-bold text-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.55)] hover:scale-[1.03] lg:bottom-4 lg:right-5"
      >
        {open ? <X size={20} strokeWidth={2.4} /> : <MessageCircle size={20} strokeWidth={2.4} />}
        Ask Grok
      </button>
    </>
  );
}
