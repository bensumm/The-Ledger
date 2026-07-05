---
name: scan
version: 1.5
description: Screen the GE market for flip opportunities and apply Ben's judgment layer over the rated output. Triggers — "find me flips", "any opportunities", "what should I buy", "screen the market", "anything in <niche>", "scan".
---

# /scan — opportunity screen + the judgment layer over it

Skills-versioning note: `version` here bumps on material behavior change; skills never bump
`APP_VERSION`.

## 1. Run the script — never hand-fetch

```
node pipeline/screen.mjs [--mode band|spread|rising|churn|all] [--max-price …] [--publish]
```

Map Ben's ask to args: niche mode → `--mode` (default `band`); a price cap → `--max-price`;
a keyword/niche ("anything in herbs?") → **no script flag exists** — run the screen and
filter the output rows by niche yourself; `--publish` only if Ben wants the app's Scan tab
updated. The script already gates (two-sided liquidity, price window, falling-exclusion)
and grades (`rating.mjs`); your job is the judgment pass over what it prints.

**Sync first (SY1).** The §5 position-context pass reads Ben's current book, and there is no
scheduled sync (on-demand only since the `CofferFillsSync` job was eliminated — FILLS-PIPELINE
§12). Run `node pipeline/sync-fills.mjs` before the position-context pass (in practice, at the
top of the scan) so held-inventory/offer context is current — it also ff-pulls `origin/main`
so any phone-logged trades are folded in (the multi-writer contract, §13.3).
**Run it from the MAIN checkout only (SY1.2):** the sync commits+pushes `fills.json`/
`positions.json` to `main` under the admin bypass, so run it from `C:\dev\The-Ledger`, **never
a git worktree** (a feature-branch context would push the artifacts to the wrong ref). If
you're in a worktree and can't reach the main checkout, SKIP the sync and note the book may be
stale. (When `/scan` runs inside `/overnight`, Phase 1 already synced via `/positions` — don't
re-run it.)

## 2. Judgment pass over the rated rows

This is the tribal layer the script can't do — apply ALL of these:

- **500k gp/day attention floor** (standing rule, memory `gpd-floor-500k`): NOW ENFORCED BY THE
  SCRIPT — `screen.mjs --min-gpd` (default 500_000) drops sub-floor rows pre-rating (S1), so you no
  longer post-filter. Just trust the printed rows and, if Ben wants a different bar, pass `--min-gpd
  <N>`. Thin gp-flow big tickets and held/asked items are floor-exempt by design.
- **24h-drift is a pre-filter only.** A current-vs-24h-avg read of "flat/slightly soft"
  repeatedly masks multi-day fallers. The screen's displayed Regime column is the real
  multi-day `regimeDrift` check — trust it, and never recommend off a 24h impression alone.
- **Two-sided liquidity discipline.** Real liquidity = a two-sided daily market
  (`lowPriceVolume>0 && highPriceVolume>0` on the 24h endpoint), never the `/volumes` count
  (bursty/weekly, overstates tradability). ~100/day limiting-side is the practical floor;
  below it the juicy "margins" are ghost-spreads (cosmetics, ornament kits — uncrossable).
- **Tax dominates thin flips.** The 2% tax eats most of a tight spread — need meaningfully
  >~0.5% after-tax to bother. Stable/tight ≠ profitable.
- **Band-is-the-edge pricing.** For a liquid item with a stable *regime* but a wide
  intraday band, the band IS the edge: ladder buys at band lows / sell at band tops (the
  crystal-teleport-seed lesson — the band beat mid-spread flips ~4:1). Never list below
  break-even; don't chase a softening item's buy.
- **Entry aggression follows posture (Ben, 2026-07-05).** When Ben is ACTIVELY flipping
  (at the client, watch loop running), price entries to FILL: recommend bids at or near
  the live instasell — or the upper half of the band — accepting a thinner per-unit edge
  so long as the exit still clears break-even meaningfully (the validated half-chase:
  bludgeon 2026-07-05, +292k). A band-floor bid watching a riser run away costs more in
  missed cycles than the floor discount saves — that day's chin/ring/jaw floor bids never
  filled. When Ben is PASSIVE (walking away / overnight), invert: deep optimistic /
  band-floor bids only, sized for the good payout if hit (`/overnight`'s fill-realism
  check governs), and never leave a near-live chase bid resting unattended — it fills
  into the first dip with nobody watching. State which posture a recommendation assumes.
- **Band-top artifact detection.** A single outlier print inflating the band (one lone
  100k print against a 59k mid) makes ROI look absurd — flag it and discount; never
  recommend off one print. Check `--min-active` traded-windows plausibility when a band
  ROI looks too good.
- **Fresh-repricer flag.** A large multi-day regime move = the item was recently repriced
  → overnight-retrace risk. Size small; skip for unattended holds.
- **Big-ticket caution.** High per-unit capital → each fill is expensive; require real
  gp-flow (units × net), not a unit count. The script now SURFACES these via the gp-flow gate,
  flagged `thin` and capped at grade A- with a "~N/day — size in units, expect slow fills" tooltip
  (S1). Treat a `thin` row honestly: the edge is real but you can only place a few units/day, fills
  are slow, and its wide band can be a thin-trading artifact — size in units, never chase.
- **"Skip despite high grade."** Grade cutoffs are placeholders (`rating.mjs`); a good
  letter on a ghost-spread / thin / tax-eaten row is still a skip — say why in one line.

## 3. Hard rules (cited from CLAUDE.md's table contract — don't restate, don't violate)

- Falling-regime items are silently excluded by the script — never re-add or mention them.
  Exception: items Ben holds, explicitly asks about, or **watchlists** → always show, with
  price-to-clear.
- **Watchlist section (S3): always report, honestly.** The script appends a Watchlist table (from
  repo-root `watchlist.json`) that is exempt from every floor/gate; each row carries a Note saying
  what a gate would have hidden (below-floor / thin / one-sided / falling). Never silently drop a
  watchlist row and never hype one past its read — surface it with its Note and one honest line.
  Falling watchlist items appear here with the falling warning (they're excluded from the niches).
- Preserve the standard table columns exactly as printed (app-code canon).

## 4. Output

The judgment-filtered shortlist, one-line rationale per pick (why this edge is real), plus
a note of how many candidates the 500k floor eliminated. If a high-grade row was skipped,
point at it and give the reason — that's the layer this skill exists for.

## 5. Position-context pass (Ben, 2026-07-05) — read the shortlist against the current book

A scan is not done until the picks are compared against where Ben's capital already sits.
After the shortlist, run `node pipeline/watch.mjs` (positions = held inventory + every
active offer) and close the loop:

- **Stale-bid displacement.** For each resting BUY offer, ask: does a shortlist pick offer
  a better expected edge than what that parked capital is waiting on? A bid that's
  BID-BEHIND with the floor rising away is a candidate to cancel and redeploy into a pick —
  say so explicitly with the two edges side by side.
- **Overlap check.** If a pick is something Ben already holds or bids, say that on the
  pick's line (don't recommend doubling a position blind — buy-limit and concentration
  both bite).
- **Held-ask sanity.** If a shortlist item's read contradicts a current ask's premise
  (e.g. the scan shows its band breaking down while Ben's ask rides the old top), flag it —
  that's the `/positions` step-down doctrine firing from the scan side.

This is a lightweight cross-check, not a full `/positions` review — don't re-verdict every
lot; only surface lines where the scan changes what an existing position should do. When
`/scan` runs inside `/overnight`, skip this pass (Phase 1 already resolved the book).

## 6. Encode learnings (self-improvement — after the market work, never during)

Each run may teach something (a judgment filter that misfired, a threshold that misled, a
band-artifact that fooled the grade). Capture it — but the shortlist comes first, always.

- **Timing:** only AFTER the shortlist is delivered and Ben's offers are placed/adjusted
  (or he says he's done). Never interleave doc edits with live market work — offers first,
  encoding after (Ben's explicit rule).
- **Prompt:** at that point ask one short question — "anything from this run worth
  encoding?" — and propose the candidates this run surfaced (a judgment call that
  worked/failed, a threshold that misled, a screen that hid/hyped a real edge, a gap).
- **Routing — one canonical home per fact, move never copy:** judgment-layer lessons → this
  SKILL.md (bump its `version:`); table/app contracts → CLAUDE.md; user preferences →
  Claude memory; monitoring doctrine → `pipeline/MONITORING.md`.
- **Execution:** spawn a **background subagent** to make the edits + commit so this
  conversation keeps flowing; report the diff summary when it lands.
- **Honesty guard (process rule 4):** process learnings encode freely; a *market* claim (a
  new threshold, a pattern) needs the usual evidence standard — one session is one sample.
