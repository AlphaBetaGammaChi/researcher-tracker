const KEY='researcherTracker.v1', OA='https://api.openalex.org';
const WORK_SELECT='id,doi,title,display_name,publication_year,type,cited_by_count,primary_location,authorships,topics';
const CITER_SELECT='id,doi,title,display_name,publication_year,primary_location,authorships,referenced_works';

function blank(){ return {profile:{name:'',orcid:'',scholar:'',openalexId:''},papers:[],excluded:[],keywords:[],lastSync:null}; }
function load(){
  try{ const raw=localStorage.getItem(KEY); return raw?cleanBackup(JSON.parse(raw)):blank(); }
  catch(e){ return blank(); }
}
let S=load();
function save(){
  try{ localStorage.setItem(KEY,JSON.stringify(S)); }
  catch(e){ toast('This browser would not save the data. Export a JSON backup to keep a copy.'); }
}

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,4000); }
function shortId(u){ return u?String(u).trim().split('/').pop():''; }
// Accepts a bare iD or an orcid.org URL. Returns '' unless the format and check digit are valid.
function cleanOrcid(x){
  const m=String(x||'').trim().match(/(?:orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/i);
  if(!m) return '';
  const id=m[1].toUpperCase(), d=id.replace(/-/g,'');
  let t=0; for(let i=0;i<15;i++) t=(t+parseInt(d[i],10))*2;
  const r=(12-(t%11))%11;
  return (r===10?'X':String(r))===d[15] ? id : '';
}
const str=(v,max=500)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max);
const yearOf=v=>{ const n=parseInt(v,10); return Number.isInteger(n)&&n>1000&&n<3000?n:null; };
const openalexIdOf=v=>{ const m=String(v||'').match(/^(?:https:\/\/openalex\.org\/)?(A\d+)$/i); return m?'https://openalex.org/'+m[1].toUpperCase():''; };
// Rebuild imported or stored data field by field, so odd types and extra keys never reach the page.
function cleanPaper(p){
  if(!p||typeof p!=='object') return null;
  const arr=(v,n)=>Array.isArray(v)?v.slice(0,n):[];
  return {
    id:str(p.id,200), source:str(p.source,20), title:str(p.title,500)||'Untitled', year:yearOf(p.year),
    journal:str(p.journal,300), publisher:str(p.publisher,300), doi:str(p.doi,300), url:str(p.url,500), type:str(p.type,50),
    authors:arr(p.authors,500).map(a=>({name:str(a&&a.name,200),id:str(a&&a.id,200)})),
    topics:arr(p.topics,200).map(t=>({name:str(t&&t.name,200),subfield:str(t&&t.subfield,200)})),
    cites:Math.max(0,parseInt(p.cites,10)||0),
    citedBy:arr(p.citedBy,5000).map(c=>({id:str(c&&c.id,200),title:str(c&&c.title,500),year:yearOf(c&&c.year),doi:str(c&&c.doi,300),url:str(c&&c.url,500),venue:str(c&&c.venue,300),authors:arr(c&&c.authors,100).map(x=>str(x,200))}))
  };
}
function cleanBackup(o){
  const b=blank();
  if(!o||typeof o!=='object') return b;
  const pr=(o.profile&&typeof o.profile==='object')?o.profile:{};
  b.profile={name:str(pr.name,120),orcid:cleanOrcid(pr.orcid),scholar:str(pr.scholar,300),openalexId:openalexIdOf(pr.openalexId)};
  b.papers=(Array.isArray(o.papers)?o.papers:[]).slice(0,5000).map(cleanPaper).filter(Boolean);
  b.excluded=(Array.isArray(o.excluded)?o.excluded:[]).slice(0,10000).map(x=>str(x,200));
  b.keywords=(Array.isArray(o.keywords)?o.keywords:[]).slice(0,200).map(x=>str(x,100));
  b.lastSync=typeof o.lastSync==='string'?str(o.lastSync,40):null;
  return b;
}
function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function akey(a){ return a.id || 'name:'+String(a.name||'').toLowerCase().trim(); }
function meKey(){ return S.profile.openalexId || 'name:'+(S.profile.name||'me').toLowerCase().trim(); }
function safeHref(u){ return /^https?:\/\//.test(u||'')?u:'#'; }
function link(p){
  if(/^https?:\/\//.test(p.url||'')) return p.url;
  if(p.doi) return 'https://doi.org/'+p.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//,'');
  return '';
}
function status(msg){ $('#syncStatus').textContent=msg; }
function busy(on){ const b=$('#syncBtn'); b.disabled=on; b.textContent=on?'Syncing…':'Sync from OpenAlex'; }

/* ---------- OpenAlex ---------- */
async function oa(path,params={}){
  const u=new URL(OA+path);
  for(const [k,v] of Object.entries(params)) u.searchParams.set(k,v);
  const r=await fetch(u);
  if(!r.ok) throw new Error('OpenAlex returned '+r.status+' for '+path);
  return r.json();
}
async function fetchAll(path,params,max,onProg){
  const out=[]; let cursor='*';
  while(cursor && out.length<max){
    const r=await oa(path,Object.assign({'per-page':'200'},params,{cursor}));
    out.push(...r.results);
    cursor=r.meta&&r.meta.next_cursor;
    if(onProg) onProg(out.length);
    if(!r.results.length) break;
  }
  return out;
}
function toPaper(w){
  const loc=w.primary_location||{}, src=loc.source||{};
  return {
    id:w.id, source:'openalex', title:w.display_name||w.title||'Untitled',
    year:w.publication_year||null, journal:src.display_name||'', publisher:src.host_organization_name||'',
    doi:w.doi||'', url:loc.landing_page_url||'', type:w.type||'',
    authors:(w.authorships||[]).map(a=>({name:(a.author&&a.author.display_name)||'Unknown',id:(a.author&&a.author.id)||''})),
    topics:(w.topics||[]).map(t=>({name:t.display_name||'',subfield:(t.subfield&&t.subfield.display_name)||''})).filter(t=>t.name),
    cites:w.cited_by_count||0, citedBy:[]
  };
}
function toCiter(c){
  const loc=c.primary_location||{};
  return {
    id:c.id, title:c.display_name||c.title||'Untitled', year:c.publication_year||null,
    doi:c.doi||'', url:loc.landing_page_url||c.doi||c.id, venue:(loc.source&&loc.source.display_name)||'',
    authors:(c.authorships||[]).map(a=>(a.author&&a.author.display_name)||'Unknown')
  };
}

async function sync(){
  const p=S.profile;
  if(!p.name && !p.orcid && !p.openalexId){ toast('Add your name, ORCID iD or OpenAlex ID first.'); return; }
  busy(true);
  try{
    status('Finding your OpenAlex author record…');
    let a;
    if(p.openalexId) a=await oa('/authors/'+shortId(p.openalexId));
    else if(cleanOrcid(p.orcid)) a=await oa('/authors/orcid:'+cleanOrcid(p.orcid));
    else{
      const r=await oa('/authors',{search:p.name,'per-page':'5'});
      a=r.results&&r.results[0];
      if(!a) throw new Error('no OpenAlex author found for that name. Add your ORCID iD.');
    }
    p.openalexId=a.id;
    p.orcid=cleanOrcid(a.orcid)||cleanOrcid(p.orcid);
    if(!p.name) p.name=a.display_name;
    const inst=(a.last_known_institutions||[]).map(i=>i.display_name).join(', ')||'no institution listed';
    status(`Matched ${a.display_name} (${inst}). Downloading works…`);

    const works=await fetchAll('/works',{filter:'authorships.author.id:'+shortId(a.id),select:WORK_SELECT},3000,n=>status(`Downloaded ${n} works…`));
    const excluded=new Set(S.excluded);
    const openalex=works.filter(w=>!excluded.has(w.id)).map(toPaper);
    const oaTitles=new Set(openalex.map(x=>norm(x.title)));
    const manual=S.papers.filter(x=>x.source!=='openalex' && !oaTitles.has(norm(x.title)));
    S.papers=[...openalex,...manual];

    const byShort=new Map(openalex.map(x=>[shortId(x.id),x]));
    const ids=[...byShort.keys()].filter(k=>byShort.get(k).cites>0);
    const seenPairs=new Set();
    for(let i=0;i<ids.length;i+=40){
      const batch=ids.slice(i,i+40);
      status(`Looking up citing papers (${Math.min(i+40,ids.length)} of ${ids.length} cited works)…`);
      const citers=await fetchAll('/works',{filter:'cites:'+batch.join('|'),select:CITER_SELECT},5000);
      for(const c of citers){
        const info=toCiter(c);
        for(const r of (c.referenced_works||[])){
          const paper=byShort.get(shortId(r));
          const pairKey=paper && paper.id+'|'+info.id;
          if(paper && !seenPairs.has(pairKey)){ seenPairs.add(pairKey); paper.citedBy.push(info); }
        }
      }
    }
    S.lastSync=new Date().toISOString();
    save();
    status(`Synced ${openalex.length} works on ${new Date().toLocaleString()}.`);
    fillProfile(); renderAll();
  }catch(e){
    status('Sync failed: '+e.message+'. Check your internet connection and identifiers.');
  }finally{ busy(false); }
}

/* ---------- Data helpers ---------- */
function coGraph(){
  const me=meKey(), people=new Map(), edges=new Map();
  const ensure=(k,name)=>{ if(!people.has(k)) people.set(k,{key:k,name:name,count:0,years:[]}); return people.get(k); };
  ensure(me,S.profile.name||'You');
  for(const p of S.papers){
    const list=new Map([[me,S.profile.name||'You']]);
    for(const a of p.authors){ const k=akey(a); if(!list.has(k)) list.set(k,a.name); }
    const keys=[...list.keys()];
    for(const k of keys){ const pe=ensure(k,list.get(k)); pe.count++; if(p.year) pe.years.push(p.year); }
    for(let i=0;i<keys.length;i++) for(let j=i+1;j<keys.length;j++){
      const [a,b]=[keys[i],keys[j]].sort();
      const ek=a+'||'+b;
      if(!edges.has(ek)) edges.set(ek,{a,b,w:0});
      edges.get(ek).w++;
    }
  }
  return {me,people,edges};
}
function hIndex(vals){
  const s=[...vals].sort((a,b)=>b-a); let h=0;
  s.forEach((c,i)=>{ if(c>=i+1) h=i+1; });
  return h;
}
function parseBib(text){
  const out=[];
  for(const body of text.split(/@\w+\s*[{(]/).slice(1)){
    const f={};
    const re=/(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;
    let m;
    while((m=re.exec(body))) f[m[1].toLowerCase()]=(m[2]??m[3]??m[4]??'').replace(/[{}]/g,'').replace(/\s+/g,' ').trim();
    if(!f.title) continue;
    const authors=(f.author||'').split(/\s+and\s+/i).map(s=>s.trim()).filter(Boolean).map(s=>{
      if(s.includes(',')){ const [l,fi]=s.split(',',2); return (fi||'').trim()+' '+l.trim(); }
      return s;
    }).map(name=>({name,id:''}));
    out.push({
      id:'manual:bib:'+norm(f.title).slice(0,80), source:'bibtex', title:f.title,
      year:parseInt(f.year,10)||null, journal:f.journal||f.booktitle||'', publisher:f.publisher||'',
      doi:f.doi||'', url:f.url||'', type:'', authors,
      topics:(f.keywords||'').split(/[,;]/).map(s=>({name:s.trim(),subfield:''})).filter(t=>t.name),
      cites:0, citedBy:[]
    });
  }
  return out;
}
function layout(nodes,edges,W,H){
  const n=nodes.length, idx=new Map(nodes.map((nd,i)=>[nd.key,i]));
  const P=nodes.map((_,i)=>({x:W/2+Math.cos(i*2.399)*W*0.3,y:H/2+Math.sin(i*2.399)*H*0.3,dx:0,dy:0}));
  const k=Math.sqrt(W*H/n)*0.8;
  let t=W/8;
  for(let it=0;it<400;it++){
    P.forEach(p=>{p.dx=0;p.dy=0;});
    for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){
      const a=P[i],b=P[j]; let x=a.x-b.x,y=a.y-b.y; const d=Math.hypot(x,y)||0.01; const f=(k*k)/d;
      x/=d; y/=d; a.dx+=x*f; a.dy+=y*f; b.dx-=x*f; b.dy-=y*f;
    }
    for(const e of edges){
      const a=P[idx.get(e.a)], b=P[idx.get(e.b)]; let x=a.x-b.x,y=a.y-b.y; const d=Math.hypot(x,y)||0.01;
      const f=(d*d)/k*Math.sqrt(e.w); x/=d; y/=d;
      a.dx-=x*f; a.dy-=y*f; b.dx+=x*f; b.dy+=y*f;
    }
    for(const p of P){ p.dx+=(W/2-p.x)*0.02; p.dy+=(H/2-p.y)*0.02; }
    for(const p of P){
      const m=Math.hypot(p.dx,p.dy)||0.01, s=Math.min(m,t)/m;
      p.x=Math.min(W-30,Math.max(30,p.x+p.dx*s)); p.y=Math.min(H-30,Math.max(30,p.y+p.dy*s));
    }
    t*=0.985;
  }
  const out={}; nodes.forEach((nd,i)=>out[nd.key]=P[i]);
  return out;
}

/* ---------- Actions ---------- */
function addPaper(){
  const title=$('#mTitle').value.trim();
  if(!title){ toast('Enter a title.'); return; }
  const split=s=>s.split(',').map(x=>x.trim()).filter(Boolean);
  const doi=$('#mDoi').value.trim();
  S.papers.push({
    id:'manual:'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), source:'manual', title,
    year:parseInt($('#mYear').value,10)||null, journal:$('#mJournal').value.trim(), publisher:$('#mPublisher').value.trim(),
    doi:/doi\.org|^10\./.test(doi)?doi:'', url:/^https?:\/\//.test(doi)?doi:'', type:'',
    authors:split($('#mAuthors').value).map(name=>({name,id:''})),
    topics:split($('#mTopics').value).map(name=>({name,subfield:''})),
    cites:0, citedBy:[]
  });
  ['#mTitle','#mYear','#mJournal','#mPublisher','#mDoi','#mAuthors','#mTopics'].forEach(s=>$(s).value='');
  save(); renderAll(); toast('Paper added.');
}
function importBib(){
  if($('#bib').value.length>2000000){ toast('That BibTeX text is too large.'); return; }
  const parsed=parseBib($('#bib').value);
  if(!parsed.length){ toast('No BibTeX entries with a title were found.'); return; }
  const have=new Set(S.papers.map(p=>norm(p.title)));
  let added=0;
  for(const p of parsed){ if(!have.has(norm(p.title))){ have.add(norm(p.title)); S.papers.push(p); added++; } }
  $('#bib').value='';
  save(); renderAll(); toast(`Imported ${added} new paper${added===1?'':'s'}.`);
}
function deletePaper(id){
  const p=S.papers.find(x=>x.id===id); if(!p) return;
  if(!confirm(`Remove "${p.title}" from the tracker?`)) return;
  S.papers=S.papers.filter(x=>x.id!==id);
  if(p.source==='openalex' && !S.excluded.includes(id)) S.excluded.push(id);
  save(); renderAll();
}
function saveProfile(){
  const p=S.profile;
  p.name=str($('#pName').value.trim(),120);
  const prevOrcid=p.orcid, prevName=p.name;
  const rawOrcid=$('#pOrcid').value.trim();
  if(rawOrcid && !cleanOrcid(rawOrcid)){ toast('That ORCID iD is not valid. Check it has the form 0000-0002-1825-0097.'); return; }
  p.orcid=cleanOrcid(rawOrcid);
  const sch=$('#pScholar').value.trim();
  if(sch && !/^https:\/\/scholar\.google\.[a-z.]+\//i.test(sch)){ toast('The Scholar link should start with https://scholar.google.'); return; }
  p.scholar=str(sch,300);
  const oaVal=$('#pOa').value.trim();
  if(oaVal && !openalexIdOf(oaVal)){ toast('An OpenAlex author ID looks like A5023888391.'); return; }
  // Use an explicit OpenAlex ID if given. If the identity changed, clear the old match so the next sync re-matches.
  if(oaVal) p.openalexId=openalexIdOf(oaVal);
  else if(p.orcid!==prevOrcid || p.name!==prevName) p.openalexId='';
  save(); renderAll(); toast('Profile saved.');
}
function fillProfile(){
  const p=S.profile;
  $('#pName').value=p.name||''; $('#pOrcid').value=p.orcid||''; $('#pScholar').value=p.scholar||'';
  $('#pOa').value=shortId(p.openalexId)||'';
  status(S.lastSync?`Last synced ${new Date(S.lastSync).toLocaleString()}.`:'Not synced yet.');
}
function addKeywords(){
  const vals=$('#kwInput').value.split(',').map(s=>s.trim()).filter(Boolean);
  for(const v of vals) if(!S.keywords.some(k=>norm(k)===norm(v))) S.keywords.push(v);
  $('#kwInput').value=''; save(); renderKeywords();
}
function removeKeyword(i){ S.keywords.splice(i,1); save(); renderKeywords(); }
function download(name,text,type){
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportJSON(){ download('researcher-tracker-backup.json',JSON.stringify(S,null,2),'application/json'); }
function exportCSV(){
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const cols=['Title','Year','Journal','Publisher','DOI','Authors','Topics','Citations','Citing papers'];
  const rows=S.papers.map(p=>[p.title,p.year,p.journal,p.publisher,p.doi,p.authors.map(a=>a.name).join('; '),p.topics.map(t=>t.name).join('; '),p.cites,p.citedBy.length].map(q).join(','));
  download('papers.csv',[cols.map(q).join(','),...rows].join('\n'),'text/csv');
}
function restoreJSON(file){
  const reader=new FileReader();
  if(file.size>20000000){ toast('That backup file is too large.'); return; }
  reader.onload=()=>{
    try{
      S=cleanBackup(JSON.parse(reader.result));
      save(); fillProfile(); renderAll(); toast('Backup restored.');
    }catch(e){ toast('That file is not a valid backup.'); }
  };
  reader.readAsText(file);
}
function clearAll(){
  if(!confirm('Delete all tracker data stored in this browser? Export a backup first if you need it.')) return;
  S=blank(); save(); fillProfile(); renderAll(); toast('All data deleted.');
}
function scholarSearch(){
  const name=$('#pName').value.trim();
  if(!name){ toast('Enter your name first.'); return; }
  window.open('https://scholar.google.com/citations?view_op=search_authors&mauthors='+encodeURIComponent(name),'_blank','noopener');
  toast('Copy your profile link from Scholar and paste it into the field above.');
}
function showTab(name){
  document.querySelectorAll('[data-view]').forEach(s=>{ s.hidden = s.id!=='tab-'+name; });
  document.querySelectorAll('nav [data-action="tab"]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===name)));
  if(name==='coauthors') renderCo();
}

/* ---------- Rendering ---------- */
function renderAll(){
  renderStats(); renderTimeline(); renderTopics(); renderKeywords();
  renderPapers(); renderVenues(); renderCo(); renderCitations();
  const p=S.profile;
  $('#who').textContent = p.name
    ? `${p.name}${p.orcid?' · ORCID '+p.orcid:''}${S.lastSync?' · synced '+new Date(S.lastSync).toLocaleDateString():''}`
    : 'Set up your profile in the Profile tab, then sync.';
}
function renderStats(){
  const g=coGraph(), ps=S.papers;
  const cites=ps.map(p=>p.cites||0);
  const citers=new Set(); ps.forEach(p=>p.citedBy.forEach(c=>citers.add(c.id)));
  const journals=new Set(ps.map(p=>p.journal).filter(Boolean));
  const years=ps.map(p=>p.year).filter(Boolean);
  const items=[
    ['Papers',ps.length],
    ['Citations',cites.reduce((a,b)=>a+b,0)],
    ['h-index',hIndex(cites)],
    ['i10-index',cites.filter(c=>c>=10).length],
    ['Citing papers',citers.size],
    ['Journals',journals.size],
    ['Co-authors',Math.max(0,g.people.size-1)],
    ['Years active',years.length?`${Math.min(...years)}–${Math.max(...years)}`:'—']
  ];
  $('#stats').innerHTML=items.map(([l,v])=>`<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
}
function renderTimeline(){
  const pubs={}, cit={}, citers=new Map();
  S.papers.forEach(p=>{
    if(p.year) pubs[p.year]=(pubs[p.year]||0)+1;
    p.citedBy.forEach(c=>{ if(c.year) citers.set(c.id,c.year); });
  });
  for(const y of citers.values()) cit[y]=(cit[y]||0)+1;
  const yrs=[...Object.keys(pubs),...Object.keys(cit)].map(Number);
  if(!yrs.length){ $('#timeline').innerHTML='<p class="muted">No dated papers yet. Sync or add papers to see the timeline.</p>'; return; }
  const y0=Math.min(...yrs), y1=Math.max(...yrs), years=[];
  for(let y=y0;y<=y1;y++) years.push(y);
  const maxV=Math.max(1,...years.map(y=>Math.max(pubs[y]||0,cit[y]||0)));
  const W=800,H=240,pad=30,base=H-30,plot=H-60,bw=(W-2*pad)/years.length;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Papers and citing papers per year" style="width:100%;height:auto;display:block">`;
  for(let g=0;g<=4;g++){
    const v=Math.round(maxV*g/4), y=base-plot*g/4;
    s+=`<line x1="${pad}" x2="${W-pad}" y1="${y}" y2="${y}" style="stroke:var(--line)"/><text x="${pad-6}" y="${y+4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${v}</text>`;
  }
  years.forEach((y,i)=>{
    const x0=pad+i*bw, hP=(pubs[y]||0)/maxV*plot, hC=(cit[y]||0)/maxV*plot;
    s+=`<rect x="${(x0+bw*0.12).toFixed(1)}" y="${(base-hP).toFixed(1)}" width="${(bw*0.36).toFixed(1)}" height="${hP.toFixed(1)}" rx="2" style="fill:var(--accent)"><title>${y}: ${pubs[y]||0} papers</title></rect>`;
    s+=`<rect x="${(x0+bw*0.5).toFixed(1)}" y="${(base-hC).toFixed(1)}" width="${(bw*0.36).toFixed(1)}" height="${hC.toFixed(1)}" rx="2" style="fill:var(--accent2)"><title>${y}: ${cit[y]||0} citing papers</title></rect>`;
    if(years.length<=12 || y%2===0) s+=`<text x="${(x0+bw/2).toFixed(1)}" y="${H-10}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${y}</text>`;
  });
  $('#timeline').innerHTML=s+'</svg>';
}
function renderTopics(){
  const t=new Map(), sub=new Map();
  S.papers.forEach(p=>{
    const names=new Set(), subs=new Set();
    p.topics.forEach(x=>{ names.add(x.name); if(x.subfield) subs.add(x.subfield); });
    names.forEach(n=>t.set(n,(t.get(n)||0)+1));
    subs.forEach(n=>sub.set(n,(sub.get(n)||0)+1));
  });
  const top=[...t.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
  const max=top[0]?top[0][1]:1;
  const subTop=[...sub.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  $('#topics').innerHTML = top.length
    ? top.map(([n,c])=>`<div class="barrow"><span>${esc(n)}</span><div class="track"><div class="bar" style="width:${(c/max*100).toFixed(1)}%"></div></div><span class="n">${c}</span></div>`).join('')
      + (subTop.length?`<p class="meta" style="margin-top:12px">Fields: ${subTop.map(([n,c])=>`<span class="chip">${esc(n)} · ${c}</span>`).join('')}</p>`:'')
    : '<p class="muted">No topics yet. Sync from OpenAlex or add topics to your papers.</p>';
}
function renderKeywords(){
  $('#keywords').innerHTML = S.keywords.map((k,i)=>`<span class="chip">${esc(k)} <button data-action="remove-kw" data-i="${i}" aria-label="Remove ${esc(k)}" style="border:0;background:none;color:inherit;cursor:pointer;padding:0 2px">×</button></span>`).join('')
    || '<span class="muted">No keywords yet.</span>';
}
function renderPapers(){
  const q=norm($('#q').value), ysel=$('#yearF'), yf=ysel.value;
  const years=[...new Set(S.papers.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a);
  ysel.innerHTML='<option value="">All years</option>'+years.map(y=>`<option value="${y}">${y}</option>`).join('');
  ysel.value=yf;
  const list=S.papers.filter(p=>
    (!ysel.value || String(p.year)===ysel.value) &&
    (!q || norm([p.title,p.journal,p.publisher,p.authors.map(a=>a.name).join(' '),p.topics.map(t=>t.name).join(' ')].join(' ')).includes(q))
  ).sort((a,b)=>(b.year||0)-(a.year||0)||b.cites-a.cites);
  $('#papers').innerHTML = `<p class="meta">${list.length} of ${S.papers.length} papers</p>` + (list.map(p=>`
    <div class="paper">
      <div class="t">${link(p)?`<a href="${esc(safeHref(link(p)))}" target="_blank" rel="noopener">${esc(p.title)}</a>`:esc(p.title)}</div>
      <div class="meta">${esc(p.year||'n.d.')} · ${esc(p.journal||'Venue unknown')}${p.publisher?' · '+esc(p.publisher):''} · <b>${p.cites}</b> citations · ${p.citedBy.length} citing you</div>
      <div class="meta">${esc(p.authors.map(a=>a.name).slice(0,8).join(', '))}${p.authors.length>8?' et al.':''}</div>
      <div style="margin-top:4px">${p.topics.slice(0,6).map(t=>`<span class="chip">${esc(t.name)}</span>`).join('')}</div>
      ${p.citedBy.length?`<details class="cites"><summary>${p.citedBy.length} citing paper${p.citedBy.length===1?'':'s'}</summary>${p.citedBy.slice().sort((a,b)=>(b.year||0)-(a.year||0)).map(c=>`<div class="meta">${esc(c.year||'n.d.')} · ${c.url?`<a href="${esc(safeHref(c.url))}" target="_blank" rel="noopener">${esc(c.title)}</a>`:esc(c.title)}${c.authors.length?' — '+esc(c.authors.slice(0,3).join(', '))+(c.authors.length>3?' et al.':''):''}</div>`).join('')}</details>`:''}
      <div style="margin-top:6px"><button class="danger" data-action="delete-paper" data-id="${esc(p.id)}">Remove</button></div>
    </div>`).join('') || '<p class="muted">No papers match. Sync from OpenAlex or add one below.</p>');
}
function renderVenues(){
  const j=new Map(), pub=new Map();
  S.papers.forEach(p=>{
    const jn=p.journal||'Unknown venue', pn=p.publisher||'Unknown publisher';
    const e=j.get(jn)||{name:jn,publisher:p.publisher||'',papers:0,cites:0,last:0};
    e.papers++; e.cites+=p.cites||0; e.last=Math.max(e.last,p.year||0); if(!e.publisher) e.publisher=p.publisher||'';
    j.set(jn,e);
    const q=pub.get(pn)||{name:pn,journals:new Set(),papers:0,cites:0};
    q.papers++; q.cites+=p.cites||0; q.journals.add(jn);
    pub.set(pn,q);
  });
  const jr=[...j.values()].sort((a,b)=>b.papers-a.papers||b.cites-a.cites);
  const pr=[...pub.values()].sort((a,b)=>b.papers-a.papers||b.cites-a.cites);
  $('#journals').innerHTML = jr.length
    ? `<table><thead><tr><th>Journal or venue</th><th>Publisher</th><th class="n">Papers</th><th class="n">Citations</th><th class="n">Latest</th></tr></thead><tbody>${jr.map(e=>`<tr><td>${esc(e.name)}</td><td>${esc(e.publisher||'—')}</td><td class="n">${e.papers}</td><td class="n">${e.cites}</td><td class="n">${e.last||'—'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No papers yet.</p>';
  $('#publishers').innerHTML = pr.length
    ? `<table><thead><tr><th>Publisher</th><th class="n">Journals</th><th class="n">Papers</th><th class="n">Citations</th></tr></thead><tbody>${pr.map(e=>`<tr><td>${esc(e.name)}</td><td class="n">${e.journals.size}</td><td class="n">${e.papers}</td><td class="n">${e.cites}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No papers yet.</p>';
}
function renderCo(){
  const g=coGraph();
  renderNet(g);
  const rows=[...g.people.values()].filter(p=>p.key!==g.me).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  $('#coauth').innerHTML = rows.length
    ? `<table><thead><tr><th>Collaborator</th><th class="n">Joint papers</th><th class="n">Years</th></tr></thead><tbody>${rows.map(p=>{
        const ys=p.years, yr=ys.length?(Math.min(...ys)===Math.max(...ys)?Math.min(...ys):`${Math.min(...ys)}–${Math.max(...ys)}`):'—';
        return `<tr><td>${esc(p.name)}</td><td class="n">${p.count}</td><td class="n">${yr}</td></tr>`;
      }).join('')}</tbody></table>`
    : '<p class="muted">No co-authors yet.</p>';
}
function renderNet(g){
  const svg=$('#net'), W=800, H=560;
  const others=[...g.people.values()].filter(p=>p.key!==g.me).sort((a,b)=>b.count-a.count).slice(0,35);
  const nodes=[g.people.get(g.me),...others];
  if(nodes.length<2){
    svg.innerHTML=`<text x="400" y="280" text-anchor="middle" style="fill:var(--muted)">Add papers with co-authors to see the network.</text>`;
    return;
  }
  const set=new Set(nodes.map(n=>n.key));
  const edges=[...g.edges.values()].filter(e=>set.has(e.a)&&set.has(e.b));
  const pos=layout(nodes,edges,W,H);
  let s='';
  for(const e of edges){
    const A=pos[e.a], B=pos[e.b];
    s+=`<line x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" style="stroke:var(--muted);stroke-opacity:.35" stroke-width="${Math.min(0.6+e.w*0.7,5).toFixed(2)}"/>`;
  }
  nodes.forEach((n,i)=>{
    const P=pos[n.key], isMe=n.key===g.me;
    const r=isMe?11:4+Math.sqrt(n.count)*2.2;
    s+=`<g><title>${esc(n.name)}: ${n.count} paper${n.count===1?'':'s'}</title>`;
    s+=`<circle cx="${P.x.toFixed(1)}" cy="${P.y.toFixed(1)}" r="${r.toFixed(1)}" style="fill:${isMe?'var(--accent2)':'var(--accent)'}"/>`;
    if(isMe || n.count>=3 || i<12) s+=`<text x="${P.x.toFixed(1)}" y="${(P.y-r-4).toFixed(1)}" text-anchor="middle" font-size="11" style="fill:var(--fg)">${esc(n.name)}</text>`;
    s+='</g>';
  });
  svg.innerHTML=s;
}
function renderCitations(){
  const q=norm($('#cq').value);
  const map=new Map();
  S.papers.forEach(p=>p.citedBy.forEach(c=>{
    let e=map.get(c.id);
    if(!e){ e=Object.assign({},c,{cites:[]}); map.set(c.id,e); }
    e.cites.push(p.title);
  }));
  const list=[...map.values()]
    .filter(c=>!q || norm([c.title,c.venue,(c.authors||[]).join(' ')].join(' ')).includes(q))
    .sort((a,b)=>(b.year||0)-(a.year||0));
  $('#citeCount').textContent=`${list.length} of ${map.size} citing papers`;
  $('#citers').innerHTML = list.length
    ? list.map(c=>`<div class="paper">
        <div class="t">${c.url?`<a href="${esc(safeHref(c.url))}" target="_blank" rel="noopener">${esc(c.title)}</a>`:esc(c.title)}</div>
        <div class="meta">${esc(c.year||'n.d.')} · ${esc(c.venue||'Venue unknown')}</div>
        <div class="meta">${esc(c.authors.slice(0,6).join(', '))}${c.authors.length>6?' et al.':''}</div>
        <div class="meta">Cites: ${c.cites.map(t=>esc(t)).join(' · ')}</div>
      </div>`).join('')
    : '<p class="muted">No citing papers found yet. Sync from OpenAlex, or check back later.</p>';
}

/* ---------- Events ---------- */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-action]');
  if(!el) return;
  switch(el.dataset.action){
    case 'tab': showTab(el.dataset.tab); break;
    case 'sync': sync(); break;
    case 'scholar-search': scholarSearch(); break;
    case 'save-profile': saveProfile(); break;
    case 'add-paper': addPaper(); break;
    case 'add-kw': addKeywords(); break;
    case 'remove-kw': removeKeyword(Number(el.dataset.i)); break;
    case 'delete-paper': deletePaper(el.dataset.id); break;
    case 'import-bib': importBib(); break;
    case 'export-json': exportJSON(); break;
    case 'export-csv': exportCSV(); break;
    case 'clear-all': clearAll(); break;
  }
});
$('#q').addEventListener('input',renderPapers);
$('#yearF').addEventListener('change',renderPapers);
$('#cq').addEventListener('input',renderCitations);
$('#kwInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addKeywords(); } });
$('#jsonFile').addEventListener('change',e=>{ if(e.target.files[0]) restoreJSON(e.target.files[0]); });

fillProfile();
renderAll();
showTab('overview');
