/* frozen-market.mjs — preload that records or replays every fetch and pins the clock (PLAN-LEAN LN0).
 *
 *   COFFER_FROZEN=<dir> COFFER_FROZEN_MODE=record|replay NODE_OPTIONS="--import file:///<this file>" node pipeline/commands/…
 *
 * Run it ONLY in a separate clone with its own data and archive copy, with USERPROFILE pointed at a copied home and
 * COFFER_NO_CHORES=1. Replay never touches the network: an unrecorded URL throws. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dir = process.env.COFFER_FROZEN, mode = process.env.COFFER_FROZEN_MODE;
if (dir && (mode === 'record' || mode === 'replay')) {
  fs.mkdirSync(dir, { recursive: true });
  const clock = path.join(dir, 'clock');
  if (mode === 'record' && !fs.existsSync(clock)) fs.writeFileSync(clock, String(Date.now()));
  const fixed = +fs.readFileSync(clock, 'utf8');
  const Real = Date;
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(fixed); }
    static now() { return fixed; }
  };
  const live = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const f = path.join(dir, createHash('sha1').update(String(url)).digest('hex') + '.json');
    if (fs.existsSync(f)) return new Response(JSON.parse(fs.readFileSync(f, 'utf8')).body, { status: 200 });
    if (mode === 'replay') throw new Error('frozen-market: not in the snapshot: ' + url);
    const r = await live(url, opts);
    const body = await r.text();
    if (r.ok) fs.writeFileSync(f, JSON.stringify({ url: String(url), body }));
    return new Response(body, { status: r.status });
  };
}
