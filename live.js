/* Closed Loop live reader. Public nightly artifacts and PRs are read from the canonical repo.
 * Private logs are read ONLY in the current browser session when the visitor supplies a
 * fine-grained read-only GitHub token; the credential is never stored or exported.
 * Research notes remain editable in the original local-first research store.
 */
'use strict';
const CL_SOURCE = 'zachfeemster-create/Closed-loop';
const CL_PRIVATE = 'zachfeemster-create/closed-loop-log';
const CL_API = 'https://api.github.com/repos/';
const live = { fetching:false, lastChecked:null, nightlyFiles:0, nightlyLoaded:0,
  prsLoaded:0, errors:[], privateToken:'', privateBusy:false, privateChecked:null,
  privateRuns:[], authenticatedRuns:[], syncedRuns:[], mirrorChecked:null, mirrorError:'', privateTotal:0, privateFailures:0, selectedPrivate:'',
  autoRefresh:true, selectedDaily:'', dailyFilter:'all', dailySearch:'', privateFilter:'', history:[] };
const liveURL = (repo,path)=>`https://github.com/${repo}/blob/main/${path}`;
function asText(v){return v===undefined||v===null?'':String(v)}
function liveTime(d){return d?new Date(d).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}):'Not yet checked'}
function dateFromUTC(x){return /^\d{4}-\d{2}-\d{2}/.test(x||'')?x.slice(0,10):''}
function liveToast(s){if(typeof toast==='function')toast(s)}
function liveStatusMsg(){
 if(live.fetching)return 'Refreshing public GitHub sources…';
 if(live.errors.length)return `Checked with ${live.errors.length} warning(s) · ${live.nightlyLoaded} archived nightlies loaded`;
 if(!live.lastChecked)return 'Public live sync has not completed yet';
 return `${live.nightlyLoaded} nightly archives · ${live.prsLoaded} PRs verified · ${liveTime(live.lastChecked)}`;
}
async function liveGet(url, token='', timeout=20000){
 const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const headers={'Accept':'application/vnd.github+json'};
  if(token)headers.Authorization=`Bearer ${token}`;
  const res=await fetch(url,{method:'GET',headers,cache:'no-store',signal:controller.signal});
  if(!res.ok){const extra=res.status===401?' (token rejected)':res.status===403?' (access denied or API rate limit)':res.status===404?' (not found or no access)':'';
   throw new Error(`GitHub HTTP ${res.status}${extra}`)}
  return res.json();
 }finally{clearTimeout(timer)}
}
async function livePool(rows,worker,concurrency=5,progress=()=>{}){
 let cursor=0,done=0,failures=0;const results=new Array(rows.length);
 await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},async()=>{
  while(cursor<rows.length){const i=cursor++;
   try{results[i]=await worker(rows[i],i)}catch(e){failures++;results[i]={_error:asText(e.message||e),_source:rows[i]}}
   progress(++done,rows.length,failures);
  }
 }));return {results,failures};
}
const survivorKey = s=>[s.name,s.lens,s.eq].map(asText).join(' | ');
function mapNightly(raw, meta){
 if(raw.kind!=='nightly'||!Array.isArray(raw.survivors)||!Array.isArray(raw.log)||!raw.ran_at)throw Error(`Invalid nightly structure for ${meta.name}`);
 const day=meta.name.slice(0,10), streaks=new Map();
 for(const h of raw.headlines||[]){const m=asText(h).match(/^Survivor: (.+?) \(.+\), held (\d+) night\(s\) running\.$/);if(m)streaks.set(m[1],Number(m[2]));}
 const survivorKeys=new Set(raw.survivors.map(survivorKey));
 const luckKeys=new Map((raw.luck_pile||[]).map(s=>[survivorKey(s),s.why||'luck pile']));
 const snapshot=raw.survivors.map(s=>{const key=survivorKey(s);return {key,label:s.name,classification:'sturdy survivor',streak:streaks.has(key)?String(streaks.get(key)):'',score:asText(s.percentile),confidence:s.standing||'',notes:`Lens: ${s.lens} · EQ: ${s.eq} · Dataset ${s.dataset} · percentile of fakes`,lens:s.lens,eq:s.eq,dataset:s.dataset,percentile:s.percentile,standing:s.standing}});
 // Dataset Dxx identifiers are shuffled each night; resolve to the actual series name.
 const rowRecords=raw.log.map(e=>{const name=raw.key?.[e.dataset]||e.dataset, key=survivorKey({name,lens:e.lens,eq:e.eq});
   return {key,name,lens:e.lens,eq:e.eq,dataset:e.dataset,classification:survivorKeys.has(key)?'survivor':luckKeys.has(key)?'luck pile':'not surviving',reason:luckKeys.get(key)||'',percentile:e.percentile,passed:e.passed,fake_arm_passed:e.fake_arm_passed,stat:e.stat,bar:e.bar,step:e.step};});
 return {id:`live-nightly-${day}`,date:day,label:`${day} · GitHub nightly`,branch:'main',sha:'',status:'captured',source:liveURL(CL_SOURCE,`autorun/results/nightly/${meta.name}`),summary:`${raw.survivors.length} survivors, ${(raw.luck_pile||[]).length} in luck pile, ${raw.log.length} lens checks. ${raw.feeds_skipped?.length||0} feed(s) skipped.`,baselineScore:'',submissionScore:'',notes:`GitHub source artifact blob SHA: ${meta.sha}. Nightly lens percentile is NOT a quantum-submission score.`,complete:true,snapshots:snapshot,
   sourceKind:'github-nightly',sourceBlobSha:meta.sha,ranAt:raw.ran_at,feedsOk:raw.feeds_ok||[],feedsSkipped:raw.feeds_skipped||[],settings:raw.settings||{},candidateRows:rowRecords,luckCount:(raw.luck_pile||[]).length,maxNotes:(raw.max_notes||[]).slice(-80),headlines:(raw.headlines||[]).slice(0,100)};
}
function mergeNightlies(parsed){
 const oldById=new Map(db.runs.map(r=>[r.id,r]));
 for(const r of parsed){const old=oldById.get(r.id);if(old){r.notes=old.localNotes?old.localNotes+'\n'+r.notes:r.notes;}oldById.set(r.id,r)}
 // An initial, unsourced placeholder is removed only if the user has not entered data into it.
 const dummy=oldById.get('run-nov2');if(dummy&&!dummy.snapshots?.length&&dummy.status==='metadata only')oldById.delete('run-nov2');
 db.runs=[...oldById.values()];
 if(parsed.some(x=>x.date==='2026-11-02')){
  const item=db.actions.find(a=>a.id==='act-nightly');if(item){item.status='done';item.notes='GitHub nightly archives imported with full survivor manifests. Continue checking changes after subsequent runs.';}
 }
 for(const r of parsed){const id='ev-live-'+r.date;
   let ev=db.evidence.find(x=>x.id===id);
   const entry={id,date:r.date,kind:'GitHub nightly',title:`Nightly archive ${r.date} · ${r.snapshots.length} survivors`,summary:`${r.summary} Source artifact SHA ${r.sourceBlobSha}; seed ${r.settings.seed??'unknown'}, ${r.settings.n_fakes??'unknown'} matched fakes.`,source:`${CL_SOURCE}/autorun/results/nightly`,url:r.source,hash:r.sourceBlobSha,link:r.id,confidence:'Source archive — verified source location'};
   if(ev)Object.assign(ev,entry);else db.evidence.push(entry);
 }
 // Ground the Nov 2 old reported event with the newly retrieved archive, don't duplicate its claims.
 const nov2=db.evidence.find(x=>x.id==='ev-nightly');if(nov2&&parsed.some(r=>r.date==='2026-11-02')){
  nov2.source='GitHub public nightly archive';nov2.url=liveURL(CL_SOURCE,'autorun/results/nightly/2026-11-02.json');nov2.confidence='Verified via GitHub archive';nov2.summary='Survivor and luck-pile changes documented in archived nightly. See actual Nov 1 versus Nov 2 diff; source records are retained separately from quantum submission scores.';
 }
 db.project.repo=`https://github.com/${CL_SOURCE}`;
 db.project.updated=parsed.map(r=>r.date).sort().slice(-1)[0]||db.project.updated;
 save();
 const dates=db.runs.filter(r=>r.sourceKind==='github-nightly').sort((a,b)=>a.date.localeCompare(b.date));
 if(dates.length){if(!record('runs',detailRun)||detailRun==='run-nov2')detailRun=dates[dates.length-1].id;
  if(dates.length>=2&&!compare.left&&!compare.right){compare.left=dates[dates.length-2].id;compare.right=dates[dates.length-1].id;}}
}
async function refreshLive(silent=false){
 if(live.fetching)return;
 live.fetching=true;live.errors=[];render();
 try{
  const listing=await liveGet(`${CL_API}${CL_SOURCE}/contents/autorun/results/nightly?ref=main`);
  if(!Array.isArray(listing))throw Error('GitHub did not return the nightly archive directory');
  const files=listing.filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x.name)).sort((a,b)=>a.name.localeCompare(b.name));
  live.nightlyFiles=files.length;
  const cachedFiles=new Map(db.runs.filter(r=>r.sourceKind==='github-nightly').map(r=>[r.date+'.json',r]));
  const {results,failures}=await livePool(files,x=>{const cached=cachedFiles.get(x.name);if(cached&&cached.sourceBlobSha===x.sha&&Array.isArray(cached.candidateRows))return {_cached:true,run:cached};return liveGet(x.download_url)},5);
  const valid=[];
  results.forEach((raw,i)=>{if(raw?._error){live.errors.push(`${files[i].name}: ${raw._error}`);return}
   try{valid.push(raw?._cached?raw.run:mapNightly(raw,files[i]))}catch(e){live.errors.push(`${files[i].name}: ${e.message}`)}});
  if(failures)live.errors.push(`${failures} nightly fetch(es) failed`);
  // Never replace previous snapshots with a partial failed refresh.
  if(valid.length){mergeNightlies(valid);live.nightlyLoaded=db.runs.filter(r=>r.sourceKind==='github-nightly').length}
 }catch(e){live.errors.push(`Nightly directory: ${e.message}`)}
 const prIds=[15,16,17];const fetched=await Promise.allSettled(prIds.map(n=>liveGet(`${CL_API}${CL_SOURCE}/pulls/${n}`)));
 let ok=0;
 fetched.forEach((entry,i)=>{const n=prIds[i];if(entry.status!=='fulfilled'){live.errors.push(`PR #${n}: ${asText(entry.reason?.message||entry.reason)}`);return}
   const p=entry.value;const rec=db.prs.find(x=>String(x.number)===String(n));if(!rec)return;
   rec.title=p.title||rec.title;rec.status=p.merged_at?'merged':p.draft?'draft':p.state||'unverified';rec.url=p.html_url||liveURL(CL_SOURCE,`pull/${n}`);
   rec.branch=p.head?.ref||rec.branch;rec.updated=p.updated_at?.slice(0,10)||rec.updated;
   rec.summary=asText(p.body||rec.summary).slice(0,2500);
   rec.githubCheckInfo=`${p.changed_files??'?'} file(s) changed; ${p.commits??'?'} commit(s); ${p.additions??'?'} added, ${p.deletions??'?'} removed.`;
   ok++;
 });live.prsLoaded=ok;
 if(ok===3){const a=db.actions.find(x=>x.id==='act-repo');if(a){a.status='done';a.notes='Canonical repo and PR #15–17 URL/status verified live from GitHub. Continue regression checks.';}}
 save();live.lastChecked=new Date().toISOString();live.fetching=false;render();
 await refreshPublishedRuns();
 if(!silent)liveToast(live.errors.length?'Refreshed with warnings — check Live sources':'Refreshed nightly archives and GitHub PRs');
}
function dailyPairs(){const rows=db.runs.filter(r=>r.sourceKind==='github-nightly').sort((a,b)=>a.date.localeCompare(b.date));return rows.length>=2?[rows[rows.length-2],rows[rows.length-1]]:[null,rows[0]||null]}
function getDailyChanges(a,b){
 if(!a||!b)return {counts:{added:0,dropped:0,streak:0,promoted:0,demoted:0,classified:0},rows:[]};
 const prevSurv=new Map(a.snapshots.map(s=>[s.key,s])),nextSurv=new Map(b.snapshots.map(s=>[s.key,s]));
 const p=new Map((a.candidateRows||[]).map(s=>[s.key,s]));const n=new Map((b.candidateRows||[]).map(s=>[s.key,s]));
 const keys=[...new Set([...p.keys(),...n.keys(),...prevSurv.keys(),...nextSurv.keys()])];
 const rows=keys.map(key=>{const old=p.get(key),now=n.get(key);const was=prevSurv.get(key),is=nextSurv.get(key);
  const changes=[];
  if(!was&&is)changes.push('NEW SURVIVOR');
  if(was&&!is)changes.push('DROPPED SURVIVOR');
  if(old&&now&&old.classification!==now.classification)changes.push(`${old.classification} → ${now.classification}`);
  if(was&&is&&hasVal(was.streak)&&hasVal(is.streak)&&Number(was.streak)!==Number(is.streak))changes.push(`streak ${was.streak} → ${is.streak}`);
  return {key,old,now,was,is,changes};}).filter(r=>r.changes.length);
 return {counts:{added:rows.filter(r=>r.changes.includes('NEW SURVIVOR')).length,dropped:rows.filter(r=>r.changes.includes('DROPPED SURVIVOR')).length,streak:rows.filter(r=>r.changes.some(v=>v.startsWith('streak'))).length,promoted:rows.filter(r=>r.changes.some(v=>v.endsWith('→ survivor'))).length,demoted:rows.filter(r=>r.changes.some(v=>v.startsWith('survivor →'))).length,classified:rows.filter(r=>r.changes.some(v=>v.includes('→'))).length},rows};
}
function liveEventCard(){const [a,b]=dailyPairs(),dif=getDailyChanges(a,b);return `<section class="card section-gap"><div class="card-head"><div><h2>Verified nightly changes ${a?esc(a.date)+' → ':''}${b?esc(b.date):'no archive loaded'}</h2><div class="card-sub">Source: GitHub autorun archives · Lens q1–q4 names are not research q1–q5 classifications</div></div>${pill(b?'Source-backed':'Not loaded',b?'green':'amber')}</div><div class="card-body"><div class="mini-cards">${[['Previous survivors',a?.snapshots?.length??'—'],['Latest survivors',b?.snapshots?.length??'—'],['Added',dif.counts.added],['Dropped',dif.counts.dropped],['Streak shifts',dif.counts.streak],['State switches',dif.counts.classified]].map(([k,v])=>`<div class="mini"><strong>${esc(v)}</strong><span>${esc(k)}</span></div>`).join('')}</div><div class="table-scroll"><table><thead><tr><th>Series / lens / EQ</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${dif.rows.slice(0,80).map(r=>`<tr><td class="wraptext" style="min-width:240px"><strong>${esc(r.key)}</strong></td><td>${pill(r.old?.classification||'not tested')}<span class="table-small">${hasVal(r.was?.streak)?'streak '+esc(r.was.streak):''}</span></td><td>${pill(r.now?.classification||'not tested')}<span class="table-small">${hasVal(r.is?.streak)?'streak '+esc(r.is.streak):''}</span></td><td class="wraptext">${r.changes.map(x=>esc(x)).join('; ')}</td></tr>`).join('')||'<tr><td colspan="4">No changed rows yet; refresh to load archive comparisons.</td></tr>'}</tbody></table></div></div></section>`}
function liveHeaderStatus(){return `<div class="live-toolbar"><span class="status-dot" style="background:${live.lastChecked&&!live.errors.length?'#36bc9a':'#d9a452'}"></span><span>${esc(liveStatusMsg())}</span></div>`}
function nightlyInspector(){
 const all=db.runs.filter(r=>r.sourceKind==='github-nightly').sort((a,b)=>b.date.localeCompare(a.date));
 const selected=all.find(r=>r.id===live.selectedDaily)||all[0];
 const checks=(selected?.candidateRows||[]).filter(r=>(live.dailyFilter==='all'||r.classification===live.dailyFilter)&&(!live.dailySearch||JSON.stringify(r).toLowerCase().includes(live.dailySearch.toLowerCase())));
 return `<section class="card card-pad section-gap"><div class="toolbar" style="margin-top:0"><div><h2>All nightly lens checks + Max notes</h2><p class="card-sub">Inspect the full run, not only the survivors. Each archived test row retains the matched-fake percentile, statistic, bar, EQ and lens.</p></div><a href="${safeLink(selected?.source||'')}" target="_blank" rel="noopener noreferrer" class="button">View source JSON ↗</a></div><div class="toolbar"><div class="filters"><select id="liveDailySelect" aria-label="Choose archived nightly">${all.map(r=>`<option value="${esc(r.id)}" ${r.id===selected?.id?'selected':''}>${esc(r.date)} · ${r.candidateRows?.length||0} checks</option>`).join('')}</select><select id="liveDailyClass" aria-label="Filter by classification">${['all','survivor','luck pile','not surviving'].map(k=>`<option value="${esc(k)}" ${live.dailyFilter===k?'selected':''}>${esc(k==='all'?'All classifications':k)}</option>`).join('')}</select><input id="liveDailySearch" class="input" placeholder="Search series, lens, EQ…" aria-label="Search daily checks" value="${esc(live.dailySearch)}"></div>${pill(`${checks.length} / ${selected?.candidateRows?.length||0} checks shown`,'blue')}</div><div class="table-scroll live-table"><table><thead><tr><th>Step</th><th>Series</th><th>Lens / EQ</th><th>Classification</th><th>Percentile</th><th>Statistic</th><th>Bar</th><th>Fake arm</th></tr></thead><tbody>${checks.map(r=>`<tr><td>${esc(r.step)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.lens)}<span class="table-small">${esc(r.eq)} · ${esc(r.dataset)}</span></td><td>${pill(r.classification,r.classification==='survivor'?'green':r.classification==='luck pile'?'amber':'dark')}</td><td class="score">${esc(r.percentile)}</td><td class="score">${esc(r.stat)}</td><td class="wraptext">${esc(JSON.stringify(r.bar))}</td><td>${pill(r.fake_arm_passed?'Passed (invalidates)':'No pass',r.fake_arm_passed?'red':'dark')}</td></tr>`).join('')||'<tr><td colspan="8">No rows for this filter or archived run</td></tr>'}</tbody></table></div><details style="margin-top:16px"><summary style="cursor:pointer;font-weight:700">Max notes (${selected?.maxNotes?.length||0}) and reproducibility settings</summary><div class="info-block" style="margin-top:10px"><strong>UTC:</strong> ${esc(selected?.ranAt||'')} · <strong>Source SHA:</strong> <span class="mono">${esc(selected?.sourceBlobSha||'')}</span><p>${esc((selected?.feedsSkipped||[]).join('; ')||'No skipped feeds recorded.')}</p><pre class="live-json">${esc(JSON.stringify(selected?.settings||{},null,2))}</pre></div><div class="table-scroll live-table"><table><thead><tr><th>Step</th><th>Max intervention</th><th>Recorded note</th><th>Survived?</th></tr></thead><tbody>${(selected?.maxNotes||[]).map(n=>`<tr><td>${esc(n.step)}</td><td>${esc(n.kind||'')}</td><td class="wraptext">${esc(n.note||n.line||'')}</td><td>${n.survived===undefined?'—':n.survived?'Yes':'No'}</td></tr>`).join('')||'<tr><td colspan="4">No Max notes available</td></tr>'}</tbody></table></div></details></section>`;
}
function liveSourcesView(){const [a,b]=dailyPairs(), dif=getDailyChanges(a,b);
 const privateConnected=!!live.privateToken;
 const filtering=live.privateRuns.filter(x=>!live.privateFilter||[x.id,x.kind,x.status,x.question].some(v=>asText(v).toLowerCase().includes(live.privateFilter.toLowerCase())));
 const chosen=live.privateRuns.find(x=>x.id===live.selectedPrivate)||filtering[0];
 return head('Live sources','Refresh the actual Closed Loop nightly archives and PRs. Connect the private run log to pull interactive tests.',btn('Refresh all','live-refresh','activity','primary'))+
 `<section class="card card-pad"><div class="toolbar" style="margin:0"><div><h2>Public Closed Loop repository</h2><div class="card-sub"><a href="https://github.com/${CL_SOURCE}" target="_blank" rel="noopener noreferrer">${CL_SOURCE}</a> · archived nightlies · PR #15–17</div></div>${liveHeaderStatus()}</div><p class="description" style="margin:13px 0 0">${esc(live.errors.length?live.errors.join(' · '):'GitHub is the source of truth. Refresh reads newly committed archives, including runs started manually through GitHub Actions.')}</p><div class="toolbar" style="margin-bottom:0">${btn('Refresh GitHub now','live-refresh','activity','button')}${pill(`${live.nightlyLoaded} / ${live.nightlyFiles} nightly archives`,'blue')}${pill(`${live.prsLoaded} PRs`,'green')}<a href="https://github.com/${CL_SOURCE}/actions/workflows/closed-loop-nightly.yml" target="_blank" rel="noopener noreferrer" class="button">Open nightly Actions ↗</a></div></section>`+
 `<section class="card card-pad section-gap"><div class="toolbar" style="margin:0"><div><h2>Interactive run history</h2><p class="card-sub">${CL_PRIVATE} · logged runs from Streamlit Lens rotation, Run a Test, fingerprint and game pages</p></div>${pill(privateConnected?'Private originals connected':live.syncedRuns.length?'Public summaries synced':'Awaiting run sync',privateConnected||live.syncedRuns.length?'green':'amber')}</div><p class="description" style="margin-top:15px">The dashboard can automatically show <strong>redacted public run summaries</strong> from its own scheduled GitHub Actions sync. For full original run documents and immediate refresh, use a <strong>fine-grained, read-only GitHub token scoped only to closed-loop-log</strong>. The token stays in this page's memory, never in localStorage, exports, or the source files. Close/reload the page to clear it.</p><form id="liveAuthForm" class="live-auth-form"><label for="liveAuthToken">Private repository read token</label><input autocomplete="off" spellcheck="false" name="token" id="liveAuthToken" type="password" placeholder="Fine-grained token, contents: read" aria-label="Read-only GitHub token"><button type="submit" class="button primary">Connect & sync log</button><button type="button" class="button" data-action="live-disconnect">Disconnect</button></form><div class="toolbar"><span class="tagline">${esc(live.privateBusy?'Fetching private run records…':live.privateChecked?'Private read: '+liveTime(live.privateChecked):live.mirrorChecked?'Published index: '+liveTime(live.mirrorChecked):'Run index has not synced yet')}</span><span class="tagline">${live.privateRuns.length} visible · ${live.syncedRuns.length} published digests · ${live.privateFailures} private fetch errors</span>${btn('Refresh private log','live-refresh-private','activity','button',privateConnected?'':'disabled')}</div>${privateConnected&&live.privateFailures?`<div class="info-block">Some records did not load; the private log view is incomplete. Refresh again to retry.</div>`:''}<div class="toolbar"><h2>Interactive runs</h2><input id="livePrivateFilter" class="input" placeholder="Filter ID / result / type…" value="${esc(live.privateFilter)}" aria-label="Filter private runs"></div><div class="grid col-7-5"><div class="table-scroll"><table><thead><tr><th>Logged at</th><th>Run</th><th>Type</th><th>Result</th><th></th></tr></thead><tbody>${filtering.slice(0,500).map(r=>`<tr><td>${esc(r.logged_at.slice(0,16).replace('T',' '))}</td><td><strong>${esc(r.id)}</strong><span class="table-small">${esc(short(r.question,90))}</span></td><td>${esc(r.kind)}</td><td>${pill(r.status,r.status==='pass'?'green':r.status==='fail'?'red':'dark')}</td><td><button class="mini-action" data-action="live-private-select" data-id="${esc(r.id)}">Inspect</button></td></tr>`).join('')||'<tr><td colspan="5">No interactive runs loaded yet. The public digest appears after the first GitHub Actions sync; authenticated private originals are also supported.</td></tr>'}</tbody></table></div><section class="surface-note">${chosen?`<div class="caps muted">${esc(chosen.kind)} / ${esc(chosen.id)}</div><h3>${esc(chosen.question||'Run record')}</h3><div class="row-meta">${pill(chosen.status)}<span class="tagline">${esc(chosen.logged_at)}</span></div><p style="margin-top:12px">${esc(chosen.summary||'Full raw record available on GitHub.')}</p><div class="header-actions" style="margin-top:15px"><a target="_blank" rel="noopener noreferrer" href="${safeLink(chosen.url)}" class="button small">Open raw run on GitHub ↗</a><button data-action="live-copy-private" data-id="${esc(chosen.id)}" class="button small">Copy summary</button><button data-action="live-save-evidence" data-id="${esc(chosen.id)}" class="button small">Save evidence note</button><button data-action="live-download-private" data-id="${esc(chosen.id)}" class="button small">Download JSON</button></div><details style="margin-top:14px"><summary style="cursor:pointer;font-weight:700">${chosen.publicMirror?'Published redacted statistics':'Full original run record'}</summary><pre class="live-json">${esc(JSON.stringify(chosen.raw,null,2))}</pre></details>`:'<h3>Select a run</h3><p>Test results and source links appear here after private access is granted.</p>'}</section></div></section>`+
 `<section class="card card-pad section-gap"><h2>Nightly source coverage</h2><p class="card-sub">Only full nightly archives count as complete survivor manifests. A nightly archive is not a quantum score.</p><div class="table-scroll"><table><thead><tr><th>Date / UTC</th><th>Survivors</th><th>Luck pile</th><th>Lens checks</th><th>Skipped feeds</th><th>Artifact</th></tr></thead><tbody>${db.runs.filter(x=>x.sourceKind==='github-nightly').sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr><td><strong>${esc(r.date)}</strong><span class="table-small">${esc(r.ranAt||'')}</span></td><td>${r.snapshots.length}</td><td>${esc(r.luckCount)}</td><td>${r.candidateRows?.length||0}</td><td>${r.feedsSkipped?.length||0}</td><td><a href="${safeLink(r.source)}" target="_blank" rel="noopener noreferrer">Source JSON ↗</a></td></tr>`).join('')||'<tr><td colspan="6">No archives loaded</td></tr>'}</tbody></table></div></section>`+liveEventCard()+nightlyInspector()+footer();
}
function privateSummary(raw,path){
 const kind=path.split('/')[0].replace('_runs','');
 const id=raw.run_id||path.split('/').pop().replace('.json','');
 const logged_at=raw.logged_at||raw.ran_at||'';
 const r=raw.result||{};
 let status='recorded';let verdict=r.verdict||raw.verdict||'';
 if(typeof r.passed==='boolean')status=r.passed?'pass':'fail';else if(typeof raw.passed==='boolean')status=raw.passed?'pass':'fail';else if(/FAIL/i.test(verdict))status='fail';else if(/PASS/i.test(verdict))status='pass';
 const question=raw.question||r.question||raw.test||raw.plan?.test_label||raw.keystone||raw.plan?.intake?.keystone||kind+' run';
 const summary=verdict||r.question||raw.notes?.join?.(' ')||`Logged ${id}; ${r.rows?.length||raw.rows?.length||raw.log?.length||0} test rows recorded.`;
 return {id,kind,status,question,summary,logged_at:asText(logged_at),url:liveURL(CL_PRIVATE,path),sourcePath:path,raw};
}
function combineVisibleRuns(){
 const byPath=new Map(live.syncedRuns.map(r=>[r.sourcePath,r]));
 for(const r of live.authenticatedRuns)byPath.set(r.sourcePath,r); // auth full records supersede safe mirrors
 live.privateRuns=[...byPath.values()].sort((a,b)=>asText(b.logged_at).localeCompare(asText(a.logged_at)));
}
async function refreshPublishedRuns(){
 try{
  const response=await fetch('./data/run_index.json?refresh='+Date.now(), {cache:'no-store'});
  if(!response.ok)throw Error('Public summary index not available (HTTP '+response.status+')');
  const data=await response.json();
  if(data.schemaVersion!==1||!Array.isArray(data.runs))throw Error('Invalid public run index schema');
  live.syncedRuns=data.runs.map(item=>({
   ...item,
   publicMirror:true,
   summary:item.summary||'Published redacted statistics',
   question:item.question||'Recorded test',
   url:liveURL(CL_PRIVATE,item.sourcePath),
   raw:{message:'PUBLIC REDACTED SUMMARY — private original accessible only through the authenticated connection',...item},
  }));
  live.mirrorChecked=new Date().toISOString();live.mirrorError='';
  combineVisibleRuns();render();
 }catch(e){live.mirrorError=asText(e.message||e); /* Preserve cached successful state. */}
}
async function refreshPrivate(token,explicit=false){
 if(live.privateBusy)return;
 if(token!==undefined){live.privateToken=token.trim()}
 if(!live.privateToken){if(explicit)liveToast('Enter a read-only GitHub token first');return}
 live.privateBusy=true;live.privateFailures=0;render();
 try{
  const token=live.privateToken;
  const tree=await liveGet(`${CL_API}${CL_PRIVATE}/git/trees/main?recursive=1`,token);
  if(!Array.isArray(tree.tree)||tree.truncated)throw Error('GitHub returned an incomplete private repository tree');
  const files=tree.tree.filter(x=>x.type==='blob'&&/^(runs|rotation_runs|test_runs|fingerprint_runs|game_runs)\/[^/]+\.json$/.test(x.path));
  live.privateTotal=files.length;
  const byPath=new Map(live.privateRuns.map(r=>[r.sourcePath,r]));
  const {results,failures}=await livePool(files,async f=>{
   const old=byPath.get(f.path);if(old&&!old.publicMirror&&old.blobSha===f.sha)return old;
   const obj=await liveGet(`${CL_API}${CL_PRIVATE}/git/blobs/${encodeURIComponent(f.sha)}`,token);
   if(obj.encoding!=='base64')throw Error('Unexpected blob encoding');
   const binary=atob(obj.content.replace(/\s/g,''));
   const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
   const item=privateSummary(JSON.parse(new TextDecoder().decode(bytes)),f.path);item.blobSha=f.sha;return item;
  },6);
  live.privateFailures=failures;
  live.authenticatedRuns=results.filter(x=>!x?._error).sort((a,b)=>b.logged_at.localeCompare(a.logged_at));
  combineVisibleRuns();
  live.privateChecked=new Date().toISOString();
  if(!explicit)liveToast(`Private log: ${live.privateRuns.length} runs loaded`);
 }catch(e){live.privateFailures++;liveToast(`Private sync: ${e.message}`)}
 finally{live.privateBusy=false;render()}
}
function liveOverview(){const [a,b]=dailyPairs();const dif=getDailyChanges(a,b);
 const src=live.lastChecked?liveStatusMsg():'Connecting to real GitHub data…';
 return head('Research control room','Real archive-backed results, private interactive-run access, PR regression checks, and evidence records.',btn('Refresh from GitHub','live-refresh','activity','primary'))+
 `<div class="toolbar">${liveHeaderStatus()}<button class="plain-link" data-nav="live">Configure sources and private run access →</button></div>`+
 `<div class="grid cols-4">${[['Nightly archives',db.runs.filter(r=>r.sourceKind==='github-nightly').length,'GitHub source-backed','database'],['Latest survivors',b?.snapshots?.length??'—',b?.date||'Waiting for source','layers-3'],['Membership changes',a?`${dif.counts.added}↑ ${dif.counts.dropped}↓`:'—','Last two nightlies','git-compare'],['Interactive logged runs',live.privateRuns.length,live.privateToken?'Private originals connected':live.syncedRuns.length?'Synced safe public summaries':'Awaiting run sync','flask-conical']].map(([name,num,foot,icon])=>`<div class="card metric"><div class="metric-top">${esc(name)}<span class="metric-icon">${ic(icon)}</span></div><div class="metric-value">${esc(num)}</div><div class="metric-foot">${esc(foot)}</div></div>`).join('')}</div>`+
 liveEventCard()+`<div class="grid cols-2 section-gap"><section class="card"><div class="card-head"><div><h2>Pull requests (verified when connected)</h2><p class="card-sub">Live GitHub status · local regression notes retained</p></div><button class="plain-link" data-nav="prs">All PRs →</button></div><div class="card-body">${db.prs.filter(p=>['16','17','15'].includes(String(p.number))).map(p=>`<div class="list-row"><div class="row-icon">${ic('git-pull-request')}</div><div class="row-main"><strong>${esc('#'+p.number+' '+p.title)}</strong><div class="row-meta">${pill(p.status)} ${pill(p.risk)}</div><div class="row-desc">${esc(short(p.regression,115))}</div></div><div class="row-tail">${p.url?`<a href="${safeLink(p.url)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>`:''}</div></div>`).join('')}</div></section><section class="card"><div class="card-head"><div><h2>Next actions</h2><p class="card-sub">What still needs testing or interpretation</p></div><button class="plain-link" data-nav="actions">Queue →</button></div><div class="card-body">${db.actions.filter(a=>a.status!=='done').slice(0,7).map(x=>`<div class="list-row"><div class="row-main"><strong>${esc(x.title)}</strong><div class="row-meta">${pill(x.priority)}${pill(x.status)}</div></div></div>`).join('')||'All currently listed actions are marked complete.'}</div></section></div>`+footer();
}
function liveSurvivors(){const old=survivorsView();const [a,b]=dailyPairs();const set=(b?.snapshots||[]).slice().sort((x,y)=>Number(y.streak||0)-Number(x.streak||0));const extra=`<section class="card section-gap"><div class="card-head"><div><h2>Active nightly survivors — ${esc(b?.date||'not yet loaded')}</h2><div class="card-sub">Source-backed. Stable keys use series name + lens + EQ, not changing Dxx dataset IDs.</div></div>${pill(set.length+' active','green')}</div><div class="table-scroll"><table><thead><tr><th>Series</th><th>Lens</th><th>EQ</th><th>Percentile</th><th>Streak nights</th><th>Standing</th></tr></thead><tbody>${set.map(s=>`<tr><td><strong>${esc(s.label)}</strong></td><td>${esc(s.lens)}</td><td>${esc(s.eq)}</td><td>${esc(s.percentile)}</td><td>${fmt(s.streak)}</td><td>${pill(s.standing||'survivor','green')}</td></tr>`).join('')||'<tr><td colspan="6">Refresh public sources to load survivors</td></tr>'}</tbody></table></div></section>`;
 const needle='</div>'; // insert after first view header to keep existing local candidate register intact
 return old+extra;
}
const previousShell=shell;
shell=function(){previousShell();const el=document.querySelector('#topbar .top-right');if(el){const b=document.createElement('button');b.className='button';b.dataset.action='live-refresh';b.innerHTML=ic('activity')+' Refresh';b.title='Pull newly committed GitHub nightlies and PR updates';el.prepend(b)}const ws=document.querySelector('.workspace');if(ws)ws.innerHTML=`<span class="caps">REPO SOURCES</span><strong><span class="status-dot"></span>GitHub nightly + PRs</strong><p>${esc(liveStatusMsg())}</p><p>Interactive runs: ${live.privateToken?'private log connected':'private authentication needed'}</p>`;};
const previousFooter=footer;
footer=function(){return `<div class="footer-note">${ic('shield-check')} Nightly results / PR status are loaded from GitHub when refreshed; public run summaries refresh from this dashboard's sync workflow; original private records require authenticated read access. Hypotheses, annotations, and evidence notes remain locally editable. Sync errors are shown on Live sources.</div>`};
const previousRunsView=runsView;
runsView=function(){return previousRunsView()+`<section class="card card-pad section-gap"><h2>Raw archive checks and cautions</h2><p class="description">Each imported nightly includes every archived survivor and its streak (from the nightly headline), plus the lens checks and luck-pile classifications for transition analysis. A 0th/100th percentile under a two-sided lens is not a Kaggle score. Interactive Streamlit run records are in <button class="plain-link" data-nav="live">Live sources</button> because the shared log is private.</p></section>`};
const previousCompare=compareView;
compareView=function(){return previousCompare()+liveEventCard()};
const previousPrs=prsView;
prsView=function(){return previousPrs().replaceAll('Status is manually recorded, not live.','Status refreshes from GitHub. Regression notes stay editable.')};
NAV.splice(1,0,['live','Live sources','activity']);
renderMap.live=liveSourcesView;renderMap.overview=liveOverview;renderMap.survivors=liveSurvivors;renderMap.runs=runsView;renderMap.compare=compareView;renderMap.prs=prsView;
statusLabels['sturdy survivor']='Sturdy survivor';statusTone['sturdy survivor']='green';statusTone['survivor']='green';statusTone['luck pile']='amber';statusTone['not surviving']='dark';
const initialHash=location.hash.slice(1);if(initialHash==='live')view='live';
document.addEventListener('click',e=>{const el=e.target.closest('[data-action^="live-"]');if(!el)return;e.preventDefault();const a=el.dataset.action;
 if(a==='live-refresh'){refreshLive();if(live.privateToken)refreshPrivate();}
 if(a==='live-refresh-private')refreshPrivate();
 if(a==='live-disconnect'){live.privateToken='';live.authenticatedRuns=[];combineVisibleRuns();live.privateTotal=0;live.privateChecked=null;live.selectedPrivate='';render();liveToast('Private GitHub credentials cleared');}
 if(a==='live-private-select'){live.selectedPrivate=el.dataset.id;render()}
 if(a==='live-copy-private'){const item=live.privateRuns.find(x=>x.id===el.dataset.id);if(item&&navigator.clipboard?.writeText)navigator.clipboard.writeText(`${item.id} ${item.kind}: ${item.status}\n${item.question}\n${item.summary}\n${item.url}`).then(()=>liveToast('Run summary copied')).catch(()=>liveToast('Could not copy'))}
 if(a==='live-download-private'){const item=live.privateRuns.find(x=>x.id===el.dataset.id);if(item)download(`${item.id}.json`,JSON.stringify(item.raw,null,2))}
 if(a==='live-save-evidence'){const item=live.privateRuns.find(x=>x.id===el.dataset.id);if(item){const id='ev-private-'+item.id;const entry={id,date:item.logged_at.slice(0,10)||latestDate(),kind:'Private interactive run',title:`${item.kind} ${item.id} · ${item.status}`,summary:`${item.question} — ${item.summary}`,source:CL_PRIVATE+'/'+item.sourcePath,url:item.url,hash:item.blobSha||'',link:item.id,confidence:'Source-backed private log (user selected for evidence export)'};const old=db.evidence.find(x=>x.id===id);if(old)Object.assign(old,entry);else db.evidence.push(entry);save();liveToast('Selected private run added to local evidence trail');}}
});
document.addEventListener('submit',e=>{if(e.target.id!=='liveAuthForm')return;e.preventDefault();const token=e.target.elements.token.value.trim();e.target.elements.token.value='';if(!token)return liveToast('Enter a read-only token');refreshPrivate(token,true)});
document.addEventListener('change',e=>{if(e.target.id==='livePrivateFilter'){live.privateFilter=e.target.value;render()}if(e.target.id==='liveDailySelect'){live.selectedDaily=e.target.value;render()}if(e.target.id==='liveDailyClass'){live.dailyFilter=e.target.value;render()}if(e.target.id==='liveDailySearch'){live.dailySearch=e.target.value;render()}});
window.addEventListener('pageshow',()=>{if(!live.lastChecked&&!live.fetching)refreshLive(true)});
render();
// Re-query GitHub while the dashboard is open (10 min to respect anonymous API limits).
setInterval(()=>{if(!document.hidden){refreshLive(true);if(live.privateToken)refreshPrivate()}},600000);
refreshLive(true);