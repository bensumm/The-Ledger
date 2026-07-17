/* compose.mjs — the pipeline COMPOSITION resolver (PC1, PLAN-PIPELINE-COMPOSITION).
   ONE thin precedence layer that decides which named piece (estimator/probe/gate variant, mode,
   volume source, …) a script runs — replacing the N bespoke `A.<flag> != null ? … : <default>`
   branches scattered across screen-flip-niches.mjs / quote-items.mjs / watch-positions.mjs. No
   market/quote math lives here (that is js/quotecore.js); no fetch, no clock. Consumers pass the
   already-parsed flag value + the (optional) config value + the hardcoded fallback; the resolver
   only picks the winner and wraps it in the ACTIVE-PLUS-SHADOW shape.

   PRECEDENCE (the whole rule): CLI flag  >  pipeline/pipeline-config.json  >  hardcoded fallback.
   A value counts as "provided" when it is neither undefined nor null — so a caller that hasn't set
   a flag passes `undefined` and the config (then the fallback) wins. This reproduces every current
   default byte-identically when no config file is present (the PC1 byte-identity gate — pinned by the
   existing goldens/tests): flag ?? fallback, exactly as the inline ternaries did before.

   RETURN SHAPE — `{ active, shadow: [] }`, ACTIVE-PLUS-SHADOW, never exclusive-or (Ben's refinement,
   codifying what the --pressure-exit precedent already does):
     - `active`  — the single selection that feeds the DISPLAYED / PUBLISHED number.
     - `shadow`  — names of variants that should still RUN each pass and log to suggestions.jsonl
                   (the existing asym/estConfLean/pressure shadow-field convention) WITHOUT touching
                   the display. For PC1 nothing populates `shadow` yet (it is always `[]`); the shape
                   exists from day one so PC3's sell-model registry can add members WITHOUT changing
                   this resolver's contract. Callers loop the shadow names through the same registry
                   call they make for `active` — there is no orchestration layer here.

   pipeline-config.json is OPTIONAL and absent by default. Its absence MUST leave every current
   default standing (see PRECEDENCE above). It is read lazily + cached on first `loadPipelineConfig()`
   so importing this module is side-effect-free (check-imports.mjs dynamic-imports it to read exports;
   it must not touch the filesystem on import). A minimal shape:
     { "sellModel": "reach-fold", "volSource": "rolling", "modes": ["band","churn","value"] }

   Consumers: screen-flip-niches.mjs (mode / vol-source / asym / phase-rescue / pressure-exit),
   quote-items.mjs + watch-positions.mjs (pressure-exit). */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'pipeline-config.json');

let _configCache;   // undefined = not yet read; an object once loaded (absent file → {})
/* loadPipelineConfig(): the optional pipeline/pipeline-config.json, read once and cached. Absent /
   unreadable / malformed ⇒ {} (every default stands). Never throws — a broken config file must not
   break a market read; it just falls through to the hardcoded fallbacks. */
export function loadPipelineConfig() {
  if (_configCache !== undefined) return _configCache;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    _configCache = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { _configCache = {}; }
  return _configCache;
}

/* resetPipelineConfigCache(): @test-only: exists so a suite can point the resolver at a fresh
   config file (or clear it) between cases. Not used by any command path. */
export function resetPipelineConfigCache() { _configCache = undefined; }

const provided = v => v !== undefined && v !== null;

/* resolve(category, { flag, config, fallback }) → { active, shadow: [] }.
   `category` is a label for the thing being selected (e.g. 'mode', 'volSource', 'pressureExit') —
   carried for readability + future logging, it does not change the precedence. `flag` is the value
   the CLI supplied (undefined when the user did not set it — the caller does the same extraction it
   did inline before), `config` the pipeline-config.json value (undefined when absent), `fallback`
   the hardcoded default. Winner: flag > config > fallback. */
export function resolve(category, { flag, config, fallback } = {}) {
  const active = provided(flag) ? flag : provided(config) ? config : fallback;
  return { active, shadow: [] };
}

/* refusePublishIfNonNeutral({ publish, publishExplicit, checks }) → the (possibly downgraded) publish
   flag. The ONE shared guard that used to be hand-copied per non-neutral estimator flag in
   screen-flip-niches.mjs (--asym, --pressure-exit): an UN-CALIBRATED / F1-ungraduated estimator must
   never reach screen.json / the deployed app. `checks` is an ORDERED list of { on, message }: when a
   check is `on` and publishing is still live, an EXPLICIT `--publish` is a hard user error (print the
   check's message to stderr + exit 1), while default-on publish is quietly downgraded to off (so an
   exploration run needs no --no-publish). Order matters only for which message an explicit-publish
   conflict prints first — pass the checks in the same order the inline copies ran (asym, then
   pressure). Behaviour-identical to the two removed inline blocks. */
export function refusePublishIfNonNeutral({ publish, publishExplicit, checks = [] } = {}) {
  for (const c of checks) {
    if (publish && c.on) {
      if (publishExplicit) { console.error(c.message); process.exit(1); }
      publish = false;
    }
  }
  return publish;
}
