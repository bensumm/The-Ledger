---
name: scan
version: 1.0
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

## 2. Judgment pass over the rated rows

This is the tribal layer the script can't do — apply ALL of these:

- **500k gp/day attention floor** (standing rule, memory `gpd-floor-500k`): drop every row
  with expected/score gp/day < 500k as a **post-gate filter** — below the floor a row isn't
  worth Ben's time regardless of grade. Held/asked items exempt, as always. The structural
  home is a future `--min-gpd` flag on `screen.mjs` (PLAN.md chunk S1); until that ships the
  filter lives here — switch to passing the flag once it exists.
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
- **Band-top artifact detection.** A single outlier print inflating the band (one lone
  100k print against a 59k mid) makes ROI look absurd — flag it and discount; never
  recommend off one print. Check `--min-active` traded-windows plausibility when a band
  ROI looks too good.
- **Fresh-repricer flag.** A large multi-day regime move = the item was recently repriced
  → overnight-retrace risk. Size small; skip for unattended holds.
- **Big-ticket caution.** High per-unit capital → each fill is expensive; require real
  gp-flow (units × net), not a unit count.
- **"Skip despite high grade."** Grade cutoffs are placeholders (`rating.mjs`); a good
  letter on a ghost-spread / thin / tax-eaten row is still a skip — say why in one line.

## 3. Hard rules (cited from CLAUDE.md's table contract — don't restate, don't violate)

- Falling-regime items are silently excluded by the script — never re-add or mention them.
  Exception: items Ben holds or explicitly asks about → always show, with price-to-clear.
- Preserve the standard 9-column table exactly as printed (app-code canon).

## 4. Output

The judgment-filtered shortlist, one-line rationale per pick (why this edge is real), plus
a note of how many candidates the 500k floor eliminated. If a high-grade row was skipped,
point at it and give the reason — that's the layer this skill exists for.
