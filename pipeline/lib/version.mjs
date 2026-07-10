// PIPELINE_VERSION — the ONE formal version stamp for the pipeline half of The Coffer.
//
// Displayed in the app beside APP_VERSION (js/state.js) so app↔pipeline drift is visible at a
// glance: the app fetches a published artifact (screen.json / positions.json) that carries this
// stamp and renders "app vX · pipeline vY (scan HH:MM)". Because a static GitHub-Pages page can't
// run the pipeline, the app shows the version of the LAST PUBLISHED artifact, not a live import.
//
// Bump discipline (mirrors APP_VERSION, independent track): bump on a meaningful change to what the
// pipeline COMPUTES or PUBLISHES (a gate/rank/validator change, a screen.json/positions.json schema
// change, a verdict-vocabulary change). Pure stdout formatting tweaks may ship without a bump
// (CLAUDE.md process rule 5). Launched at 1.0.0 alongside the app's 1.0.0 parity milestone — the
// first formally-versioned, app-coupled pipeline.
export const PIPELINE_VERSION = '1.0.0';
