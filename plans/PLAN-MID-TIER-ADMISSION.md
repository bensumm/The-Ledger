# PLAN-MID-TIER-ADMISSION — the mid-price band is structurally invisible to the default scan

**Status:** problem statement only. No fix proposed, no chunk scoped. Surfaced 2026-07-26, Ben-flagged
("we haven't had any mid items enter — not big gear, not churn — stuff like neitiznot helm").

**Honesty (process rule 4):** every number below is from ONE scan pass on 2026-07-26. This is a
*structural* argument (the mechanism is in the code and the arithmetic is checkable), not a calibration
claim. Do not re-tune a threshold off this document's numbers alone.

---

## 1. The problem

The screen surfaces two populations — **big gear** (tiny buy limits, huge per-unit margins) and **churn
commodities** (huge limits, tiny margins, volume does the work). The band between them — call it
**mid-tier gear**, roughly 10k–2m mid, items like Helm of neitiznot, Berserker helm, Dragon scimitar —
has never appeared in a default `/scan`.

It is not that these items are unprofitable. Helm of neitiznot rates **B-** with **Path-A 420.7k/d** and
`+1,648/u (+3.5%)` at 6.2k/d volume. It is simply never fetched.

## 2. Evidence

Default scan (`--mode all`, `--top 40`): band lane printed **20 rated from 176 gated, top 41 fetched**.
Helm of neitiznot absent.

Same screen at `--top 150` (`--mode band --top 150 --no-publish`):

```
| Helm of neitiznot | 48,537 | 47,352 (2/3 · p93) | 49,999 (1/3) | +1,648 (+3.5%) · P~30% |
  48,319 | 6.2k/d | – | Flat · ranging | B- | 1,027 · net 1.6k P~0.15 ttf~4.8h |
  420.7k/d · L12·gear ⚠<floor |
```

Band lane went **20 rated → 91 rated**. The item was gated-in the whole time (177 gated either way); it
just never won a fetch slot.

## 3. Two distinct mechanisms

### Class A — passes admission, never fetched (Helm of neitiznot, 6.2k/d)

1. **Fetch cap.** `--top 40` fetches ~41 of 177 admitted items per niche.
2. **Sub-floor demotion in the pre-fetch orderer.** `MIN_GPD` (500k gp/day attention floor,
   `screen-flip-niches.mjs:249`) is used by the cheap pre-fetch orderer as a demotion — see the header
   comment at `screen-flip-niches.mjs:76` ("cheap pre-fetch orderer + the 500k --min-gpd pre-filter (P6b
   demotion)"). Helm of neitiznot is at 420.7k/d, under the floor, so it is demoted below the cut and
   never fetched. The `⚠<floor` marker on the row is documented as "surfaced, not gated" — but that is
   only true *after* a fetch it cannot win.

**Why mid-tier is structurally sub-floor.** Expected gp/day is bounded by `buy limit × net per unit`:

| Class | Buy limit | Net/u | Path-A gp/d |
| --- | --- | --- | --- |
| Big gear (Magus ring) | 8/4h | +128.1k | 4.82m/d |
| Churn (Burnt page) | large | +92 | 4.21m/d |
| **Mid gear (Helm of neitiznot)** | **70/4h = 420/day** | **+1,648** | **420.7k/d** |

420 units/day × 1,648 ≈ 692k gross, ~421k after Path-A's capture fraction. Modest limit × modest margin
lands just under a 500k line. This is a property of the whole class, not of one item.

### Class B — fails both liquidity paths (Berserker helm 780/d, Dragon scimitar 1.7k/d)

Admission is `limitVol ≥ FLOOR (3,500/d)` **OR** `limitVol × mid ≥ GP_FLOOR (4.5b)`
(`screen-flip-niches.mjs:171,233`). The two paths cross at:

```
3,500 = 4.5e9 / mid   →   mid ≈ 1,285,714
```

Above ~1.29m mid the gp-flow path gets progressively easier as price rises (Ancestral hat: 189/d × 53m =
~10b ✓). Below it, the flat 3,500/d requirement binds, and cheap churn clears it trivially. Mid-tier gear
is the one class that is **too cheap for the gp-flow path and too slow for the volume path**.

`FLOOR` was recalibrated **50 → 3,500** in PLAN-VOL24 step 2 (count-matched against the corrected
rolling-24h volume distribution). Worth confirming that recalibration did not overshoot for this band —
780/d genuinely may be too thin to want, but that should be a decision, not a side effect.

## 4. The deeper question — `MIN_GPD` measures the wrong thing

`MIN_GPD` is an **absolute** gp/day threshold, so it systematically favours items that soak up capital.

Helm of neitiznot's 420.7k/day uses ~420 × 47,352 ≈ **19.9m of capital → ~2.1%/day on deployed capital**.
Several big-gear rows that outrank it return a larger absolute number on a much larger capital base, at
worse efficiency.

The screen already knows this: the DECISION DIGEST added a `capEff` column ("realizable ROI%/day,
buy-limit-bounded") precisely because raw gp/day misleads, and the digest re-ranks on
`capEff × deployable capital`. **But the fetch ordering still uses absolute gp/day** — so the
capital-efficient middle is filtered out before `capEff` ever gets to see it.

## 5. Relationship to the existing open entry

PLAN.md "Open" already carries **"Thin-reserve should scale with `--capital`"** (2026-07-23) — at high
capital a fixed 6-slot `THIN_RESERVE` starves *thin big-tickets* (Sanguinesti staff, Basilisk jaw,
Webweaver bow), interim workaround `--top 90`.

That is a **sibling, not a duplicate**. Same subsystem (`pipeline/lib/admission.mjs` `pickFetchPool` /
the admission ordering), same symptom shape (needs a manual `--top` bump), but a different starved
population and a different cause:

| | Existing entry | This document |
| --- | --- | --- |
| Starved class | thin **big-tickets** | **mid-price** gear |
| Cause | fixed `THIN_RESERVE` doesn't scale with capital | `MIN_GPD` demotion + absolute-gp/d fetch ordering |
| Binding gate | reserve slot count | attention floor + (for Class B) the 3,500/d liquidity floor |

Whatever chunk touches `pickFetchPool` should probably resolve both together.

## 6. Open questions (for the orchestrator)

1. Should the pre-fetch orderer rank on **capital efficiency** rather than absolute gp/day? If so, does
   `MIN_GPD` remain as an absolute floor, become capital-relative, or move strictly post-fetch?
2. Is a **guaranteed mid-tier fetch reserve** the cheaper fix (mirroring `THIN_RESERVE`) — i.e. reserve
   N slots for items in a mid mid-price band — rather than re-ranking?
3. Did the `FLOOR` 50 → 3,500 recalibration overshoot for the mid band (Class B)? Does the alternative
   gp-flow path need a mid-tier-aware third path, or is 780/d correctly excluded?
4. Is the mid tier actually *worth* trading at Ben's bankroll? 420k/day on 19.9m is good efficiency but
   modest absolute return, and it consumes a GE slot that a big-ticket could use. The right answer may be
   "surface it, don't prioritise it" — which is an ordering change, not a floor change.

## 7. Non-goals

- **Not** a request to lower `MIN_GPD`. The floor exists to stop dust-tier noise and that job is real.
- **Not** a live tuning change off one scan (rule 4).
- **Not** a claim that mid-tier items are profitable in practice — no mid-tier flip has ever been logged,
  precisely because none has ever been surfaced. n = 0.

## 8. Interim workaround

`--top 150` (or `--min-gpd 300000`) on a scan where the mid band is wanted. Costs extra fetches; fine for
an occasional deliberate look, not for the default loop.
