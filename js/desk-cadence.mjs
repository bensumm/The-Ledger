/* desk-cadence.mjs — THE ONE HOME for "how many buy-limit windows a day do we actually assume?"
 *
 * WHY THIS FILE EXISTS. The answer used to live in three places that all claimed to agree and
 * silently stopped agreeing: `ACTIONABLE_WINDOWS_PER_DAY` (pipeline/lib/signal/gatecandidates.mjs),
 * `VALUE_WINDOWS_PER_DAY` (js/valuescreen.mjs) and `AMP_WINDOWS_PER_DAY` (js/amplitudescreen.mjs).
 * When the 6→2 haircut landed (2026-08-08) only the first moved; the other two stayed at 6 while
 * their comments still read "mirrors expUnits". Two lanes were sizing off a 3× fantasy and nothing
 * in the tree said so. It could not be fixed by importing the constant from `gatecandidates`,
 * because `gatecandidates` imports FROM both screens — that direction is a cycle. Hence a leaf.
 *
 * PHYSICAL vs ACTIONABLE (Ben's ruling, 2026-08-08; re-affirmed and extended 2026-08-09).
 * GE buy limits reset every 4h, so 24/4 = 6 refills/day. That arithmetic is right; what was wrong
 * was USING it as an expected value. Collecting all 6 means re-buying every four hours around the
 * clock, including asleep — and on many items six distinct dip opportunities do not exist in a day
 * at all. The bias is ONE-DIRECTIONAL: a cheap liquid item is refill-bound and collects the full
 * multiplier, while a big ticket is volume-bound (the 0.10×volDay leg) long before the refill cap
 * binds, so it never sees it. Everything ranked on gpDay therefore compared a 6-cycle fantasy
 * against a 1-cycle reality.
 *
 * THE NUMBER IS 2 (Ben, 2026-08-09): "assume 2 windows of attention — enough for 1 band/amp flip
 * or 2 churn flips". Note what that sentence actually says: the DAY's budget is two windows, and
 * different lanes spend it at different rates — a band or amplitude round-trip consumes both, a
 * churn round-trip consumes one. THIS CONSTANT ONLY ENCODES THE FIRST HALF. It is a bound on
 * TRANCHES ACQUIRED PER DAY (what `expUnits` needs), not a per-lane cost model of completed flips.
 * The differential cost — gp per DECISION rather than gp per hour — is the still-unbuilt "attention
 * axis"; see PLAN.md's Discovered entry. Do not read this constant as if it already modelled that.
 *
 * PLACEHOLDER (rule 4), n≈0, Ben-set — tune freely. To revert the experiment wholesale, set
 * ACTIONABLE_WINDOWS_PER_DAY back to REFILL_WINDOWS_PER_DAY.
 *
 * ⚠ CHANGING `ACTIONABLE_WINDOWS_PER_DAY` MOVES THE ATTENTION FLOOR'S REFERENCE DISTRIBUTION.
 * `MIN_GPD` (gatecandidates.mjs) was calibrated against a 6-window gpDay distribution and dropped
 * 500k → 250k when this went to 2. That was a rescale, not a re-derivation, and the haircut is up
 * to 3× while the floor moved only 2× — so the floor is currently ~1.5× TIGHTER in effective terms
 * than it was pre-haircut. If you move this number again, re-derive the floor; don't just scale it.
 */

export const REFILL_WINDOWS_PER_DAY = 6;      // physical: 24h ÷ 4h limit reset. Do not change — it is a game rule.
export const ACTIONABLE_WINDOWS_PER_DAY = 2;  // realistic desk cadence. PLACEHOLDER (n≈0), Ben-set, tune freely.
