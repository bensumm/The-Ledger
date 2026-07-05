/* GitHub-as-backend writes (M1 — mobile parity). The Coffer is a static page with no server.
   On desktop, manual fills append to coffer-manual.log via the File System Access API (fillslog.js).
   On a PHONE that API doesn't exist, so this module lets the app append source log lines straight
   to the repo through the GitHub contents API, using a fine-grained Personal Access Token.

   SECURITY — the PAT is a device-local secret:
   - stored ONLY in localStorage under GH_PAT_KEY (never IndexedDB, never window.storage);
   - never rendered back after entry (the input is cleared on save; the field shows a saved state,
     not the value);
   - never exported (backup.js's buildBackup() lists explicit fields — the PAT is not among them);
   - never logged (callers log the action "PAT updated" only — never the value).
   Documented tradeoff: it's a token on your own device. Scope it fine-grained — Contents:
   Read and write on THIS repo only — and it's revocable any time at github.com. The phone writes
   ONLY source log lines (mobile-fills.log) and watchlist.json; it never touches fills.json /
   positions.json (single-writer: only sync-fills.mjs writes those). */

const GH_PAT_KEY = 'cofferGhPat';
export const MOBILE_LOG_PATH = 'mobile-fills.log';
export const WATCHLIST_PATH = 'watchlist.json';

function lstore(){ try{ return window.localStorage; }catch{ return null; } }
export function hasPat(){ const s=lstore(); return !!(s && s.getItem(GH_PAT_KEY)); }
// Returns false only when there's no storage at all (Private Browsing). A trimmed empty value clears.
export function savePat(v){ const s=lstore(); if(!s) return false;
  const t=(v||'').trim(); if(t) s.setItem(GH_PAT_KEY, t); else s.removeItem(GH_PAT_KEY); return true; }
function pat(){ const s=lstore(); return s ? s.getItem(GH_PAT_KEY) : null; }

// owner/repo derived from the Pages origin (e.g. <owner>.github.io/<repo>/) so no account name is
// hardcoded in a tracked file. localStorage overrides (cofferGhOwner/Repo/Branch) cover custom
// hosts and local testing.
export function ghTarget(){
  const s=lstore();
  const host=(typeof location!=='undefined' && location.hostname)||'';
  const seg=(typeof location!=='undefined' && location.pathname.split('/').filter(Boolean)[0])||null;
  return {
    owner: (s&&s.getItem('cofferGhOwner')) || (host.endsWith('.github.io') ? host.slice(0, -('.github.io'.length)) : null),
    repo:  (s&&s.getItem('cofferGhRepo'))  || seg,
    branch:(s&&s.getItem('cofferGhBranch'))|| 'main'
  };
}
export function ghConfigured(){ const t=ghTarget(); return hasPat() && !!t.owner && !!t.repo; }

const b64enc = str => btoa(unescape(encodeURIComponent(str)));
const b64dec = b64 => decodeURIComponent(escape(atob(String(b64||'').replace(/\s/g,''))));
const apiUrl = (t,path) => 'https://api.github.com/repos/'+t.owner+'/'+t.repo+'/contents/'+path;
const authHeaders = () => ({ Authorization:'Bearer '+pat(), Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28' });
async function safeMsg(r){ try{ return (await r.json()).message||''; }catch{ return ''; } }

async function getFile(t, path){
  const r=await fetch(apiUrl(t,path)+'?ref='+encodeURIComponent(t.branch), { headers:authHeaders(), cache:'no-store' });
  if(r.status===404) return { sha:null, text:'' };            // file absent yet — first write creates it
  if(!r.ok){ const m=await safeMsg(r); throw new Error('read '+r.status+(m?' — '+m:'')); }
  const j=await r.json();
  return { sha:j.sha, text:b64dec(j.content) };
}
function putFile(t, path, text, sha, message){
  const body={ message, content:b64enc(text), branch:t.branch };
  if(sha) body.sha=sha;                                        // omitted -> create; present -> update
  return fetch(apiUrl(t,path), { method:'PUT', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body:JSON.stringify(body) });
}

// Append lines to mobile-fills.log. GET sha -> PUT the appended content; on a 409/422 sha race
// (another writer moved the file between GET and PUT) re-GET and retry. Returns {ok, reason}.
export async function appendMobileLines(lines, message){
  if(!hasPat()) return { ok:false, reason:'no GitHub token saved' };
  const t=ghTarget();
  if(!t.owner || !t.repo) return { ok:false, reason:'couldn’t read the GitHub repo from this page’s URL' };
  for(let attempt=0; attempt<3; attempt++){
    let cur; try{ cur=await getFile(t, MOBILE_LOG_PATH); }catch(e){ return { ok:false, reason:(e&&e.message)||String(e) }; }
    const sep=(cur.text && !cur.text.endsWith('\n')) ? '\n' : '';
    const next=cur.text + sep + lines.join('\n') + '\n';
    const r=await putFile(t, MOBILE_LOG_PATH, next, cur.sha, message);
    if(r.ok) return { ok:true };
    if(r.status===409 || r.status===422) continue;             // sha conflict — re-GET + retry
    const m=await safeMsg(r); return { ok:false, reason:'write '+r.status+(m?' — '+m:'') };
  }
  return { ok:false, reason:'write kept conflicting (409) — try again in a moment' };
}

// Replace a whole JSON file (watchlist.json write-back). Skips a no-op commit when content matches.
export async function putJsonFile(path, obj, message){
  if(!hasPat()) return { ok:false, reason:'no GitHub token saved' };
  const t=ghTarget();
  if(!t.owner || !t.repo) return { ok:false, reason:'couldn’t read the GitHub repo from this page’s URL' };
  const text=JSON.stringify(obj);
  for(let attempt=0; attempt<3; attempt++){
    let cur; try{ cur=await getFile(t, path); }catch(e){ return { ok:false, reason:(e&&e.message)||String(e) }; }
    if(cur.text.trim()===text.trim()) return { ok:true, noop:true };
    const r=await putFile(t, path, text, cur.sha, message);
    if(r.ok) return { ok:true };
    if(r.status===409 || r.status===422) continue;
    const m=await safeMsg(r); return { ok:false, reason:'write '+r.status+(m?' — '+m:'') };
  }
  return { ok:false, reason:'write kept conflicting (409) — try again' };
}
