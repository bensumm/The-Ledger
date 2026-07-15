#!/usr/bin/env node
/**
 * limits.mjs — the BUY-LIMIT read for a Claude session. "Can I buy more X? / how much limit left?"
 *
 *   node pipeline/read-buy-limits.mjs "<item or id>" [...more]
 *       Per-item: limit, bought this 4h window, remaining, and when capacity next frees / fully resets.
 *   node pipeline/read-buy-limits.mjs
 *       No args → report every item with a logged BUY in the last 4h.
 *
 * Reads the repo-root fills.json (the RuneLite-logged fills) + loadMapping (names/limits). NO market
 * fetch. Window math + its honesty limits (logged fills are a LOWER bound, unlogged/mobile buys are
 * invisible, so `remaining` is an UPPER bound; null limit = UNKNOWN, never unlimited) live in
 * pipeline/lib/limits.mjs. All displayed times are LOCAL (repo rule).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMapping } from './lib/marketfetch.mjs';
import { buysByItem, limitWindow, LIMIT_WINDOW_SEC } from './lib/limits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILLS = path.join(HERE, '..', 'fills.json');

const args = process.argv.slice(2);
const tokens = args.filter(a => !a.startsWith('--'));

// LOCAL wall-clock HH:MM for a unix-SECONDS instant (repo rule: rendered times are local).
function hhmm(tsSec) {
  if (tsSec == null) return '—';
  return new Date(tsSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function itemLine(name, limit, w) {
  const limS = limit == null ? 'limit UNKNOWN (null — treat as cannot-advise, NOT unlimited)'
                             : `limit ${limit.toLocaleString()}/4h`;
  const boughtS = `bought ${w.boughtInWindow.toLocaleString()} this window`;
  const remS = w.remaining == null ? 'remaining unknown'
             : w.remaining === 0 ? '0 left — EXHAUSTED'
             : `${w.remaining.toLocaleString()} left`;
  let resetS = '';
  if (w.boughtInWindow > 0) {
    resetS = (w.remaining === 0 || w.remaining == null)
      ? ` · fully resets ~${hhmm(w.fullResetAt)}`
      : ` · next frees ~${hhmm(w.nextFreeAt)} · fully resets ~${hhmm(w.fullResetAt)}`;
  }
  return `- ${name}: ${limS} · ${boughtS} · ${remS}${resetS}`;
}

async function main() {
  const map = await loadMapping();
  let events;
  try { events = JSON.parse(fs.readFileSync(FILLS, 'utf8')).events || []; }
  catch (e) { console.error('cannot read fills.json: ' + ((e && e.message) || e)); process.exit(1); }
  const byItem = buysByItem(events);
  const now = Date.now();
  const cutoff = Math.floor(now / 1000) - LIMIT_WINDOW_SEC;

  let ids;
  if (tokens.length) {
    ids = [];
    for (const t of tokens) {
      const hit = map.resolve(t);
      if (!hit) { console.error(`! no item named "${t}" — check spelling or pass a numeric id`); continue; }
      ids.push(hit.id);
    }
    if (!ids.length) process.exit(1);
  } else {
    // no args → every item with a logged buy still inside the 4h window (most-recently-bought first)
    ids = [...byItem.keys()]
      .filter(id => byItem.get(id).some(b => b.ts > cutoff))
      .sort((a, b) => Math.max(...byItem.get(b).map(x => x.ts)) - Math.max(...byItem.get(a).map(x => x.ts)));
    if (!ids.length) { console.log('No logged GE buys in the last 4h (nothing counting against a buy limit).'); return; }
    console.log(`# Buy-limit state — ${ids.length} item(s) with a logged buy in the last 4h`);
  }

  for (const id of ids) {
    const name = map.byId[id]?.name || ('#' + id);
    const limit = map.byId[id]?.limit ?? null;
    const w = limitWindow({ buys: byItem.get(id) || [], limit, now });
    console.log(itemLine(name, limit, w));
  }
  console.log('(logged fills only — a mobile/unlogged buy is invisible, so "left" is an UPPER bound.)');
}

await main();
