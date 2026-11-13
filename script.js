/* Vestibulando Geo — lógica central da interface */
'use strict';
(() => {
// ========================================
// SUPABASE — autenticação e sincronização
// ========================================
const SUPABASE_URL = 'https://wglpormkexxouuaqwyhq.supabase.co';
// Insira aqui sua chave PUBLICÁVEL (sb_publishable_...). Nunca use service_role/secret.
const SUPABASE_ANON_KEY = 'sb_publishable_MKTJTsep36N6j6mKJWEYTA_B7fS7YMJ';
let supabaseClient = null;
let supabaseLoading = false, supabaseInitialized = false, authInitializing = false, authListenerRegistered = false;
const OFFLINE_DIRTY_KEY = 'vestibulando-geo-v2-offline-dirty';
const AUTH_DEVICE_KEY = 'vestibulando-geo-authenticated-device-v1';
const SUPABASE_STORAGE_KEY = 'sb-wglpormkexxouuaqwyhq-auth-token';
let authUser = null, syncReady = false, syncTimer = null, authMode = 'login';
function readDeviceAuth(){try{const saved=JSON.parse(localStorage.getItem(AUTH_DEVICE_KEY)||'null');return saved&&saved.userId?saved:null}catch{return null}}
function rememberDeviceAuth(user){if(!user?.id)return;try{localStorage.setItem(AUTH_DEVICE_KEY,JSON.stringify({userId:user.id,email:user.email||'',displayName:user.user_metadata?.display_name||'',savedAt:Date.now()}))}catch{}}
function restoreDeviceAuth(){
  let saved=readDeviceAuth();
  // Compatibilidade: reconhece sessões Supabase já existentes antes desta atualização.
  if(!saved){
    try{
      const session=JSON.parse(localStorage.getItem(SUPABASE_STORAGE_KEY)||'null');
      const user=session?.user||session?.currentSession?.user;
      const token=session?.access_token||session?.currentSession?.access_token;
      if(user?.id&&token){rememberDeviceAuth(user);saved=readDeviceAuth()}
    }catch{}
  }
  if(!saved)return false;
  authUser={id:saved.userId,email:saved.email||'',user_metadata:{display_name:saved.displayName||''}};
  showAuthenticated();
  return true;
}
const SOURCE_DATA=window.GEO_CONTENT||[];
const sourceCartografia=SOURCE_DATA.find(c=>c.id==='cartografia');
const sourceGeopolitica=SOURCE_DATA.find(c=>c.id==='geopolitica');
const sourceFisica=SOURCE_DATA.find(c=>c.id==='fisica');
const sourceAmbiente=SOURCE_DATA.find(c=>c.id==='ambiente');
const climateLessonIds=new Set(['ventos-alisios','tempo-clima','massas-ar','circulacao-atmosferica','el-nino-la-nina','mudancas-climaticas']);
const climatologia={
  id:'climatologia',name:'Climatologia',emoji:'🌦️',
  description:'Entenda a atmosfera, os padrões climáticos e suas dinâmicas.',
  unit:'Atmosfera e dinâmica climática',icon:'🌤️',
  lessons:[
    ...(sourceFisica?.lessons||[]).filter(l=>climateLessonIds.has(l.id)),
    ...(sourceAmbiente?.lessons||[]).filter(l=>climateLessonIds.has(l.id))
  ]
};
const DATA=[sourceCartografia,sourceGeopolitica,climatologia].filter(Boolean);
const KEY='vestibulando-geo-v2';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const defaults=()=>({active:'cartografia',xp:0,streak:0,lastDay:null,activityDays:[],completed:{},stats:{},errors:[],badges:[],examCorrect:{},examAttempts:{},examBatch:{enem:[],random:[]},examBatchAnswers:{enem:{},random:{}}});
function load(){try{return {...defaults(),...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return defaults()}}
let state=load(), view='jornada', session=null, map={mode:'countries',continent:'southAmerica',data:null,featureCache:{},boundsCache:{},targets:null,index:0,target:null,found:new Set(),misses:0,finished:false,biomeOrder:null,biomeIndex:0,biomeFound:new Set(),biomeMisses:0,biomeData:null};
let toastTimer;
const active=()=>DATA.find(c=>c.id===state.active)||DATA[0], lessons=(c=active())=>c.lessons||[], doneCount=(c=active())=>lessons(c).filter(l=>state.completed[l.id]).length;
function save(){
  try{
    localStorage.setItem(KEY,JSON.stringify(state));
    // Marca alterações feitas sem sincronização para preservá-las ao reconectar.
    if(!navigator.onLine || !supabaseClient || !authUser || !syncReady) localStorage.setItem(OFFLINE_DIRTY_KEY,'1');
  }catch{}
  updateHeader();
  if(authUser && syncReady){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncProgress(),650)}
}
function notify(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2400)}
function currentStreak(){
  const today=dateKey(),yesterday=dateKey(new Date(Date.now()-86400000));
  if(!state.lastDay||(state.lastDay!==today&&state.lastDay!==yesterday))return 0;
  state.streak=Math.min(10000,Math.max(0,Number(state.streak)||0));
  return state.streak;
}
function studyDay(){
  const today=dateKey();
  if(state.lastDay===today)return;
  const yesterday=dateKey(new Date(Date.now()-86400000));
  state.streak=Math.min(10000,state.lastDay===yesterday?Math.max(0,Number(state.streak)||0)+1:1);
  state.lastDay=today;
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-13);
  state.activityDays=[...new Set([...(state.activityDays||[]).filter(d=>d>=dateKey(cutoff)),today])].sort();
}
function weekDaysMarkup(){
  const now=new Date(),today=dateKey(now),monday=new Date(now);
  monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
  const labels=['SEG','TER','QUA','QUI','SEX','SÁB','DOM'];
  let completed=new Set(state.activityDays||[]);
  if(!completed.size&&state.lastDay&&Number(state.streak)>0){
    for(let i=0;i<7;i++){
      const d=new Date(monday);d.setDate(monday.getDate()+i);
      const diff=Math.round((new Date(`${state.lastDay}T12:00:00`)-new Date(`${dateKey(d)}T12:00:00`))/86400000);
      if(diff>=0&&diff<Math.min(10000,Number(state.streak)||0))completed.add(dateKey(d));
    }
  }
  return labels.map((label,i)=>{
    const d=new Date(monday);d.setDate(monday.getDate()+i);
    const key=dateKey(d),active=completed.has(key),isToday=key===today,isPast=key<today;
    const cls=['day',active?'active':'',!active&&isPast?'missed':'',isToday?'today':'',key>today?'future':''].filter(Boolean).join(' ');
    return `<div class="day ${cls}" aria-label="${label}${active?' — lição concluída':isPast?' — sem lição':''}"><span>${active?'✓':isPast?'·':isToday?'•':' '}</span><small>${label}</small></div>`;
  }).join('');
}
const RANKS=[
  {id:'bronze',name:'Bronze',icon:'🥉',min:0},
  {id:'prata',name:'Prata',icon:'🥈',min:300},
  {id:'ouro',name:'Ouro',icon:'🥇',min:800},
  {id:'platina',name:'Platina',icon:'💠',min:1600},
  {id:'diamante',name:'Diamante',icon:'💎',min:3000},
  {id:'geografo',name:'Geógrafo',icon:'🌍',min:5000}
];
function rankForXP(value=state.xp){
  const xp=Math.max(0,Number(value)||0);
  let index=0;
  for(let i=1;i<RANKS.length;i++){if(xp>=RANKS[i].min)index=i;else break}
  const current=RANKS[index],next=RANKS[index+1]||null;
  const progress=next?Math.max(0,Math.min(100,((xp-current.min)/(next.min-current.min))*100)):100;
  return {current,next,progress,remaining:next?Math.max(0,next.min-xp):0};
}
function award(n){
  const previous=rankForXP().current.id;
  state.xp+=n;
  if(state.xp>=50&&!state.badges.includes('50'))state.badges.push('50');
  if(state.xp>=200&&!state.badges.includes('200'))state.badges.push('200');
  const current=rankForXP().current;
  if(current.id!==previous)notify(`Novo ranking desbloqueado: ${current.name}! ${current.icon}`);
}
function isUnlocked(l,i,c=active()){return i===0||!!state.completed[lessons(c)[i-1]?.id]}
function nextLesson(c=active()){return lessons(c).find((l,i)=>!state.completed[l.id]&&isUnlocked(l,i,c))}
function updateHeader(){const c=active(),rank=rankForXP();const week=$('#weekDays');if(week)week.innerHTML=weekDaysMarkup();$('#activeEmoji').textContent=c.emoji;$('#activeName').textContent=c.name;$('#activeMeta').textContent=`${doneCount(c)} de ${lessons(c).length} etapas concluídas` ;$('#xp').textContent=state.xp;$('#streak').textContent=currentStreak();const rankPill=$('#rankPill');if(rankPill){$('#rankIcon').textContent=rank.current.icon;$('#rankName').textContent=rank.current.name;rankPill.dataset.rank=rank.current.id;rankPill.title=rank.next?`${rank.current.name} · faltam ${rank.remaining} XP para ${rank.next.name}`:`${rank.current.name} · ranking máximo`;}$('#switcher').setAttribute('aria-expanded',String(!$('#contentMenu').classList.contains('hidden')));$('#contentMenu').innerHTML=`<div class="eyebrow" style="padding:9px 11px 3px">ESCOLHA SUA JORNADA</div>`+DATA.map(x=>`<button class="content-option ${x.id===state.active?'selected':''}" data-content="${x.id}"><span class="option-emoji">${x.emoji}</span><span><strong>${esc(x.name)}</strong><small>${doneCount(x)} de ${x.lessons.length} etapas concluídas</small></span>${x.id===state.active?'<span class="option-check">✓</span>':''}</button>`).join('')}
function nav(){ $$('.nav-item,.mobile-nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); }
function go(v){session=null;document.body.classList.remove('lesson-active','exam-active');if(v==='questoes'&&(examView==='enem'||examView==='random'))document.body.classList.add('exam-active');view=v;const renderer=VIEWS[v]||VIEWS.jornada;$('#content').innerHTML=renderer();nav();updateHeader();bind();$('#content').focus({preventScroll:true});window.scrollTo({top:0,behavior:'smooth'});if(v==='atlas')loadAtlas();if(v==='ao-vivo')initLiveMap()}
function moduleFor(c,index){
  const l=lessons(c)[index];
  if(!l)return null;
  if(c.id==='geopolitica')return {number:l.module||1,title:l.moduleTitle||`Módulo ${l.module||1}`};
  if(c.id==='cartografia'){
    const number=index<5?1:2;
    return {number,title:number===1?'Fundamentos da Cartografia':'Representação e análise espacial'};
  }
  if(c.id==='climatologia'){
    const number=index<3?1:2;
    return {number,title:number===1?'Fundamentos da atmosfera':'Circulação e dinâmica climática'};
  }
  return {number:1,title:'Jornada de aprendizagem'};
}
function moduleGroups(c){
  const items=lessons(c),groups=new Map();
  items.forEach((l,index)=>{
    const meta=moduleFor(c,index);
    if(!groups.has(meta.number))groups.set(meta.number,{...meta,items:[]});
    groups.get(meta.number).items.push({lesson:l,index});
  });
  return [...groups.values()].sort((a,b)=>a.number-b.number);
}
function pathHTML(c){
  const items=lessons(c);
  const renderNode=(l,globalIndex,moduleMeta)=>{
    const done=!!state.completed[l.id],can=isUnlocked(l,globalIndex,c),locked=!done&&!can,special=['checkpoint','challenge'].includes(l.type);
    const detail=c.id==='geopolitica'?`Exercício ${l.exercise}/9${l.mapLesson?' · mapa':''}`:`${l.minutes||3} min · ${special?(l.type==='checkpoint'?'checkpoint':'desafio de domínio'):'lição curta'}`;
    return `<div class="node ${done?'done':''} ${locked?'locked':''} ${special?'checkpoint':''} ${l.mapLesson?'map-node':''} ${l.mapLesson?'map-node':''}">
      <button class="node-btn" data-lesson="${l.id}" ${locked?'disabled':''}>
        <span class="orb">${done?'✓':locked?'':l.icon||'•'}</span>
        <span class="node-info"><strong>${esc(l.title)}</strong><small>${done?'Concluída':locked?'Conclua a etapa anterior':`${moduleMeta} · ${detail}`}</small></span>
      </button>
      ${done?'<span class="node-badge">✓ FEITO</span>':can?'<span class="node-badge">COMECE AQUI</span>':''}
    </div>`;
  };
  const groups=moduleGroups(c);
  return groups.map(group=>{
    const moduleItems=group.items;
    const step=164,center=90;
    const connectors=moduleItems.slice(0,-1).map((_,i)=>{
      const from=i%2===0?25:75,to=i%2===0?75:25;
      const y1=center+i*step,y2=center+(i+1)*step;
      return `<path d="M ${from} ${y1} C ${from} ${y1+48}, ${to} ${y2-48}, ${to} ${y2}"/>`;
    }).join('');
    const isGeo=c.id==='geopolitica';
    return `<section class="module-section" data-module-section="${group.number}" data-module="${group.number}">
      <header class="module-heading">
        <span class="module-kicker">MÓDULO ${String(group.number).padStart(2,'0')} / ${groups.length}</span>
        <h2>Módulo ${group.number}</h2>
        <h3>${esc(group.title)}</h3>
      </header>
      <div class="module-path" data-module-path="${group.number}">${moduleItems.map(({lesson,index})=>renderNode(lesson,index,`Módulo ${group.number}`)).join('')}<svg class="path-connectors" viewBox="0 0 100 ${moduleItems.length*step+20}" preserveAspectRatio="none" aria-hidden="true">${connectors}</svg></div>
      <div class="module-end"><span>✦</span><strong>FIM DO MÓDULO ${group.number}</strong><span class="module-end-line"></span></div>
    </section>`;
  }).join('');
}
function journey(){const c=active(),n=lessons(c),done=doneCount(c),pct=Math.round(done/n.length*100),next=nextLesson(c),streak=currentStreak();return `<div class="welcome"><div><h1>${esc(c.name)}</h1><p class="subhead">Estude por etapas e acompanhe seu progresso.</p></div><button class="primary" data-continue ${next?'':'disabled'}>${next?'▶ Continuar jornada':'✓ Jornada concluída'}</button></div><div class="journey"><section><div class="unit-banner"><div class="unit-symbol">${c.icon||c.emoji}</div><div><h2>${esc(c.unit)}</h2><p>${esc(c.description)}</p></div><div class="unit-progress"><strong>${pct}%</strong><span>da jornada</span></div></div><div class="path">${pathHTML(c)}</div></section><aside class="side-col"><div class="side-card streak-card"><h3 class="streak-title"><img class="streak-flame" src="./streak-flame.gif" alt=""> Ofensiva</h3><div class="streak-big">${streak.toLocaleString('pt-BR')}</div><div class="week" id="weekDays">${weekDaysMarkup()}</div></div><div class="side-card"><h3>Seu progresso</h3><div class="ring-row"><div class="ring" style="--pct:${pct}%"><strong>${pct}%</strong></div><div><strong>${done} de ${n.length} lições</strong><div class="muted">${pct===100?'Jornada concluída':`${n.length-done} etapas restantes`}</div></div></div><div class="daily-bar" style="margin-top:15px"><span style="width:${pct}%"></span></div></div></aside></div>`}
function startLesson(id,quick=false,qs=null){const c=active(),l=quick?{id:'quick',title:'Desafio rápido',icon:'⚡',minutes:3,intro:'Cinco perguntas rápidas de diferentes conteúdos.',questions:qs}:lessons(c).find(x=>x.id===id);if(!l)return;const i=lessons(c).findIndex(x=>x.id===id);if(!quick&&!isUnlocked(l,i,c)){notify('Conclua a lição anterior para desbloquear esta.');return}session={lesson:l,index:0,correct:0,phase:quick?'question':'intro',answered:false,quick};renderSession()}
function lessonMapMarkup(q){
 if(!map.data)return '<div class="lesson-map-loading">Preparando o mapa-múndi…</div>';
 const groups=q.mapGroups||[],countryGroup=new Map();
 groups.forEach((g,i)=>(g.countries||[]).forEach(name=>countryGroup.set(name,i)));
 const marked=new Set(q.mapCountries||groups.flatMap(g=>g.countries||[]));
 const bounds=[-180,-85,180,85];
 const paths=(map.data.features||[]).filter(f=>f.geometry).map(f=>{
   const name=fName(f),groupIndex=countryGroup.get(name),isMarked=marked.has(name);
   const groupClass=Number.isInteger(groupIndex)?` map-group-${groupIndex%6}`:'';
   return `<path class="lesson-map-country ${isMarked?'marked':''}${groupClass}" tabindex="${q.type==='map-locate'?0:-1}" role="${q.type==='map-locate'?'button':'img'}" aria-label="${esc(name)}" ${q.type==='map-locate'?`data-lesson-map-country="${esc(name)}"`:''} d="${pathGeom(f.geometry,bounds)}"><title>${esc(name)}</title></path>`;
 }).join('');
 const legend=groups.length?`<div class="lesson-map-legend">${groups.map((g,i)=>`<span class="lesson-map-legend-item"><i class="map-legend-dot map-group-${i%6}"></i>${esc(g.label)}</span>`).join('')}</div>`:'';
 return `<div class="lesson-map-heading"><strong>${esc(q.mapTitle||'Mapa para análise')}</strong><small>${esc(q.mapCaption||'Observe a distribuição espacial antes de responder.')}</small></div><div class="lesson-map-frame"><svg class="lesson-map-svg" viewBox="0 0 900 520" role="${q.type==='map-locate'?'group':'img'}" aria-label="Mapa-múndi temático para exercício de geopolítica">${paths}</svg></div>${legend}<div class="lesson-map-caption">${q.type==='map-locate'?'Clique no país solicitado.':'Use os destaques e a legenda como evidências para interpretar a situação geopolítica.'}</div>`;
}
function ensureLessonMapData(){
 if(map.data)return Promise.resolve(map.data);
 if(map.lessonDataPromise)return map.lessonDataPromise;
 map.lessonDataPromise=fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson').then(r=>{if(!r.ok)throw Error('Falha ao carregar o mapa');return r.json()}).then(data=>{if(!data.features?.length)throw Error('Mapa sem territórios');map.data=data;map.data.features.forEach(f=>{f.__continent=continentOf(f)});map.featureCache={};map.boundsCache={};return data}).finally(()=>{map.lessonDataPromise=null});
 return map.lessonDataPromise;
}
function sessionHTML(){const s=session,l=s.lesson,qs=l.questions,total=qs.length;if(s.phase==='intro')return `<div class="page-head"><button class="secondary" data-exit>← Voltar à jornada</button><div class="eyebrow" style="margin-top:24px">${esc(active().name)} · ${active().id==='geopolitica'?`MÓDULO ${l.module} · EXERCÍCIO ${l.exercise}/9${l.mapLesson?' · EXERCÍCIO COM MAPA':''}`:l.type==='checkpoint'?'CHECKPOINT':l.type==='challenge'?'DESAFIO':'LIÇÃO CURTA'}</div><h1>${esc(l.title)}</h1><p class="subhead">${l.mapLesson?'Cinco questões para aplicar no mapa os conceitos dos dois exercícios anteriores.':'Uma explicação rápida, seguida de questões para testar seu entendimento.'}</p></div><div class="panel"><div style="font-size:42px;margin-bottom:12px">${l.icon||'📘'}</div><h2>${l.mapLesson?'Hora de aplicar no mapa':'Vamos entender'}</h2><p>${l.intro}</p><span class="tag">⏱ ${l.minutes||3} minutos${l.mapLesson||active().id==='geopolitica'?' · 5 questões':''}</span></div><button class="primary" data-begin>Começar lição →</button>`;if(s.phase==='question'){const q=qs[s.index],mapQuestion=!!q.type?.startsWith('map-');return `<div class="lesson-top"><button class="secondary" data-exit>✕ Sair</button><span class="tag">${s.index+1} de ${total}</span><span class="tag">✦ +10 XP por acerto</span></div><div class="lesson-progress"><span style="width:${s.index/total*100}%"></span></div><div class="panel lesson-question-panel"><div class="eyebrow">${esc(q.topic||active().name)}${mapQuestion?' · MAPA':''}</div><h2>${esc(q.p)}</h2>${mapQuestion?`<div id="lesson-map-host">${lessonMapMarkup(q)}</div>`:''}${q.type==='map-locate'?'<p class="lesson-map-instruction">Selecione diretamente o território no mapa.</p>':`<div class="options">${q.op.map((o,i)=>`<button class="answer" data-answer="${i}"><span class="letter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></button>`).join('')}</div>`}<div id="feedback"></div></div>`} const passed=s.correct/total>=.6,already=!!state.completed[l.id],currentIndex=lessons().findIndex(x=>x.id===l.id),currentModule=moduleFor(active(),currentIndex),nextModuleItems=moduleGroups(active()).find(g=>g.number===currentModule?.number+1),moduleEnd=!!currentModule&&(!lessons()[currentIndex+1]||moduleFor(active(),currentIndex+1)?.number!==currentModule.number),moduleAdvance=moduleEnd&&!!nextModuleItems;return `<div class="empty"><div class="empty-icon">${passed?'🎉':'💪'}</div><div class="eyebrow">${moduleEnd&&passed?`MÓDULO ${currentModule.number} CONCLUÍDO`:'LIÇÃO FINALIZADA'}</div><h1>${passed?(moduleAdvance?`Módulo ${currentModule.number} concluído!`:'Mandou muito bem!'):'Você está aprendendo.'}</h1><p>Você acertou <strong>${s.correct} de ${total}</strong> questões. ${passed?(moduleAdvance?`Você liberou o Módulo ${currentModule.number+1}.`:'Concluiu mais um passo da sua jornada!'):'Revise a explicação e tente novamente. Errar faz parte do processo.'}</p><div class="panel" style="max-width:420px;margin:0 auto 18px;text-align:left"><div class="daily-row"><strong>Precisão nesta lição</strong><strong>${Math.round(s.correct/total*100)}%</strong></div><div class="daily-bar"><span style="width:${s.correct/total*100}%"></span></div><p class="muted" style="margin:9px 0 0">${already?'Seu progresso já estava registrado.':passed?'A próxima etapa foi liberada.':'É preciso acertar ao menos 60% para concluir.'}</p></div><button class="primary" data-finish>${passed?(moduleAdvance?`Ir para módulo ${currentModule.number+1}`:'Continuar jornada'):'Voltar à jornada'}</button> ${!passed?'<button class="secondary" data-retry>Refazer lição</button>':''}</div>`}
function renderSession(){
 document.body.classList.add('lesson-active');$('#content').innerHTML=`<button class="lesson-brand" data-home>Vestibulando Geo</button>`+sessionHTML();bind();window.scrollTo({top:0,behavior:'smooth'});
 const q=session?.phase==='question'?session.lesson.questions[session.index]:null;
 if(q?.type?.startsWith('map-')&&!map.data){const current=session;ensureLessonMapData().then(()=>{if(session===current&&session.phase==='question')renderSession()}).catch(()=>{const host=$('#lesson-map-host');if(host)host.innerHTML='<div class="lesson-map-loading">Não foi possível carregar o mapa. Verifique a conexão e tente novamente.</div>'})}
}
function answer(i){if(!session||session.answered)return;session.answered=true;const q=session.lesson.questions[session.index],ok=i===q.r,topic=q.topic||active().name;state.stats[topic]??={correct:0,total:0};state.stats[topic].total++;if(ok){session.correct++;state.stats[topic].correct++;award(10)}else{let e=state.errors.find(x=>x.p===q.p);if(!e)state.errors.push(e={p:q.p,op:q.op,topic,content:active().name,count:0});e.selected=i;e.answer=q.r;e.explanation=q.e;e.due=Date.now()+86400000;e.count++}save();$$('.answer').forEach((b,n)=>{b.disabled=true;if(n===q.r)b.classList.add('correct');if(n===i&&!ok)b.classList.add('wrong')});$('#feedback').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><strong>${ok?'✓ Resposta certa!':'Ainda não — vamos aprender com isso.'}</strong><br>${ok?'Boa! Você conectou o conceito corretamente.':`Resposta correta: <strong>${esc(q.op[q.r])}</strong>.`} ${esc(q.e)}</div><button class="primary" data-next>${session.index===session.lesson.questions.length-1?'Ver resultado':'Continuar'} →</button>`;bind()}
function answerMapCountry(name){
 if(!session||session.answered)return;const q=session.lesson.questions[session.index];if(q?.type!=='map-locate')return;
 const correct=name===q.mapTarget;q.op=[q.mapTarget,name];q.r=0;
 const selected=$(`[data-lesson-map-country="${CSS.escape(name)}"]`),target=$(`[data-lesson-map-country="${CSS.escape(q.mapTarget)}"]`);
 if(correct){selected?.classList.add('correct');answer(0)}else{selected?.classList.add('missed');target?.classList.add('correct');answer(1)}
}
function nextQuestion(){if(session.index+1<session.lesson.questions.length){session.index++;session.answered=false;session.phase='question';renderSession();return}session.phase='result';const l=session.lesson,pass=session.correct/l.questions.length>=.6;if(!session.quick&&pass&&!state.completed[l.id]){state.completed[l.id]=true;studyDay();award(20);notify('Lição concluída! +20 XP')}save();renderSession()}
const BIOMES=[{id:'amazonia',name:'Amazônia',color:'#55b978',d:'Floresta tropical úmida, grande biodiversidade e rios extensos.'},{id:'cerrado',name:'Cerrado',color:'#e5bc63',d:'Savana tropical com estação seca marcada e muitas espécies endêmicas.'},{id:'caatinga',name:'Caatinga',color:'#d69b5c',d:'Vegetação adaptada à irregularidade das chuvas no semiárido.'},{id:'mata',name:'Mata Atlântica',color:'#329d8b',d:'Formações florestais biodiversas, hoje bastante fragmentadas.'},{id:'pantanal',name:'Pantanal',color:'#76b9d8',d:'Grande planície sazonalmente inundável.'},{id:'pampa',name:'Pampa',color:'#a9c96b',d:'Campos naturais predominantes no sul do Rio Grande do Sul.'}];
function biomeIdFromName(name){
 const n=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return ({'amazonia':'amazonia','caatinga':'caatinga','cerrado':'cerrado','mata atlantica':'mata','pampa':'pampa','pantanal':'pantanal'})[n]||null;
}
function biomeSVG(){
 const features=map.biomeData?.features||[];
 const bounds=[-74,-34,-34,6];
 const paths=features.map(f=>{
  const id=biomeIdFromName(f.properties?.bioma||f.properties?.Bioma);
  if(!id)return '';
  const biome=BIOMES.find(b=>b.id===id);if(!biome)return '';
  const d=pathGeom(f.geometry,bounds);
  return `<path class="biome-region ${map.biomeFound.has(id)?'correct':''}" tabindex="0" role="button" aria-label="${esc(biome.name)}" data-biome="${id}" fill="${biome.color}" d="${d}"><title>${esc(biome.name)}</title></path>`;
 }).join('');
 return `<svg class="biome-map" viewBox="0 0 900 520" role="group" aria-label="Mapa interativo dos seis biomas brasileiros">${paths}</svg>`;
}
const CONTINENTS=[
{id:'southAmerica',name:'América do Sul',short:'América do Sul'},
{id:'northAmerica',name:'América do Norte',short:'América do Norte'},
{id:'europe',name:'Europa',short:'Europa'},
{id:'africa',name:'África',short:'África'},
{id:'asia',name:'Ásia',short:'Ásia'},
{id:'oceania',name:'Oceania',short:'Oceania'},
{id:'antarctica',name:'Antártida',short:'Antártida'}];
function atlas(){return `<div class="page-head"><div class="eyebrow">ATLAS</div><h1>Atlas interativo</h1><p class="subhead">Escolha um continente para praticar a localização dos países.</p></div><div class="map-toolbar"><button class="secondary" data-mapmode="countries">Países por continente</button><button class="secondary" data-mapmode="biomes">Biomas brasileiros</button></div><div class="panel"><div class="panel-header"><h2 id="mapTitle">Países</h2><span class="tag" id="mapProgress">Preparando mapa…</span></div><p class="muted" id="mapDescription">Toque ou clique no país solicitado.</p><div id="mapGame"><div class="empty"><p>Carregando mapa…</p></div></div></div>`}
function project(lon,lat,bounds){
 const [minLon,minLat,maxLon,maxLat]=bounds||[-180,-85,180,85];
 const width=840,height=470,pad=25,lonSpan=Math.max(.01,maxLon-minLon),latSpan=Math.max(.01,maxLat-minLat);
 const scale=Math.min((width-2*pad)/lonSpan,(height-2*pad)/latSpan);
 const drawW=lonSpan*scale,drawH=latSpan*scale,offX=(width-drawW)/2,offY=(height-drawH)/2;
 return [30+offX+(lon-minLon)*scale,25+offY+(maxLat-lat)*scale];
}
function rawFName(f){const p=f.properties||{};return p.ADMIN||p.name||p.NAME||p.name_long||p.formal_en||'País'}
const COUNTRY_PT={
'Afghanistan':'Afeganistão','Albania':'Albânia','Algeria':'Argélia','Andorra':'Andorra','Angola':'Angola','Antigua and Barbuda':'Antígua e Barbuda','Argentina':'Argentina','Armenia':'Armênia','Australia':'Austrália','Austria':'Áustria','Azerbaijan':'Azerbaijão','Bahamas':'Bahamas','Bahrain':'Bahrein','Bangladesh':'Bangladesh','Barbados':'Barbados','Belarus':'Belarus','Belgium':'Bélgica','Belize':'Belize','Benin':'Benim','Bhutan':'Butão','Bolivia':'Bolívia','Bosnia and Herzegovina':'Bósnia e Herzegovina','Botswana':'Botsuana','Brazil':'Brasil','Brunei':'Brunei','Bulgaria':'Bulgária','Burkina Faso':'Burquina Faso','Burundi':'Burundi','Cambodia':'Camboja','Cameroon':'Camarões','Canada':'Canadá','Cape Verde':'Cabo Verde','Central African Republic':'República Centro-Africana','Chad':'Chade','Chile':'Chile','China':'China','Colombia':'Colômbia','Comoros':'Comores','Costa Rica':'Costa Rica','Croatia':'Croácia','Cuba':'Cuba','Cyprus':'Chipre','Czechia':'Chéquia','Democratic Republic of the Congo':'República Democrática do Congo','Denmark':'Dinamarca','Djibouti':'Djibuti','Dominica':'Dominica','Dominican Republic':'República Dominicana','Ecuador':'Equador','Egypt':'Egito','El Salvador':'El Salvador','Equatorial Guinea':'Guiné Equatorial','Eritrea':'Eritreia','Estonia':'Estônia','Eswatini':'Essuatíni','Ethiopia':'Etiópia','Fiji':'Fiji','Finland':'Finlândia','France':'França','Gabon':'Gabão','Gambia':'Gâmbia','Georgia':'Geórgia','Germany':'Alemanha','Ghana':'Gana','Greece':'Grécia','Greenland':'Groenlândia','Grenada':'Granada','Guatemala':'Guatemala','Guinea':'Guiné','Guinea-Bissau':'Guiné-Bissau','Guyana':'Guiana','Haiti':'Haiti','Honduras':'Honduras','Hungary':'Hungria','Iceland':'Islândia','India':'Índia','Indonesia':'Indonésia','Iran':'Irã','Iraq':'Iraque','Ireland':'Irlanda','Israel':'Israel','Italy':'Itália','Jamaica':'Jamaica','Japan':'Japão','Jordan':'Jordânia','Kazakhstan':'Cazaquistão','Kenya':'Quênia','Kiribati':'Quiribati','Kuwait':'Kuwait','Kyrgyzstan':'Quirguistão','Laos':'Laos','Latvia':'Letônia','Lebanon':'Líbano','Lesotho':'Lesoto','Liberia':'Libéria','Libya':'Líbia','Liechtenstein':'Liechtenstein','Lithuania':'Lituânia','Luxembourg':'Luxemburgo','Madagascar':'Madagascar','Malawi':'Malaui','Malaysia':'Malásia','Maldives':'Maldivas','Mali':'Mali','Malta':'Malta','Marshall Islands':'Ilhas Marshall','Mauritania':'Mauritânia','Mauritius':'Maurício','Mexico':'México','Micronesia':'Micronésia','Moldova':'Moldávia','Monaco':'Mônaco','Mongolia':'Mongólia','Montenegro':'Montenegro','Morocco':'Marrocos','Mozambique':'Moçambique','Myanmar':'Mianmar','Namibia':'Namíbia','Nauru':'Nauru','Nepal':'Nepal','Netherlands':'Países Baixos','New Zealand':'Nova Zelândia','Nicaragua':'Nicarágua','Niger':'Níger','Nigeria':'Nigéria','North Korea':'Coreia do Norte','North Macedonia':'Macedônia do Norte','Norway':'Noruega','Oman':'Omã','Pakistan':'Paquistão','Palau':'Palau','Panama':'Panamá','Papua New Guinea':'Papua-Nova Guiné','Paraguay':'Paraguai','Peru':'Peru','Philippines':'Filipinas','Poland':'Polônia','Portugal':'Portugal','Qatar':'Catar','Republic of the Congo':'República do Congo','Romania':'Romênia','Russia':'Rússia','Rwanda':'Ruanda','Saint Kitts and Nevis':'São Cristóvão e Névis','Saint Lucia':'Santa Lúcia','Saint Vincent and the Grenadines':'São Vicente e Granadinas','Samoa':'Samoa','San Marino':'San Marino','Sao Tome and Principe':'São Tomé e Príncipe','Saudi Arabia':'Arábia Saudita','Senegal':'Senegal','Serbia':'Sérvia','Seychelles':'Seicheles','Sierra Leone':'Serra Leoa','Singapore':'Singapura','Slovakia':'Eslováquia','Slovenia':'Eslovênia','Solomon Islands':'Ilhas Salomão','Somalia':'Somália','South Africa':'África do Sul','South Korea':'Coreia do Sul','South Sudan':'Sudão do Sul','Spain':'Espanha','Sri Lanka':'Sri Lanka','Sudan':'Sudão','Suriname':'Suriname','Sweden':'Suécia','Switzerland':'Suíça','Syria':'Síria','Taiwan':'Taiwan','Tajikistan':'Tajiquistão','Tanzania':'Tanzânia','Thailand':'Tailândia','Timor-Leste':'Timor-Leste','Togo':'Togo','Tonga':'Tonga','Trinidad and Tobago':'Trinidad e Tobago','Tunisia':'Tunísia','Turkey':'Turquia','Turkmenistan':'Turcomenistão','Tuvalu':'Tuvalu','Uganda':'Uganda','Ukraine':'Ucrânia','United Arab Emirates':'Emirados Árabes Unidos','United Kingdom':'Reino Unido','United States of America':'Estados Unidos','United States':'Estados Unidos','Uruguay':'Uruguai','Uzbekistan':'Uzbequistão','Vanuatu':'Vanuatu','Vatican':'Vaticano','Venezuela':'Venezuela','Vietnam':'Vietnã','Yemen':'Iêmen','Zambia':'Zâmbia','Zimbabwe':'Zimbábue','Côte d’Ivoire':'Costa do Marfim','Ivory Coast':'Costa do Marfim','Dem. Rep. Congo':'República Democrática do Congo','Congo':'República do Congo','eSwatini':'Essuatíni','Kosovo':'Kosovo','Western Sahara':'Saara Ocidental','Antarctica':'Antártida','Bosnia and Herz.':'Bósnia e Herzegovina','Cabo Verde':'Cabo Verde','Central African Rep.':'República Centro-Africana',"Côte d'Ivoire":'Costa do Marfim','Dominican Rep.':'República Dominicana','Eq. Guinea':'Guiné Equatorial','Falkland Is.':'Ilhas Malvinas','Fr. S. Antarctic Lands':'Terras Austrais e Antárticas Francesas','Macedonia':'Macedônia do Norte','New Caledonia':'Nova Caledônia','Palestine':'Palestina','Puerto Rico':'Porto Rico','S. Sudan':'Sudão do Sul','Solomon Is.':'Ilhas Salomão','W. Sahara':'Saara Ocidental','eSwatini':'Essuatíni'
};
function fName(f){const raw=rawFName(f);return COUNTRY_PT[raw]||raw;}
function coordinatesOf(g){const out=[];function walk(v){if(!Array.isArray(v))return;if(typeof v[0]==='number'&&typeof v[1]==='number'){out.push(v);return}v.forEach(walk)}walk(g?.coordinates);return out}
function featureBounds(features){
 const preset={southAmerica:[-82,-57,-32,14],northAmerica:[-172,5,-50,84],europe:[-27,34,46,72],africa:[-20,-36,53,38],asia:[25,-12,180,82],oceania:[110,-50,180,5],antarctica:[-180,-90,180,-60]}[map.continent];
 let minLon=Infinity,minLat=Infinity,maxLon=-Infinity,maxLat=-Infinity;
 for(const f of features)for(const [x,y] of coordinatesOf(f.geometry)){if(preset&&(x<preset[0]||y<preset[1]||x>preset[2]||y>preset[3]))continue;minLon=Math.min(minLon,x);minLat=Math.min(minLat,y);maxLon=Math.max(maxLon,x);maxLat=Math.max(maxLat,y)}
 return Number.isFinite(minLon)?[minLon,minLat,maxLon,maxLat]:(preset||[-180,-85,180,85]);
}
function continentOf(f){
 const p=f.properties||{},n=rawFName(f),raw=String(p.CONTINENT||p.continent||'').toLowerCase();
 const known={'south america':'southAmerica','north america':'northAmerica','europe':'europe','africa':'africa','asia':'asia','oceania':'oceania','antarctica':'antarctica'};
 if(known[raw])return known[raw];
 const pts=coordinatesOf(f.geometry);if(!pts.length)return 'asia';
 const lon=pts.reduce((a,v)=>a+v[0],0)/pts.length,lat=pts.reduce((a,v)=>a+v[1],0)/pts.length;
 const overrides={"Russia": "asia", "Turkey": "asia", "Cyprus": "asia", "Georgia": "asia", "Armenia": "asia", "Azerbaijan": "asia", "Kazakhstan": "asia", "Egypt": "africa", "Indonesia": "asia", "Timor-Leste": "asia", "Papua": "oceania", "Papua New Guinea": "oceania", "Australia": "oceania", "New Zealand": "oceania", "Iceland": "europe", "Greenland": "northAmerica", "Denmark": "europe", "France": "europe", "Spain": "europe", "Portugal": "europe", "United Kingdom": "europe", "Norway": "europe", "Sweden": "europe", "Finland": "europe", "Poland": "europe", "Ukraine": "europe", "Greece": "europe", "Italy": "europe", "Germany": "europe", "Netherlands": "europe", "Belgium": "europe", "Switzerland": "europe", "Austria": "europe", "Czechia": "europe", "Slovakia": "europe", "Hungary": "europe", "Romania": "europe", "Bulgaria": "europe", "Serbia": "europe", "Croatia": "europe", "Bosnia and Herzegovina": "europe", "Albania": "europe", "Montenegro": "europe", "Kosovo": "europe", "Slovenia": "europe", "North Macedonia": "europe", "Belarus": "europe", "Moldova": "europe", "Lithuania": "europe", "Latvia": "europe", "Estonia": "europe", "Ireland": "europe", "Morocco": "africa", "Algeria": "africa", "Tunisia": "africa", "Libya": "africa", "Sudan": "africa", "South Sudan": "africa", "Western Sahara": "africa", "Mexico": "northAmerica", "Guatemala": "northAmerica", "Belize": "northAmerica", "Honduras": "northAmerica", "El Salvador": "northAmerica", "Nicaragua": "northAmerica", "Costa Rica": "northAmerica", "Panama": "northAmerica", "Cuba": "northAmerica", "Jamaica": "northAmerica", "Haiti": "northAmerica", "Dominican Republic": "northAmerica", "Bahamas": "northAmerica", "Trinidad and Tobago": "northAmerica", "Colombia": "southAmerica", "Venezuela": "southAmerica", "Guyana": "southAmerica", "Suriname": "southAmerica", "French Guiana": "southAmerica", "Ecuador": "southAmerica", "Peru": "southAmerica", "Bolivia": "southAmerica", "Paraguay": "southAmerica", "Chile": "southAmerica", "Argentina": "southAmerica", "Uruguay": "southAmerica", "Brazil": "southAmerica"};
 if(overrides[n])return overrides[n];
 if(lat < -60)return 'antarctica';
 if(lon < -30 && lat < 15)return 'southAmerica';
 if(lon < -30)return 'northAmerica';
 if(lon > 110 && lat < 0)return 'oceania';
 if(lon > 110 && lat > -10 && lat < 30)return 'asia';
 if(lon > -20 && lon < 52 && lat > -35 && lat < 38)return 'africa';
 if(lon > -12 && lon < 45 && lat >= 35 && lat < 72)return 'europe';
 if(lon >= 45 || lat >= 35)return 'asia';
 return 'africa';
}
function pathGeom(g,bounds){const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];return polys.map(poly=>poly.map(r=>r.map((pt,i)=>{const [x,y]=project(pt[0],pt[1],bounds);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`}).join(' ')+' Z').join(' ')).join(' ')}
async function loadAtlas(){
 if(view!=='atlas')return;
 if(map.mode==='biomes'){
  if(map.biomeData){renderBiomes();return}
  $('#mapGame').innerHTML='<div class="empty"><p>Carregando os limites dos biomas…</p></div>';
  try{
   const url='https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/biomas_ibge_250k_2019/MapServer/2/query?where=1%3D1&outFields=bioma&returnGeometry=true&outSR=4326&f=geojson';
   const r=await fetch(url);if(!r.ok)throw Error('Falha ao buscar os dados');
   const data=await r.json();if(!data.features?.length)throw Error('Mapa sem feições');
   map.biomeData=data;if(!map.biomeOrder)resetBiomes();renderBiomes();
  }catch(e){$('#mapGame').innerHTML='<div class="empty"><h3>Não foi possível carregar o mapa dos biomas</h3><p>Verifique a conexão e tente novamente.</p><button class="primary" data-mapretry>Tentar novamente</button></div>';bind()}
  return;
 }
 if(map.data){renderCountries();return}
 try{const r=await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');if(!r.ok)throw Error();map.data=await r.json();map.data.features.forEach(f=>{f.__continent=continentOf(f)});map.featureCache={};map.boundsCache={};resetCountries();renderCountries()}
 catch{$('#mapGame').innerHTML='<div class="empty"><h3>Não foi possível carregar o mapa</h3><p>Verifique a conexão e tente novamente.</p><button class="primary" data-mapretry>Tentar novamente</button></div>';bind()}
}
function ringAreaKm2(ring){const R=6371;let sum=0;for(let i=0;i<ring.length-1;i++){const [lon1,lat1]=ring[i],[lon2,lat2]=ring[i+1];sum+=(lon2-lon1)*Math.PI/180*(2+Math.sin(lat1*Math.PI/180)+Math.sin(lat2*Math.PI/180));}return Math.abs(sum)*R*R/2}
function geometryAreaKm2(g){if(!g)return 0;const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];let total=0;for(const poly of polygons){if(!poly.length)continue;total+=ringAreaKm2(poly[0]);for(let i=1;i<poly.length;i++)total-=ringAreaKm2(poly[i]);}return Math.max(0,total)}
const MIN_COUNTRY_AREA_KM2=25000; // aproximadamente o porte territorial da Albânia
function continentFeatures(){if(!map.featureCache[map.continent])map.featureCache[map.continent]=(map.data?.features||[]).filter(f=>f.__continent===map.continent&&geometryAreaKm2(f.geometry)>=MIN_COUNTRY_AREA_KM2);return map.featureCache[map.continent]}
function resetCountries(){const features=continentFeatures();map.targets=features.slice().sort(()=>Math.random()-.5);map.index=0;map.target=map.targets[0]||null;map.found=new Set();map.misses=0;map.finished=false}
function renderCountries(){if(!$('#mapGame')||!map.data)return;const continent=CONTINENTS.find(c=>c.id===map.continent)||CONTINENTS[0],features=continentFeatures(),bounds=map.boundsCache[map.continent]||(map.boundsCache[map.continent]=featureBounds(features));if(!map.targets||!map.targets.length)resetCountries();$('#mapTitle').textContent=continent.name;$('#mapDescription').textContent='Toque no mapa ou use a lista de países abaixo. Cada país tem uma área de toque acessível.';const done=map.finished;$('#mapProgress').textContent=done?`${map.found.size}/${map.targets.length} encontrados`:`${Math.min(map.index+1,map.targets.length)} de ${map.targets.length}`;
 const paths=features.map(f=>{const n=fName(f);return `<path class="map-country ${map.found.has(n)?'correct':''}" tabindex="0" role="button" aria-label="${esc(n)}" data-country="${esc(n)}" d="${pathGeom(f.geometry,bounds)}"><title>${esc(n)}</title></path>`}).join('');
 const options=CONTINENTS.map(c=>`<button class="continent-chip ${c.id===map.continent?'selected':''}" data-continent="${c.id}" ${c.id===map.continent?'aria-pressed="true"':'aria-pressed="false"'}>${c.name}</button>`).join('');
 const countryList=features.map(f=>{const n=fName(f);return `<button class="country-pick ${map.found.has(n)?'found':''}" data-country="${esc(n)}" ${map.found.has(n)?'disabled':''}>${esc(n)}</button>`}).join('');
 $('#mapGame').innerHTML=`<div class="continent-picker" aria-label="Selecionar continente">${options}</div>${done?'<div class="feedback good"><strong>Continente concluído.</strong> Você localizou todos os países deste mapa.</div>':`<div class="map-prompt"><span class="eyebrow">ENCONTRE NO MAPA</span><h2>${esc(fName(map.target||features[0]||{}))}</h2><p class="muted">${map.index+1} de ${map.targets.length} países</p></div>`}<div class="map-frame continent-map-frame"><svg class="world-map continent-map" viewBox="0 0 900 520" role="group" aria-label="Mapa interativo de ${continent.name}">${paths}</svg></div><div class="atlas-zoom-tools" aria-label="Controles de zoom do mapa"><button type="button" data-atlas-zoom="out" aria-label="Diminuir zoom">−</button><button type="button" data-atlas-zoom="reset" aria-label="Restaurar mapa">⟲</button><button type="button" data-atlas-zoom="in" aria-label="Aumentar zoom">+</button><span>Use os botões ou a roda do mouse para aproximar. Arraste o fundo para mover.</span></div><div class="map-toolbar"><button class="primary" data-mapreset>Reiniciar continente</button><span class="tag">${map.found.size} encontrados</span><span class="tag">${map.misses} erros</span></div><details class="country-list"><summary>Lista de países (${features.length})</summary><div class="country-pick-grid">${countryList}</div></details>`;bind();setupAtlasZoom()}
let atlasZoom={x:0,y:0,w:900,h:520},atlasDrag=null;
function applyAtlasZoom(){const svg=$('.continent-map');if(!svg)return;svg.setAttribute('viewBox',`${atlasZoom.x} ${atlasZoom.y} ${atlasZoom.w} ${atlasZoom.h}`)}
function changeAtlasZoom(factor,cx=450,cy=260){const minW=150,maxW=900,w=Math.max(minW,Math.min(maxW,atlasZoom.w*factor)),h=w*520/900,rx=cx/900,ry=cy/520;atlasZoom.x=Math.max(0,Math.min(900-w,atlasZoom.x+(atlasZoom.w-w)*rx));atlasZoom.y=Math.max(0,Math.min(520-h,atlasZoom.y+(atlasZoom.h-h)*ry));atlasZoom.w=w;atlasZoom.h=h;applyAtlasZoom()}
function setupAtlasZoom(){
 const frame=$('.continent-map-frame'),svg=$('.continent-map');if(!frame||!svg)return;
 atlasZoom={x:0,y:0,w:900,h:520};atlasDrag=null;applyAtlasZoom();
 $$('[data-atlas-zoom]').forEach(btn=>btn.addEventListener('click',()=>{const action=btn.dataset.atlasZoom;if(action==='reset'){atlasZoom={x:0,y:0,w:900,h:520};applyAtlasZoom()}else changeAtlasZoom(action==='in'?.62:1.45)}));
 frame.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect(),cx=(e.clientX-r.left)/r.width*900,cy=(e.clientY-r.top)/r.height*520;changeAtlasZoom(e.deltaY>0?1.28:.72,cx,cy)},{passive:false});
 frame.addEventListener('dblclick',e=>{if(e.target.closest('[data-country]'))return;const r=svg.getBoundingClientRect(),cx=(e.clientX-r.left)/r.width*900,cy=(e.clientY-r.top)/r.height*520;changeAtlasZoom(.62,cx,cy)});
 frame.addEventListener('pointerdown',e=>{if(e.target.closest('[data-country]'))return;atlasDrag={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...atlasZoom}};try{frame.setPointerCapture(e.pointerId)}catch(_){}});
 frame.addEventListener('pointermove',e=>{if(!atlasDrag||atlasDrag.id!==e.pointerId)return;const r=svg.getBoundingClientRect(),dx=(e.clientX-atlasDrag.x)/r.width*atlasZoom.w,dy=(e.clientY-atlasDrag.y)/r.height*atlasZoom.h;atlasZoom.x=Math.max(0,Math.min(900-atlasZoom.w,atlasDrag.view.x-dx));atlasZoom.y=Math.max(0,Math.min(520-atlasZoom.h,atlasDrag.view.y-dy));applyAtlasZoom()});
 const stop=e=>{if(atlasDrag&&atlasDrag.id===e.pointerId)atlasDrag=null};frame.addEventListener('pointerup',stop);frame.addEventListener('pointercancel',stop);
}
function clickCountry(name){if(map.finished||!map.target)return;const expected=fName(map.target);if(name===expected){map.found.add(name);map.index++;if(map.index>=map.targets.length){map.finished=true;map.target=null;award(map.found.size*2);save();notify(`Continente concluído. +${map.found.size*2} XP`)}else map.target=map.targets[map.index];renderCountries()}else{map.misses++;notify(`Você selecionou ${name}. Procure ${expected}.`);const p=$(`[data-country="${CSS.escape(name)}"]`);if(p){p.classList.add('missed');setTimeout(()=>p.classList.remove('missed'),650)}$('#mapProgress').textContent=`${map.index+1} de ${map.targets.length} · ${map.misses} erros`}}
function resetBiomes(){map.biomeOrder=BIOMES.map(b=>b.id).sort(()=>Math.random()-.5);map.biomeIndex=0;map.biomeFound=new Set();map.biomeMisses=0}
function renderBiomes(){
 if(!$('#mapGame'))return;
 if(!map.biomeOrder)resetBiomes();
 $('#mapTitle').textContent='Biomas brasileiros';
 $('#mapDescription').textContent='O nome do bioma aparece acima. Localize e selecione a área correspondente no mapa.';
 const done=map.biomeIndex>=6,b=BIOMES.find(x=>x.id===map.biomeOrder[map.biomeIndex]);
 $('#mapProgress').textContent=done?'6/6 encontrados':`${map.biomeIndex+1} de 6`;
 $('#mapGame').innerHTML=`${done?'<div class="feedback good"><strong>Você terminou o desafio dos biomas!</strong> +30 XP</div>':`<div class="map-prompt"><span class="eyebrow">ENCONTRE NO MAPA</span><h2>${esc(b.name)}</h2><p class="muted">${map.biomeIndex+1} de 6 biomas</p></div>`}<div class="map-frame continent-map-frame">${biomeSVG()}</div><div class="map-toolbar"><button class="primary" data-mapreset>↻ Reiniciar desafio</button><span class="tag">✓ ${map.biomeFound.size}/6 encontrados</span><span class="tag">↺ ${map.biomeMisses} erros</span></div><p class="muted biome-source">Limites cartográficos: IBGE (2019), disponibilizados em serviço geográfico do IBAMA.</p>`;
 bind();
}
function clickBiome(id){
 if(map.biomeIndex>=6)return;
 const expected=map.biomeOrder[map.biomeIndex],b=BIOMES.find(x=>x.id===id);
 if(id===expected){
  map.biomeFound.add(id);map.biomeIndex++;
  if(map.biomeIndex===6){award(30);save();notify('Biomas concluídos! +30 XP')}
  renderBiomes();
 }else{
  map.biomeMisses++;notify(`Essa área é ${b?.name||'outro bioma'}. Procure ${BIOMES.find(x=>x.id===expected).name}.`);
  const p=$(`[data-biome="${CSS.escape(id)}"]`);if(p){p.classList.add('missed');setTimeout(()=>p.classList.remove('missed'),650)}
  $('#mapProgress').textContent=`${map.biomeIndex+1} de 6 · ${map.biomeMisses} erros`;
 }
}
const ENEM_QUESTIONS = [
{year:2023,exam:'Regular',number:53,topic:'Tectônica de placas',p:'A Cordilheira do Himalaia continua se elevando. Qual processo explica essa formação?',op:['Afastamento de placas tectônicas','Choque entre placas tectônicas','Erosão causada pelo vento','Acúmulo de sedimentos fluviais','Ação exclusiva das geleiras'],r:1,e:'O Himalaia se formou pela convergência entre as placas Indiana e Eurasiática.',url:'https://nogabarito.com.br/questao/enem-2023-questao-53-a-cordilheira-do-himalaia-tem-mais-de-50-milhoes-de-anos-sendo'},
{year:2023,exam:'PPL',number:72,topic:'Climatologia',p:'A ocorrência de chuvas frequentes e temperaturas elevadas em Belém está relacionada principalmente à sua:',op:['Baixa latitude','Grande altitude','Forte continentalidade','Baixa insolação','Latitude polar'],r:0,e:'A proximidade da Linha do Equador favorece forte insolação e calor durante o ano.',url:'https://nogabarito.com.br/questao/enem-2023-ppl-questao-72-belem-e-cercada-por-rios-mas-e-a-agua-que-vem-la-de-cima-que-altera-o'},
{year:2023,exam:'PPL',number:74,topic:'Projeções cartográficas',p:'Para reduzir a distorção em uma área próxima à Linha do Equador, qual projeção faz mais sentido?',op:['Cilíndrica tangente ao Equador','Azimutal tangente ao polo','Cônica tangente a um paralelo médio','Cilíndrica tangente ao polo','Qualquer projeção sem escala'],r:0,e:'A linha de tangência é a região em que a escala principal sofre menor distorção.',url:'https://nogabarito.com.br/questao/enem-2023-ppl-questao-74-e-claramente-impossivel-criar-um-mapa-perfeito-no-qual-a-escala'},
{year:2022,exam:'Regular',number:78,topic:'Escala cartográfica',p:'Em um mapa, 2 cm representam aproximadamente 2 500 km na realidade. Qual é a escala numérica?',op:['1:125 000','1:1 250 000','1:12 500 000','1:125 000 000','1:250 000 000'],r:3,e:'2 500 km equivalem a 250 000 000 cm. Dividindo a distância real por 2 cm, a escala é 1:125 000 000.',url:'https://nogabarito.com.br/questao/enem-2022-questao-78-considerando-se-que-a-distancia-entre-o-local-onde-os-destrocos-do'},
{year:2022,exam:'PPL',number:90,topic:'Redes geográficas',p:'Qual representação cartográfica combina melhor com a ideia de uma sociedade organizada em redes?',op:['Nós conectados por linhas','Mapa apenas de altitudes','Mapa de fusos horários','Mapa de tipos de solo','Mapa dividido somente por estados'],r:0,e:'Redes geográficas são representadas por pontos conectados que indicam fluxos e relações.',url:'https://nogabarito.com.br/questao/enem-2022-ppl-questao-90-manuel-castells-a-rede-e-uma-realidade-generalizada-para-a-vida'},
{year:2022,exam:'Regular',number:46,topic:'Caatinga e saberes tradicionais',p:'O conhecimento tradicional sobre períodos de chuva e seca ajuda comunidades sertanejas a:',op:['Interpretar condições ambientais locais','Eliminar a irregularidade das chuvas','Transformar o semiárido em clima equatorial','Prever com certeza qualquer evento climático','Dispensar o conhecimento sobre o ambiente'],r:0,e:'Saberes tradicionais se desenvolvem na convivência com a paisagem e ajudam a interpretar sinais ambientais, embora não eliminem a incerteza climática.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2022/dia-1-questao-46'},
{year:2024,exam:'Regular',number:83,topic:'Cartografia e poder',p:'Historicamente, o uso de mapas por grupos dominantes pode servir à:',op:['Sustentação de hegemonias territoriais','Eliminação das fronteiras políticas','Neutralização de disputas territoriais','Distribuição igualitária automática de recursos','Extinção das relações de poder'],r:0,e:'A cartografia não é sempre neutra: mapas podem registrar e reforçar interesses de grupos que controlam territórios.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2024/dia-1-questao-83'},
{year:2024,exam:'PPL',number:58,topic:'Impactos socioambientais',p:'O rompimento de uma barragem de rejeitos que soterra um povoado provoca diretamente a:',op:['Destruição de lugares habitados','Expansão da mata ciliar','Concentração espontânea da população no local','Recuperação imediata do solo','Ampliação da produção mineral'],r:0,e:'Desastres com rejeitos podem destruir assentamentos, infraestrutura e modos de vida.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2024-ppl/dia-1-questao-58'},
{year:2024,exam:'PPL',number:62,topic:'Sustentabilidade',p:'Qual medida pode ajudar a ampliar a capacidade de suporte ambiental do planeta?',op:['Aumentar a produção de resíduos','Reduzir investimentos em agricultura orgânica','Enfraquecer a fiscalização ambiental','Intensificar investimentos em fontes renováveis','Expandir a exploração sem controle'],r:3,e:'O uso de fontes renováveis e a redução da pressão sobre recursos naturais contribuem para diminuir impactos ambientais.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2024-ppl/dia-1-questao-62'},
{year:2024,exam:'PPL',number:69,topic:'Caatinga e comunidades tradicionais',p:'O uso comunitário da terra por comunidades tradicionais da Caatinga pode favorecer:',op:['A conservação do bioma','A substituição de toda vegetação nativa','A urbanização industrial','A expansão de monoculturas em qualquer área','A eliminação dos conhecimentos tradicionais'],r:0,e:'Práticas tradicionais adaptadas ao ambiente podem contribuir para a conservação da Caatinga e dos modos de vida locais.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2024-ppl/dia-1-questao-69'},
{year:2024,exam:'PPL',number:78,topic:'Mudanças climáticas e geopolítica',p:'O aumento do uso de rotas marítimas no Ártico está relacionado principalmente ao:',op:['Aumento da temperatura global e recuo do gelo','Aumento permanente da cobertura de gelo','Fim das disputas por recursos naturais','Bloqueio de todas as rotas tradicionais','Resfriamento acelerado do oceano'],r:0,e:'O aquecimento do Ártico reduz a cobertura de gelo em certas épocas, facilitando a navegação e ampliando interesses econômicos e estratégicos.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2024-ppl/dia-1-questao-78'},
{year:2023,exam:'Regular',number:83,topic:'Degradação dos solos',p:'Qual consequência da degradação do solo pode dificultar sua recuperação?',op:['Redução da fertilidade','Aumento da biodiversidade do solo','Elevação contínua da matéria orgânica','Recomposição automática da vegetação','Aumento da capacidade produtiva'],r:0,e:'A perda de fertilidade e de matéria orgânica pode tornar a recuperação do solo mais lenta e difícil.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2023/dia-1-questao-83'},
{year:2023,exam:'Regular',number:89,topic:'Clima e ambiente',p:'Qual medida contribui para reduzir o aquecimento global?',op:['Ampliar o uso de carvão mineral','Aumentar o desmatamento','Reduzir emissões de gases de efeito estufa','Substituir florestas por pastagens','Expandir a queima de combustíveis fósseis'],r:2,e:'Reduzir emissões e conservar ecossistemas que armazenam carbono ajuda a limitar o aquecimento.',url:'https://nogabarito.com.br/questao/enem-2023-questao-89-qual-medida-e-capaz-de-minimizar-as-mudancas-apresentadas-nas'},
{year:2022,exam:'Regular',number:49,topic:'Urbanização e ciclo hidrológico',p:'O aumento de superfícies impermeáveis nas cidades altera imediatamente qual processo?',op:['Ciclo hidrológico','Tectônica de placas','Formação de rochas magmáticas','Movimento das placas continentais','Deriva dos continentes'],r:0,e:'Asfalto e concreto reduzem a infiltração e aumentam o escoamento superficial da água da chuva.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2022/dia-1-questao-49'},
{year:2022,exam:'Regular',number:64,topic:'Agentes internos e externos do relevo',p:'A interação entre o vulcanismo e o intemperismo pode favorecer a formação de:',op:['Solos vulcânicos férteis','Dorsais oceânicas habitáveis','Gelo permanente em áreas tropicais','Dunas exclusivamente marinhas','Fossas oceânicas em áreas continentais'],r:0,e:'O intemperismo de materiais vulcânicos pode originar solos ricos em minerais e favoráveis à agricultura.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2022/dia-1-questao-64'},
{year:2021,exam:'Regular',number:70,topic:'Saberes tradicionais e conservação',p:'O conhecimento indígena sobre germinação de sementes e uso do fogo pode contribuir para:',op:['A recuperação de ecossistemas','A expansão de monoculturas industriais','A eliminação da vegetação nativa','A interrupção dos ciclos naturais','A substituição da biodiversidade por uma única espécie'],r:0,e:'Saberes tradicionais podem apoiar a recuperação ambiental ao considerar os ciclos ecológicos e as características locais.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2021/dia-1-questao-70'},
{year:2021,exam:'Regular',number:71,topic:'Ciclo sedimentar',p:'A sequência de desgaste das rochas, transporte de sedimentos e deposição corresponde ao:',op:['Ciclo sedimentar','Tectonismo','Vulcanismo explosivo','Metamorfismo regional','Movimento de rotação'],r:0,e:'O ciclo sedimentar envolve alteração das rochas, transporte dos materiais e deposição, que pode originar rochas sedimentares.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2021/dia-1-questao-71'},
{year:2020,exam:'Regular',number:59,topic:'Estruturas geológicas brasileiras',p:'Os escudos cristalinos brasileiros são importantes economicamente por concentrarem:',op:['Minérios metálicos','Grandes reservas de petróleo','Carvão mineral em todas as áreas','Sal-gema exclusivamente','Gás natural em abundância uniforme'],r:0,e:'Escudos cristalinos antigos são importantes áreas de ocorrência de minérios metálicos, como ferro, manganês e ouro.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2020/dia-1-questao-59'},
{year:2019,exam:'Regular',number:57,topic:'Climatologia',p:'Uma interrupção na faixa de desertos subtropicais no Brasil é favorecida por qual condição?',op:['Atuação de massas de ar úmidas e circulação atmosférica','Latitude polar do território brasileiro','Ausência de ventos e massas de ar','Predomínio de clima mediterrâneo em todo o país','Altitude acima de 5 000 m em todo o território'],r:0,e:'A circulação atmosférica e a entrada de umidade ajudam a explicar por que o padrão mundial de desertos não se reproduz da mesma forma no Brasil.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2019/dia-1-questao-57'},
{year:2018,exam:'Regular',number:88,topic:'Silvicultura e extrativismo vegetal',p:'A expansão da silvicultura em relação ao extrativismo vegetal está associada ao maior uso de:',op:['Madeira de florestas plantadas','Madeira retirada apenas de florestas nativas','Combustíveis fósseis como matéria-prima florestal','Produtos sem origem vegetal','Recursos minerais no lugar da madeira'],r:0,e:'Silvicultura é o cultivo de florestas plantadas, que pode substituir parte da extração de madeira de vegetação nativa.',url:'https://www.memorizevestibular.com/blog/questoes/enem-2018/dia-1-questao-88'}
,
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A1',topic:'Urbanização e mobilidade',p:'Em uma metrópole, a expansão de bairros periféricos ocorre sem a ampliação proporcional do transporte coletivo. Uma consequência socioespacial provável é:',op:['Redução dos deslocamentos cotidianos','Aumento do tempo de deslocamento e da desigualdade de acesso','Desaparecimento da segregação residencial','Distribuição homogênea dos empregos','Diminuição automática da dependência do automóvel'],r:1,e:'Quando moradia e empregos ficam mais distantes e o transporte não acompanha a expansão urbana, aumentam os custos e o tempo de deslocamento, afetando de modo desigual os grupos sociais.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A2',topic:'Climatologia e cidade',p:'A substituição de áreas vegetadas por asfalto e concreto tende a intensificar as ilhas de calor urbanas porque:',op:['Aumenta a evapotranspiração','Eleva a absorção e a retenção de calor pelas superfícies construídas','Reduz a impermeabilização do solo','Amplia o sombreamento natural','Diminui a emissão de calor pelos edifícios'],r:1,e:'Materiais urbanos como concreto e asfalto absorvem e armazenam calor, enquanto a redução da vegetação diminui o resfriamento por sombra e evapotranspiração.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A3',topic:'Agricultura e território',p:'A concentração da propriedade da terra pode dificultar o acesso de pequenos produtores à produção agrícola principalmente porque:',op:['Elimina a necessidade de crédito rural','Restringe o acesso à terra e amplia barreiras de entrada na atividade','Impede qualquer uso de tecnologia','Reduz a demanda por alimentos','Distribui igualmente a infraestrutura rural'],r:1,e:'A concentração fundiária limita o acesso à terra e pode reforçar desigualdades de renda, crédito, infraestrutura e poder no campo.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A4',topic:'Hidrografia e uso do solo',p:'A retirada da vegetação ciliar ao longo de um rio pode contribuir para:',op:['Redução do transporte de sedimentos','Aumento da erosão das margens e do assoreamento','Estabilização natural das margens','Eliminação do escoamento superficial','Aumento permanente da qualidade da água'],r:1,e:'A vegetação ciliar protege as margens, retém sedimentos e contribui para a qualidade da água. Sua remoção favorece erosão e assoreamento.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A5',topic:'Globalização e produção',p:'Uma empresa projeta seus produtos em um país, fabrica componentes em outros e realiza a montagem em um terceiro. Essa organização evidencia:',op:['O fim da divisão internacional do trabalho','A fragmentação territorial das etapas produtivas','A autossuficiência de cada economia','A redução das redes de transporte','O desaparecimento das empresas transnacionais'],r:1,e:'As cadeias globais de valor distribuem etapas da produção entre diferentes territórios, conectados por fluxos de mercadorias, capitais e informações.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A6',topic:'Energia e transição energética',p:'A expansão de fontes renováveis na matriz elétrica não elimina, por si só, os desafios socioambientais porque:',op:['Toda fonte renovável utiliza combustíveis fósseis diretamente','A implantação de infraestrutura também envolve impactos territoriais e necessidade de planejamento','Fontes renováveis não dependem de redes de transmissão','A geração renovável é sempre constante em qualquer condição','A transição energética dispensa políticas públicas'],r:1,e:'Usinas, linhas de transmissão e cadeias de materiais podem gerar impactos e conflitos territoriais. A transição exige planejamento, participação social e avaliação ambiental.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A7',topic:'Demografia',p:'Quando a fecundidade diminui e a expectativa de vida aumenta, uma tendência demográfica de longo prazo é:',op:['Rejuvenescimento contínuo da população','Aumento da participação relativa de pessoas idosas','Elevação obrigatória da mortalidade infantil','Fim das migrações internas','Manutenção permanente da mesma estrutura etária'],r:1,e:'A queda da fecundidade reduz a participação das faixas mais jovens, enquanto a maior longevidade amplia a proporção de idosos.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A8',topic:'Biomas e conservação',p:'A criação de corredores ecológicos entre fragmentos de vegetação nativa busca principalmente:',op:['Isolar populações de espécies','Facilitar o deslocamento de organismos e o fluxo genético','Substituir unidades de conservação por áreas agrícolas','Impedir a regeneração natural','Uniformizar todos os ecossistemas'],r:1,e:'Corredores ecológicos conectam habitats fragmentados e podem favorecer deslocamento, reprodução e fluxo genético entre populações.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A9',topic:'Geopolítica e recursos naturais',p:'A disputa pelo controle de reservas de água em regiões de escassez demonstra que esse recurso pode assumir importância geopolítica por:',op:['Não possuir valor econômico ou social','Influenciar a segurança hídrica, a produção e as relações entre territórios','Ser distribuído igualmente em todas as regiões','Não depender de condições climáticas','Eliminar a necessidade de acordos internacionais'],r:1,e:'A disponibilidade e o controle da água afetam abastecimento, agricultura, energia e relações políticas, podendo gerar cooperação ou tensão entre usuários e territórios.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A10',topic:'Cartografia e tecnologia',p:'Ao comparar imagens de satélite de diferentes anos, pesquisadores identificam a expansão de áreas urbanizadas sobre a vegetação. Esse procedimento é um exemplo de:',op:['Sensoriamento remoto aplicado à análise temporal da paisagem','Projeção cartográfica equivalente','Levantamento exclusivamente censitário','Nivelamento topográfico de campo','Regionalização baseada apenas em limites políticos'],r:0,e:'Imagens obtidas por sensores permitem observar e comparar mudanças na cobertura e no uso da terra ao longo do tempo.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A11',topic:'Clima e agricultura',p:'A irregularidade das chuvas em áreas semiáridas torna especialmente importante para a agricultura familiar:',op:['O planejamento hídrico e a escolha de práticas adaptadas às condições locais','A dependência exclusiva de culturas de alta demanda hídrica','A eliminação de técnicas de armazenamento de água','O abandono de previsões climáticas','A substituição de toda produção por monoculturas irrigadas'],r:0,e:'Captação e armazenamento de água, diversificação e técnicas adaptadas ajudam a reduzir a vulnerabilidade diante da variabilidade das chuvas.',url:'',source:'Questão autoral inspirada no formato do ENEM.'},
{year:2026,exam:'Treino autoral',institution:'ENEM — treino autoral',number:'A12',topic:'Indústria e desconcentração',p:'A instalação de unidades industriais em cidades médias pode ser estimulada pela busca empresarial por:',op:['Maior proximidade obrigatória de todas as capitais','Custos menores, incentivos e novas conexões logísticas','Ausência completa de mão de obra','Eliminação dos mercados consumidores regionais','Redução do acesso à infraestrutura'],r:1,e:'Custos de produção, incentivos públicos, disponibilidade de trabalhadores e infraestrutura podem influenciar a localização industrial.',url:'',source:'Questão autoral inspirada no formato do ENEM.'}
];
let examView='menu';

const RANDOM_QUESTIONS=[
{id:1,topic:'Cartografia',p:'Qual propriedade é preservada na projeção de Mercator?',op:['Áreas', 'Ângulos locais', 'Distâncias em qualquer direção', 'Formas de todos os continentes', 'Escalas em todos os paralelos'],r:1,e:'A projeção de Mercator é conforme: preserva ângulos locais, mas amplia áreas em altas latitudes.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:2,topic:'Cartografia',p:'Em uma escala 1:200 000, 1 cm no mapa corresponde a:',op:['200 m', '2 km', '20 km', '200 km', '20 m'],r:1,e:'Um centímetro representa 200 000 cm, ou 2 km.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:3,topic:'Cartografia',p:'Latitude é a distância angular medida a partir:',op:['Do Meridiano de Greenwich', 'Da Linha do Equador', 'Do Trópico de Capricórnio', 'Da Linha Internacional de Data', 'Do polo mais próximo'],r:1,e:'A latitude mede a posição ao norte ou ao sul do Equador.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:4,topic:'Cartografia',p:'As coordenadas 0° de latitude e 0° de longitude localizam-se:',op:['No encontro do Equador com Greenwich', 'No Polo Norte', 'No meridiano 180°', 'No Trópico de Câncer', 'No centro da Ásia'],r:0,e:'O ponto fica no Golfo da Guiné, no encontro do Equador com o meridiano de Greenwich.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:5,topic:'Cartografia',p:'O sensoriamento remoto obtém informações da superfície por meio de:',op:['Coleta manual de amostras apenas', 'Sensores em satélites ou aeronaves', 'Entrevistas domiciliares', 'Sondagens exclusivamente subterrâneas', 'Mapas desenhados sem medições'],r:1,e:'Sensores registram energia refletida ou emitida pelos objetos.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:6,topic:'Cartografia',p:'Uma anamorfose cartográfica representa territórios com áreas proporcionais:',op:['À altitude média', 'A uma variável estatística', 'À distância do Equador', 'À população rural apenas', 'À extensão das fronteiras'],r:1,e:'A área é distorcida para expressar quantitativamente uma variável.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:7,topic:'Climatologia',p:'A ZCIT está associada principalmente à:',op:['Convergência de ventos e ascensão de ar úmido', 'Descida de ar frio e seco', 'Formação de desertos polares', 'Circulação exclusiva de frentes frias', 'Ausência de nebulosidade'],r:0,e:'A convergência favorece a subida do ar quente e úmido e a formação de nuvens e chuvas.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:8,topic:'Climatologia',p:'No Hemisfério Sul, os ventos alísios sopram predominantemente de:',op:['Noroeste', 'Nordeste', 'Sudeste', 'Sudoeste', 'Oeste'],r:2,e:'O efeito de Coriolis desvia o fluxo para a esquerda no Hemisfério Sul, gerando alísios de sudeste.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:9,topic:'Climatologia',p:'A continentalidade tende a produzir:',op:['Menor amplitude térmica anual', 'Maior amplitude térmica', 'Chuvas constantes em qualquer estação', 'Temperaturas sempre baixas', 'Ausência de estações'],r:1,e:'O interior dos continentes sofre menor moderação térmica dos oceanos.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:10,topic:'Climatologia',p:'A inversão térmica dificulta a dispersão de poluentes porque:',op:['Aumenta a convecção vertical', 'Uma camada de ar quente fica sobre ar frio próximo ao solo', 'Elimina a umidade do ar', 'Intensifica os ventos alísios', 'Reduz a pressão atmosférica a zero'],r:1,e:'A estabilidade atmosférica limita a mistura vertical do ar.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:11,topic:'Climatologia',p:'O El Niño corresponde ao aquecimento anômalo das águas superficiais do:',op:['Atlântico Norte', 'Pacífico equatorial central e oriental', 'Índico Sul', 'Mar Mediterrâneo', 'Ártico'],r:1,e:'O fenômeno altera a circulação atmosférica e os padrões de chuva em várias regiões.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:12,topic:'Climatologia',p:'A altitude, como fator climático, geralmente provoca:',op:['Elevação da temperatura', 'Redução da temperatura', 'Aumento uniforme da pressão', 'Fim da umidade', 'Ausência de ventos'],r:1,e:'A temperatura tende a diminuir com a altitude na troposfera.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:13,topic:'Geomorfologia',p:'O intemperismo químico é mais intenso, em geral, em ambientes:',op:['Quentes e úmidos', 'Frios e secos', 'Polares', 'Sem água líquida', 'De clima permanentemente árido'],r:0,e:'Calor e água aceleram reações químicas que alteram os minerais.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:14,topic:'Geomorfologia',p:'A abrasão marinha atua principalmente por meio:',op:['Do impacto de ondas e sedimentos na costa', 'Da ação de geleiras continentais', 'Da dissolução de rochas pelo vento', 'Da movimentação de placas', 'Da deposição eólica no interior'],r:0,e:'Ondas e materiais transportados desgastam falésias e outras formas costeiras.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:15,topic:'Geomorfologia',p:'Dobramentos modernos estão frequentemente associados a:',op:['Bordas convergentes de placas', 'Centros de placas estáveis', 'Dorsais oceânicas apenas', 'Planícies aluviais', 'Áreas sem atividade tectônica'],r:0,e:'A compressão entre placas pode dobrar camadas rochosas e formar grandes cadeias.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:16,topic:'Geomorfologia',p:'A sedimentação ocorre quando há:',op:['Deposição de materiais transportados', 'Fusão do núcleo terrestre', 'Apenas fraturamento tectônico', 'Evaporação do magma', 'Desaparecimento da erosão'],r:0,e:'Sedimentos se depositam quando a energia do agente transportador diminui.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:17,topic:'Biomas',p:'O domínio do Cerrado apresenta vegetação adaptada frequentemente a:',op:['Solos ácidos, estação seca e fogo', 'Frio polar permanente', 'Alagamento costeiro diário', 'Neve durante todo o ano', 'Ausência de estação seca'],r:0,e:'Muitas espécies apresentam cascas espessas, raízes profundas e adaptações ao fogo.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:18,topic:'Biomas',p:'A Caatinga é caracterizada por vegetação:',op:['Higrófila e perene', 'Xerófila e adaptada à escassez de água', 'De coníferas temperadas', 'Exclusivamente rasteira de tundra', 'De manguezal'],r:1,e:'Plantas xerófitas apresentam adaptações à irregularidade das chuvas e à seca.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:19,topic:'Biomas',p:'Os manguezais desenvolvem-se principalmente:',op:['Em áreas de encontro entre água doce e salgada', 'Em altas montanhas', 'Em desertos continentais', 'Em campos de altitude frios', 'No interior de florestas de araucária'],r:0,e:'Manguezais ocupam estuários e áreas costeiras protegidas, sob influência das marés.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:20,topic:'Biomas',p:'A Mata Atlântica é considerada um hotspot por apresentar:',op:['Baixa biodiversidade e pouca ameaça', 'Elevada biodiversidade e forte perda de habitats', 'Predomínio de vegetação desértica', 'Ausência de espécies endêmicas', 'Cobertura original totalmente preservada'],r:1,e:'Hotspots combinam riqueza e endemismo com elevado grau de ameaça.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:21,topic:'Biomas',p:'O Pantanal tem sua dinâmica ecológica fortemente marcada por:',op:['Cheias sazonais', 'Geadas permanentes', 'Vulcanismo ativo', 'Ausência de rios', 'Seca absoluta o ano inteiro'],r:0,e:'O pulso anual de inundação organiza habitats e ciclos de vida.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:22,topic:'Biomas',p:'A Floresta Amazônica apresenta, em grande parte, vegetação:',op:['Densa, latifoliada e perenifólia', 'Caducifólia e adaptada ao frio', 'Herbácea de pradaria', 'Xerófila e espinhosa', 'De coníferas homogêneas'],r:0,e:'O clima quente e úmido favorece floresta densa e folhas largas.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:23,topic:'Hidrografia',p:'Uma bacia hidrográfica é definida como:',op:['Área drenada por um rio principal e seus afluentes', 'Conjunto de lagos sem ligação', 'Trecho de litoral entre dois cabos', 'Área limitada por curvas de nível térmico', 'Toda água subterrânea de um país'],r:0,e:'Os divisores de água delimitam a área de drenagem de uma rede fluvial.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:24,topic:'Hidrografia',p:'Aquíferos são formações geológicas capazes de:',op:['Armazenar e transmitir água subterrânea', 'Produzir água por fotossíntese', 'Impedir toda infiltração', 'Conduzir apenas petróleo', 'Eliminar a evaporação'],r:0,e:'Rochas e sedimentos porosos ou fraturados podem armazenar e transmitir água.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:25,topic:'Hidrografia',p:'A mata ciliar contribui para os rios ao:',op:['Aumentar o assoreamento', 'Reduzir erosão das margens e filtrar sedimentos', 'Impedir a infiltração', 'Elevar a salinidade', 'Eliminar a biodiversidade aquática'],r:1,e:'A vegetação protege margens, retém sedimentos e ajuda a manter a qualidade da água.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:26,topic:'Solos',p:'A laterização está relacionada à:',op:['Intensa lixiviação em ambientes quentes e úmidos', 'Congelamento permanente do solo', 'Acúmulo de sal em áreas polares', 'Ausência de intemperismo', 'Formação exclusiva de solos vulcânicos'],r:0,e:'A lavagem de bases e sílica pode concentrar óxidos de ferro e alumínio.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:27,topic:'Solos',p:'A erosão laminar caracteriza-se pela:',op:['Remoção relativamente uniforme de uma fina camada do solo', 'Formação exclusiva de grandes cavernas', 'Deposição de dunas', 'Fratura de placas tectônicas', 'Compactação causada por geleiras'],r:0,e:'O escoamento superficial remove partículas em uma camada pouco concentrada.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:28,topic:'Agrária',p:'A concentração fundiária indica:',op:['Distribuição igualitária da terra', 'Grande parcela das terras sob controle de poucos proprietários', 'Predomínio de pequenas propriedades familiares', 'Ausência de propriedade rural', 'Fim dos conflitos no campo'],r:1,e:'A concentração de terras expressa desigualdade na estrutura fundiária.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:29,topic:'Agrária',p:'A agricultura intensiva caracteriza-se, em geral, por:',op:['Elevado uso de capital e insumos por área', 'Baixa produtividade obrigatória', 'Ausência de tecnologia', 'Uso exclusivo de mão de obra sazonal', 'Produção sem finalidade comercial'],r:0,e:'A intensificação utiliza mais insumos, tecnologia e trabalho por unidade de área.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:30,topic:'Agrária',p:'A expansão da fronteira agrícola pode provocar:',op:['Desmatamento e conflitos pelo uso da terra', 'Redução automática das emissões', 'Recuperação imediata de todos os solos', 'Fim da disputa fundiária', 'Aumento da vegetação nativa em qualquer situação'],r:0,e:'A abertura de novas áreas pode pressionar ecossistemas e territórios tradicionais.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:31,topic:'Urbanização',p:'Conurbação é o processo em que:',op:['Manchas urbanas de municípios vizinhos se unem fisicamente', 'Uma cidade perde toda sua população', 'O campo substitui a indústria', 'Duas regiões climáticas se fundem', 'Uma metrópole deixa de ter periferia'],r:0,e:'A expansão urbana contínua ultrapassa limites municipais.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:32,topic:'Urbanização',p:'Gentrificação envolve frequentemente:',op:['Valorização de áreas e deslocamento de moradores de menor renda', 'Desindustrialização de áreas rurais', 'Redução dos preços de imóveis', 'Fim da especulação imobiliária', 'Expansão de terras agrícolas'],r:0,e:'A valorização imobiliária pode elevar custos e pressionar moradores antigos.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:33,topic:'Urbanização',p:'Segregação socioespacial refere-se à:',op:['Separação desigual de grupos sociais no espaço urbano', 'Distribuição uniforme de serviços', 'Ausência de diferenças de renda', 'Integração plena de todos os bairros', 'Redução das distâncias entre moradia e trabalho'],r:0,e:'Desigualdades de renda e acesso a serviços se materializam na organização da cidade.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:34,topic:'Demografia',p:'A taxa de fecundidade total representa:',op:['Número médio de filhos por mulher', 'Número de mortes por mil habitantes', 'Saldo migratório anual', 'Expectativa de vida ao nascer', 'Proporção de idosos na população'],r:0,e:'É uma estimativa do número médio de filhos por mulher ao longo da vida reprodutiva.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:35,topic:'Demografia',p:'O envelhecimento populacional está associado principalmente a:',op:['Queda da fecundidade e aumento da longevidade', 'Aumento contínuo da mortalidade infantil', 'Explosão da natalidade', 'Fim das migrações', 'Redução da expectativa de vida'],r:0,e:'Menos nascimentos e maior sobrevivência elevam a participação de idosos.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:36,topic:'Demografia',p:'Migração pendular é o deslocamento:',op:['Cotidiano entre residência e trabalho ou estudo', 'Definitivo entre países', 'Forçado por guerra entre continentes', 'Sazonal de rebanhos', 'De retorno após aposentadoria apenas'],r:0,e:'É um movimento frequente, geralmente diário, sem mudança permanente de residência.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:37,topic:'Globalização',p:'A divisão internacional do trabalho expressa:',op:['A distribuição desigual de etapas produtivas entre países', 'A igualdade tecnológica entre todos os países', 'O fim do comércio internacional', 'A ausência de especialização econômica', 'A autossuficiência de todas as economias'],r:0,e:'Países e regiões ocupam posições distintas nas cadeias globais de produção.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:38,topic:'Globalização',p:'Uma cadeia global de valor caracteriza-se por:',op:['Etapas produtivas distribuídas entre diferentes países', 'Produção integral em uma única aldeia', 'Ausência de circulação de mercadorias', 'Fim das empresas transnacionais', 'Comércio restrito ao mercado local'],r:0,e:'Projeto, componentes, montagem e serviços podem ocorrer em países diferentes.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:39,topic:'Indústria',p:'A desconcentração industrial pode ser estimulada por:',op:['Custos menores, incentivos fiscais e infraestrutura em outras regiões', 'Proibição de transportes', 'Fim das redes de energia', 'Redução de mercados consumidores em todos os lugares', 'Ausência de mão de obra'],r:0,e:'Empresas podem deslocar unidades em busca de custos, logística e incentivos.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:40,topic:'Indústria',p:'A indústria de base produz principalmente:',op:['Matérias-primas e insumos para outras indústrias', 'Bens de consumo final apenas', 'Serviços financeiros', 'Produtos agrícolas in natura', 'Software doméstico exclusivamente'],r:0,e:'Siderurgia, petroquímica e produção de cimento fornecem insumos a outros setores.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:41,topic:'Energia',p:'A matriz elétrica brasileira tem participação historicamente elevada de:',op:['Hidrelétricas', 'Carvão mineral', 'Energia nuclear', 'Xisto betuminoso', 'Turfa'],r:0,e:'A geração hidrelétrica tem papel importante, embora a matriz venha se diversificando.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:42,topic:'Energia',p:'A energia eólica depende diretamente da:',op:['Energia cinética dos ventos', 'Combustão de carvão', 'Fissão de urânio', 'Queima de biomassa em caldeiras', 'Energia das marés apenas'],r:0,e:'Aerogeradores convertem a energia do movimento do ar em eletricidade.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:43,topic:'Geopolítica',p:'Soberania estatal refere-se à:',op:['Autoridade política sobre um território e sua população', 'Ausência de fronteiras', 'Subordinação obrigatória a empresas', 'Eliminação das leis nacionais', 'Livre circulação sem regras'],r:0,e:'Soberania é o poder de organizar e governar o território, sujeito a limites e relações internacionais.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:44,topic:'Geopolítica',p:'Um bloco econômico busca, em diferentes níveis:',op:['Facilitar a integração comercial entre membros', 'Impedir qualquer circulação de mercadorias', 'Unificar obrigatoriamente todos os governos', 'Eliminar diferenças culturais', 'Substituir todos os Estados por municípios'],r:0,e:'Blocos podem reduzir barreiras e coordenar políticas econômicas.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:45,topic:'Geopolítica',p:'A multipolaridade descreve uma ordem internacional com:',op:['Vários centros relevantes de poder', 'Um único Estado dominante absoluto', 'Ausência de Estados', 'Poder exclusivamente militar', 'Fim das disputas econômicas'],r:0,e:'O poder e a influência estão distribuídos entre diferentes polos.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:46,topic:'Meio ambiente',p:'Desenvolvimento sustentável pressupõe:',op:['Atender necessidades atuais sem comprometer gerações futuras', 'Priorizar crescimento sem limites ecológicos', 'Impedir toda atividade econômica', 'Substituir políticas sociais por tecnologia', 'Usar recursos naturais sem planejamento'],r:0,e:'A ideia articula dimensões ambientais, sociais e econômicas no longo prazo.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:47,topic:'Meio ambiente',p:'A eutrofização de lagos é frequentemente causada pelo excesso de:',op:['Nutrientes como nitrogênio e fósforo', 'Oxigênio dissolvido', 'Areia quartzosa', 'Sal marinho', 'Gás hélio'],r:0,e:'O excesso de nutrientes estimula algas; sua decomposição pode reduzir o oxigênio da água.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:48,topic:'Meio ambiente',p:'A ilha de calor urbana resulta principalmente de:',op:['Materiais que retêm calor e pouca cobertura vegetal', 'Maior presença de florestas', 'Redução de superfícies impermeáveis', 'Ausência de construções', 'Aumento da evapotranspiração urbana'],r:0,e:'Asfalto, concreto, pouca vegetação e calor antropogênico elevam temperaturas urbanas.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'},
{id:49,topic:'Meio ambiente',p:'A desertificação é um processo de degradação de terras em:',op:['Áreas áridas, semiáridas e subúmidas secas', 'Florestas equatoriais sempre úmidas apenas', 'Regiões polares', 'Oceanos profundos', 'Áreas vulcânicas exclusivamente'],r:0,e:'O processo envolve perda de produtividade em terras secas por fatores climáticos e humanos.',source:'Filadd — Lista de Geografia: migrações, urbanização, biomas e geopolítica (2026)'},
{id:50,topic:'Transportes',p:'O transporte hidroviário é especialmente competitivo para:',op:['Grandes volumes e cargas pesadas em longas distâncias', 'Pequenas entregas porta a porta urgentes', 'Rotas sem rios ou canais', 'Transporte urbano individual', 'Cargas leves em áreas montanhosas sem cursos d’água'],r:0,e:'Em hidrovias adequadas, o custo por tonelada transportada tende a ser baixo.',source:'Memorize — Banco de questões de Geografia do ENEM (2009–2025)'}
];

function examQuestionId(type,q){
  return type==='enem'
    ? `enem-${q.year}-${q.exam}-${q.number}`
    : `mixed-${q.id}`;
}
function examPool(type){return type==='enem'?ENEM_QUESTIONS:RANDOM_QUESTIONS;}
function shuffleItems(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function createExamBatch(type){
  const pool=examPool(type);
  const eligible=pool.filter(q=>!state.examCorrect[examQuestionId(type,q)]);
  const chosen=shuffleItems(eligible).slice(0,5);
  state.examBatch[type]=chosen.map(q=>examQuestionId(type,q));
  state.examBatchAnswers[type]={};
  save();
}
function openExam(type){examView=type;createExamBatch(type);renderExam()}
function examMeta(type,q){
  if(type==='enem'){
    const isOfficial=q.exam==='Regular'||q.exam==='PPL';
    return isOfficial?`ENEM ${q.year} · ${q.exam==='PPL'?'PPL / reaplicação':'Aplicação regular'} · questão ${q.number}`:`${q.institution||'ENEM — treino autoral'} · ${q.year} · questão autoral`;
  }
  return 'Banco misto · questão autoral';
}
function examQuestionCard(type,q,i){
  const id=examQuestionId(type,q),response=state.examBatchAnswers[type]?.[id],answered=!!response;
  const correct=response?.correct===true,choice=response?.choice;
  const source=type==='enem'?(q.url?`<button class="soft" data-enem-source="${i}">Fonte da questão ↗</button>`:'<small>Questão autoral de treino no formato ENEM.</small>'):`<small>Referência temática: ${esc(q.source||'Banco misto')}</small>`;
  return `<article class="enem-question" id="${type}-q${i+1}"><div class="enem-qhead"><span class="q-number">${String(i+1).padStart(2,'0')}</span><div><strong>${esc(q.topic)}</strong><small>${esc(examMeta(type,q))}</small></div><span class="tag">${answered?(correct?'✓ Acertou':'↻ Revisar'):'Nova'}</span></div><h3>${esc(q.p)}</h3><div class="options">${q.op.map((o,j)=>`<button class="answer ${answered&&j===q.r?'correct':''} ${answered&&j===choice&&!correct?'wrong':''}" data-${type}-answer="${i}" data-choice="${j}" ${answered?'disabled':''}><span class="letter">${String.fromCharCode(65+j)}</span><span>${esc(o)}</span></button>`).join('')}</div><div class="enem-feedback feedback ${correct?'good':'bad'}" id="${type}-feedback-${i}" ${answered?'':'hidden'}>${answered?`<strong>${correct?'✓ Correto!':'Resposta correta: '+String.fromCharCode(65+q.r)+'. '+esc(q.op[q.r])}</strong><p>${esc(q.e)}</p><small>${correct?'Questão concluída: ela não será sorteada novamente.':'Esta questão poderá aparecer novamente em outro sorteio.'}</small>`:''}</div><div class="enem-qfoot">${source}<span class="muted">${answered?(correct?'Concluída':'Resposta registrada'):'Escolha uma alternativa'}</span></div></article>`;
}
function vestibularQuestions(){
  if(examView==='random'||examView==='enem'){
    const type=examView,pool=examPool(type),ids=state.examBatch[type]||[],questions=ids.map(id=>pool.find(q=>examQuestionId(type,q)===id)).filter(Boolean);
    const remaining=pool.filter(q=>!state.examCorrect[examQuestionId(type,q)]).length;
    const completed=questions.filter(q=>state.examBatchAnswers[type]?.[examQuestionId(type,q)]).length;
    const label=type==='enem'?'Questões do ENEM':'Questões aleatórias';
    const sub=type==='enem'?'Questões adaptadas e questões autorais de treino, com identificação de ano e referência.':'Questões autorais variadas de Geografia, sorteadas a cada rodada.';
    const progressTag=`${completed}/${questions.length} respondidas`;
    const finished=questions.length===0;
    return `<div class="page-head"><button class="secondary" data-exam-back>← Voltar</button><div class="eyebrow" style="margin-top:18px">GEOGRAFIA · ${type==='enem'?'ENEM':'BANCO MISTO'}</div><h1>${label}</h1><p class="subhead">${sub}</p></div><div class="exam-tools"><span class="tag">${pool.length} no banco</span><span class="tag">${progressTag}</span><span class="tag">${remaining} ainda não dominadas</span>${type==='enem'?'<a href="https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem/provas-e-gabaritos" target="_blank" rel="noopener">Provas oficiais do Inep ↗</a>':''}</div>${finished?`<div class="panel"><h2>Você concluiu este banco! 🎉</h2><p class="muted">Todas as questões disponíveis desta categoria já foram acertadas. Novas questões poderão ser adicionadas em futuras atualizações.</p></div>`:questions.map((q,i)=>examQuestionCard(type,q,i)).join('')}<div class="exam-tools" style="margin-top:18px"><button class="primary" data-exam-next ${finished?'disabled':''}>Sortear outras 5 questões →</button><span class="muted">Questões acertadas ficam registradas na sua conta e não voltam a ser sorteadas.</span></div><p class="source-note">As questões oficiais são apresentadas em versão resumida ou adaptada, sem reprodução literal dos enunciados. As questões identificadas como treino autoral foram elaboradas para prática e não são itens oficiais do Inep.</p>`;
  }
  return `<div class="page-head"><div class="eyebrow">PRATIQUE</div><h1>Questões de vestibular</h1><p class="subhead">Escolha uma modalidade. As rodadas são sorteadas e seu domínio fica salvo na conta.</p></div><div class="exam-grid"><button class="exam-card" data-exam="enem"><span class="exam-icon">🇧🇷</span><span class="exam-tag">${ENEM_QUESTIONS.length} QUESTÕES</span><h2>ENEM</h2><p>Questões identificadas por ano, aplicação e referência, além de treinos autorais.</p><span class="exam-action">Sortear questões →</span></button><button class="exam-card" data-exam="random"><span class="exam-icon">🎲</span><span class="exam-tag">${RANDOM_QUESTIONS.length} QUESTÕES</span><h2>Aleatória</h2><p>Banco misto de Geografia com temas variados e gabarito comentado.</p><span class="exam-action">Sortear questões →</span></button></div>`;
}
function renderExam(){go('questoes')}
function answerExam(type,i,j){
  const ids=state.examBatch[type]||[],pool=examPool(type),id=ids[i],q=pool.find(item=>examQuestionId(type,item)===id);
  if(!q||state.examBatchAnswers[type]?.[id])return;
  const correct=j===q.r;
  state.examBatchAnswers[type]??={};
  state.examBatchAnswers[type][id]={choice:j,correct,answeredAt:new Date().toISOString()};
  state.examAttempts[id]=(Number(state.examAttempts[id])||0)+1;
  if(correct){state.examCorrect[id]=true;const topic=q.topic||'Geografia';state.stats[topic]??={correct:0,total:0};state.stats[topic].correct++;state.stats[topic].total++;award(10)}
  else{const topic=q.topic||'Geografia';state.stats[topic]??={correct:0,total:0};state.stats[topic].total++}
  save();
  const card=$(`#${type}-feedback-${i}`),buttons=$$(`[data-${type}-answer="${i}"]`);
  buttons.forEach((b,n)=>{b.disabled=true;if(n===q.r)b.classList.add('correct');if(n===j&&!correct)b.classList.add('wrong')});
  if(card){card.hidden=false;card.className=`enem-feedback feedback ${correct?'good':'bad'}`;card.innerHTML=`<strong>${correct?'✓ Correto!':'Resposta correta: '+String.fromCharCode(65+q.r)+'. '+esc(q.op[q.r])}</strong><p>${esc(q.e)}</p><small>${correct?'Questão concluída: ela não será sorteada novamente.':'Esta questão poderá aparecer novamente em outro sorteio.'}</small>`}
  const article=$(`#${type}-q${i+1} .enem-qhead .tag`);if(article)article.textContent=correct?'✓ Acertou':'↻ Revisar';
}
function progress(){const all=DATA.reduce((n,c)=>n+c.lessons.length,0),done=DATA.reduce((n,c)=>n+doneCount(c),0),answers=Object.values(state.stats).reduce((n,s)=>n+s.total,0),rows=Object.entries(state.stats),rank=rankForXP(),streak=currentStreak(),rankPanel=`<section class="rank-progress-card rank-${rank.current.id}"><div class="rank-progress-head"><div class="rank-emblem">${rank.current.icon}</div><div><span class="eyebrow">SEU RANKING ATUAL</span><h2>${rank.current.name}</h2><p>${state.xp.toLocaleString('pt-BR')} XP acumulados</p></div><span class="rank-tier-count">${RANKS.findIndex(r=>r.id===rank.current.id)+1}/6</span></div>${rank.next?`<div class="rank-next-row"><strong>Próximo: ${rank.next.icon} ${rank.next.name}</strong><span>Faltam ${rank.remaining.toLocaleString('pt-BR')} XP</span></div><div class="rank-progress-track"><span style="width:${rank.progress}%"></span></div>`:'<div class="rank-next-row"><strong>🏆 Você alcançou o ranking máximo!</strong><span>Geógrafo</span></div><div class="rank-progress-track"><span style="width:100%"></span></div>'}<div class="rank-ladder">${RANKS.map(r=>`<div class="rank-step ${r.id===rank.current.id?'current':state.xp>=r.min?'unlocked':''}"><span>${r.icon}</span><strong>${r.name}</strong><small>${r.min.toLocaleString('pt-BR')} XP</small></div>`).join('')}</div></section>`;return `<div class="page-head"><div class="eyebrow">SEU CAMINHO ATÉ A APROVAÇÃO</div><h1></h1><p class="subhead">Acompanhe sua constância e descubra quais assuntos merecem mais uma revisão.</p></div>${rankPanel}<div class="grid2"><div class="stat-card"><div class="big">${state.xp} ✦</div><p>XP acumulado · ranking ${rank.current.name}</p></div><div class="stat-card"><div class="big">${done}/${all}</div><p>lições concluídas no total</p></div><div class="stat-card"><div class="big">${answers}</div><p>respostas registradas</p></div><div class="stat-card"><div class="big">${streak} 🔥</div><p>dias de ofensiva atual</p></div></div><div class="panel" style="margin-top:16px"><h2>Suas jornadas</h2>${DATA.map(c=>{const d=doneCount(c),p=Math.round(d/c.lessons.length*100);return `<div style="margin:17px 0"><div class="daily-row"><strong>${c.emoji} ${esc(c.name)}</strong><span>${d}/${c.lessons.length} · ${p}%</span></div><div class="daily-bar"><span style="width:${p}%;background:linear-gradient(90deg,var(--purple),#a28fff)"></span></div></div>`}).join('')}</div><div class="panel"><h2>Domínio por assunto</h2>${rows.length?`<table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="text-align:left;color:var(--muted)"><th style="padding:8px">Assunto</th><th>Acertos</th><th>Estimativa</th></tr>${rows.map(([t,s])=>{const p=Math.round(s.correct/s.total*100);return `<tr style="border-top:1px solid var(--line)"><td style="padding:10px 8px">${esc(t)}</td><td>${s.correct}/${s.total} (${p}%)</td><td>${s.total<5?'Poucos dados':p>=80?'Bom domínio':p>=60?'Em desenvolvimento':'Revisar'}</td></tr>`}).join('')}</table><p class="muted">Estimativas baseadas nas respostas registradas; não substituem uma avaliação completa.</p>`:'<p class="muted">Responda questões para ver seu desempenho por assunto.</p>'}</div><div class="panel"><h2>Conquistas</h2><div class="grid2">${[{id:'50',icon:'🌟',name:'Primeiros passos',desc:'Acumule 50 XP'},{id:'200',icon:'🏅',name:'Em ritmo forte',desc:'Acumule 200 XP'}].map(b=>`<div class="stat-card" style="opacity:${state.badges.includes(b.id)?1:.55}"><div style="font-size:25px">${b.icon}</div><strong>${b.name}</strong><p>${state.badges.includes(b.id)?'Conquistada':b.desc}</p></div>`).join('')}</div></div>`}
// ========================================
// RADAR GEOPOLÍTICO — protótipo visual
// Os pontos e textos abaixo são demonstrativos; não representam notícias ao vivo.
// ========================================
const LIVE_REGIONS=[
 {id:'south-america',name:'América do Sul',lat:-15,lng:-60,zoom:4,countries:[]},
 {id:'central-america',name:'América Central',lat:15,lng:-87,zoom:5,countries:[]},
 {id:'north-america',name:'América do Norte',lat:47,lng:-103,zoom:4,countries:[]},
 {id:'southern-africa',name:'Sul da África',lat:-25,lng:25,zoom:5,countries:[]},
 {id:'north-africa',name:'Norte da África',lat:27,lng:15,zoom:5,countries:[]},
 {id:'europe',name:'Europa',lat:50,lng:15,zoom:5,countries:[]},
 {id:'central-asia',name:'Ásia Central',lat:43,lng:68,zoom:5,countries:[]},
 {id:'middle-east',name:'Oriente Médio',lat:29.5,lng:43.5,zoom:5,countries:[]},
 {id:'oceania',name:'Oceania',lat:-24,lng:137,zoom:4,countries:[]},
 {id:'east-asia',name:'Leste Asiático',lat:35,lng:115,zoom:4,countries:[]}
];
const COUNTRY_CONTINENT={"FJI":"oceania","TZA":"africa","ESH":"africa","CAN":"north_america","USA":"north_america","KAZ":"asia","UZB":"asia","PNG":"oceania","IDN":"asia","ARG":"south_america","CHL":"south_america","COD":"africa","SOM":"africa","KEN":"africa","SDN":"africa","TCD":"africa","HTI":"north_america","DOM":"north_america","RUS":"europe","BHS":"north_america","FLK":"south_america","Norway":"europe","GRL":"north_america","ATF":"seven_seas_(open_ocean)","TLS":"asia","ZAF":"africa","LSO":"africa","MEX":"north_america","URY":"south_america","BRA":"south_america","BOL":"south_america","PER":"south_america","COL":"south_america","PAN":"north_america","CRI":"north_america","NIC":"north_america","HND":"north_america","SLV":"north_america","GTM":"north_america","BLZ":"north_america","VEN":"south_america","GUY":"south_america","SUR":"south_america","France":"europe","ECU":"south_america","PRI":"north_america","JAM":"north_america","CUB":"north_america","ZWE":"africa","BWA":"africa","NAM":"africa","SEN":"africa","MLI":"africa","MRT":"africa","BEN":"africa","NER":"africa","NGA":"africa","CMR":"africa","TGO":"africa","GHA":"africa","CIV":"africa","GIN":"africa","GNB":"africa","LBR":"africa","SLE":"africa","BFA":"africa","CAF":"africa","COG":"africa","GAB":"africa","GNQ":"africa","ZMB":"africa","MWI":"africa","MOZ":"africa","SWZ":"africa","AGO":"africa","BDI":"africa","ISR":"asia","LBN":"asia","MDG":"africa","PSE":"asia","GMB":"africa","TUN":"africa","DZA":"africa","JOR":"asia","ARE":"asia","QAT":"asia","KWT":"asia","IRQ":"asia","OMN":"asia","VUT":"oceania","KHM":"asia","THA":"asia","LAO":"asia","MMR":"asia","VNM":"asia","PRK":"asia","KOR":"asia","MNG":"asia","IND":"asia","BGD":"asia","BTN":"asia","NPL":"asia","PAK":"asia","AFG":"asia","TJK":"asia","KGZ":"asia","TKM":"asia","IRN":"asia","SYR":"asia","ARM":"asia","SWE":"europe","BLR":"europe","UKR":"europe","POL":"europe","AUT":"europe","HUN":"europe","MDA":"europe","ROU":"europe","LTU":"europe","LVA":"europe","EST":"europe","DEU":"europe","BGR":"europe","GRC":"europe","TUR":"asia","ALB":"europe","HRV":"europe","CHE":"europe","LUX":"europe","BEL":"europe","NLD":"europe","PRT":"europe","ESP":"europe","IRL":"europe","NCL":"oceania","SLB":"oceania","NZL":"oceania","AUS":"oceania","LKA":"asia","CHN":"asia","TWN":"asia","ITA":"europe","DNK":"europe","GBR":"europe","ISL":"europe","AZE":"asia","GEO":"asia","PHL":"asia","MYS":"asia","BRN":"asia","SVN":"europe","FIN":"europe","SVK":"europe","CZE":"europe","ERI":"africa","JPN":"asia","PRY":"south_america","YEM":"asia","SAU":"asia","ATA":"antarctica","N. Cyprus":"asia","CYP":"asia","MAR":"africa","EGY":"africa","LBY":"africa","ETH":"africa","DJI":"africa","Somaliland":"africa","UGA":"africa","RWA":"africa","BIH":"europe","MKD":"europe","SRB":"europe","MNE":"europe","Kosovo":"europe","TTO":"north_america","SSD":"africa","ANDORRA":"europe","ANTIGUA AND BARBUDA":"north_america","BAHRAIN":"asia","BARBADOS":"north_america","CABO VERDE":"africa","COMOROS":"africa","DOMINICA":"north_america","GRENADA":"north_america","KIRIBATI":"oceania","LIECHTENSTEIN":"europe","MALDIVES":"asia","MALTA":"europe","MARSHALL ISLANDS":"oceania","MAURITIUS":"africa","MICRONESIA":"oceania","MONACO":"europe","NAURU":"oceania","PALAU":"oceania","SAINT KITTS AND NEVIS":"north_america","SAINT LUCIA":"north_america","SAINT VINCENT AND THE GRENADINES":"north_america","SAMOA":"oceania","SAN MARINO":"europe","SAO TOME AND PRINCIPE":"africa","SEYCHELLES":"africa","SINGAPORE":"asia","TONGA":"oceania","TUVALU":"oceania","VATICAN":"europe"};
let liveMapElement=null, liveStage='world', liveSelectedRegion=null, liveSvgRoot=null, liveView={x:0,y:0,w:1440,h:720}, liveAnimation=null, livePointer=null;
function liveRadar(){return `<div class="page-head live-page-head"><div class="eyebrow"><span class="live-nav-dot"></span> RADAR GLOBAL</div><h1>Acontecimentos ao vivo</h1><p class="subhead">Explore regiões e selecione diretamente os países no mapa.</p></div><section class="live-layout"><div class="live-map-card"><div class="live-map-top"><div><span class="live-status"><i></i> MAPA INTERATIVO</span><strong id="live-map-label">Visão mundial</strong></div><button class="live-reset" id="live-reset">⌂ Mundo</button></div><div id="live-map" role="application" aria-label="Mapa-múndi político interativo com áreas clicáveis dos países"><div class="live-map-loading">Preparando o mapa-múndi…</div></div><div class="live-map-legend"><span><i></i> Países com notícias</span><small>Arraste para mover · use a roda para aproximar</small></div></div><aside class="live-info-card" id="live-info"><div class="live-info-empty"><span class="live-info-icon">◎</span><span class="eyebrow">EXPLORE O MAPA</span><h2>O mundo em foco</h2><p>Selecione uma região ou toque diretamente no território de um país para abrir seu painel.</p></div></aside></section><p class="live-footnote">Mapa vetorial integrado ao aplicativo. Selecione uma região ou um país para explorar.</p>`}
function liveCountryName(raw){return COUNTRY_PT[raw]||raw}
let liveEventsByCountry=new Map(),liveFeedError='';
function liveCountryFromPath(el){const raw=el.dataset.country||'País';return {id:el.dataset.iso||raw,name:liveCountryName(raw)}}
async function loadLiveEvents(){
  liveFeedError='';
  if(!supabaseClient || !navigator.onLine){liveFeedError='offline';return}
  let data,error;
  try{
    ({data,error}=await supabaseClient.from('global_events').select('id,title,description,countries,source_name,source_url,published_at').eq('status','active').order('published_at',{ascending:false}).limit(500));
  }catch(err){liveFeedError=err?.message||'Sem conexão';return}
  if(error){liveFeedError=error.message;console.error('Falha ao carregar notícias do Radar Global:',error);return}
  liveEventsByCountry=new Map();
  (data||[]).forEach(article=>{
    (Array.isArray(article.countries)?article.countries:[]).forEach(iso=>{
      if(!liveEventsByCountry.has(iso))liveEventsByCountry.set(iso,[]);
      liveEventsByCountry.get(iso).push(article);
    });
  });
  liveSvgRoot?.querySelectorAll('[data-iso]').forEach(path=>{
    const hasNews=(liveEventsByCountry.get(path.dataset.iso)||[]).length>0;
    path.classList.toggle('has-news',hasNews);
    const name=liveCountryName(path.dataset.country||'País');
    path.setAttribute('aria-label',hasNews?`${name}: possui notícias. Selecionar`:`${name}: sem notícias. Selecionar`);
  });
}
function liveFormatDate(value){if(!value)return 'Data não informada';const date=new Date(value);return Number.isNaN(date.getTime())?'Data não informada':date.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})}
function liveRenderCountryNews(country,region){
  const articles=liveEventsByCountry.get(country.id)||[];
  const back=`<button class="live-back" id="live-back">← ${esc(region.name)}</button>`;
  if(liveFeedError){$('#live-info').innerHTML=`<article class="live-country-detail">${back}<h2>${esc(country.name)}</h2><p>Não foi possível consultar as notícias agora. Tente novamente em instantes.</p></article>`;}
  else if(!articles.length){$('#live-info').innerHTML=`<article class="live-country-detail">${back}<h2>${esc(country.name)}</h2><p>Não há notícias disponíveis para este país no momento.</p></article>`;}
  else {
    const cards=articles.map(article=>`<article class="live-news-card"><h3>${esc(article.title)}</h3>${article.description?`<p>${esc(article.description)}</p>`:''}<div class="live-detail-meta"><span>${esc(liveFormatDate(article.published_at))}</span><span>${esc(article.source_name||'Fonte')}</span></div><a href="${esc(article.source_url)}" target="_blank" rel="noopener noreferrer">Ler notícia ↗</a></article>`).join('');
    $('#live-info').innerHTML=`<article class="live-country-detail">${back}<span class="live-event-chip"><i></i> ${articles.length} notícia${articles.length===1?'':'s'}</span><h2>${esc(country.name)}</h2><div class="live-news-list">${cards}</div></article>`;
  }
  $('#live-back')?.addEventListener('click',()=>showLiveRegion(region));
}
function liveSetView(next,duration=900){if(!liveSvgRoot)return;const from={...liveView},to={...next};to.w=Math.max(180,Math.min(1440,to.w));to.h=to.w/2;to.x=Math.max(0,Math.min(1440-to.w,to.x));to.y=Math.max(0,Math.min(720-to.h,to.y));if(liveAnimation)cancelAnimationFrame(liveAnimation);const start=performance.now();const tick=now=>{const t=Math.min(1,(now-start)/duration),e=1-Math.pow(1-t,3);liveView={x:from.x+(to.x-from.x)*e,y:from.y+(to.y-from.y)*e,w:from.w+(to.w-from.w)*e,h:from.h+(to.h-from.h)*e};liveSvgRoot.setAttribute('viewBox',`${liveView.x} ${liveView.y} ${liveView.w} ${liveView.h}`);if(t<1)liveAnimation=requestAnimationFrame(tick);else liveAnimation=null};liveAnimation=requestAnimationFrame(tick)}
function liveFocus(lat,lng,width=480,duration=950){const [x,y]=[(lng+180)/360*1440,(85-Math.max(-80,Math.min(85,lat)))/165*720];liveSetView({x:x-width/2,y:y-width/4,w:width,h:width/2},duration)}
function liveZoomAt(px,py,factor){const w=Math.max(180,Math.min(1440,liveView.w*factor)),h=w/2,rx=px/1440,ry=py/720,x=liveView.x+(liveView.w-w)*rx,y=liveView.y+(liveView.h-h)*ry;liveSetView({x,y,w,h},280)}
async function initLiveMap(){const el=$('#live-map');if(!el)return;if(liveMapElement===el&&liveSvgRoot)return;liveMapElement=el;try{const template=document.getElementById('world-map-template');if(!template||!template.content.querySelector('svg'))throw Error('O mapa vetorial integrado não foi encontrado no index.html.');el.innerHTML=template.innerHTML;liveSvgRoot=el.querySelector('svg');if(!liveSvgRoot)throw Error('O conteúdo integrado não contém SVG.');liveView={x:0,y:0,w:1440,h:720};liveSvgRoot.setAttribute('viewBox','0 0 1440 720');
 liveSvgRoot.querySelectorAll('[data-country]').forEach(path=>{const iso=path.dataset.iso;const localizedName=liveCountryName(path.dataset.country||'País');path.setAttribute('aria-label',`Selecionar ${localizedName}`);let title=path.querySelector('title');if(!title){title=document.createElementNS('http://www.w3.org/2000/svg','title');path.appendChild(title)}title.textContent=localizedName;path.addEventListener('click',()=>showLiveCountry(liveCountryFromPath(path),liveContinentRegionFromIso(iso),path));path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showLiveCountry(liveCountryFromPath(path),liveContinentRegionFromIso(iso),path)}});path.addEventListener('pointerenter',()=>path.classList.add('country-hover'));path.addEventListener('pointerleave',()=>path.classList.remove('country-hover'))});
 LIVE_REGIONS.forEach(region=>{const [x,y]=[(region.lng+180)/360*1440,(85-region.lat)/165*720];const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','live-svg-region');g.setAttribute('transform',`translate(${x} ${y})`);const labelBelow=['central-america','middle-east'].includes(region.id);g.innerHTML=`<circle class="region-halo" r="29"/><circle class="region-wave" r="17"/><circle class="region-dot" r="11"/><text class="region-label" y="${labelBelow?43:-35}" text-anchor="middle">${region.name}</text>`;g.addEventListener('click',()=>showLiveRegion(region));liveSvgRoot.appendChild(g)});
 await loadLiveEvents();
 el.addEventListener('wheel',liveWheel,{passive:false});el.addEventListener('pointerdown',livePointerDown);el.addEventListener('pointermove',livePointerMove);el.addEventListener('pointerup',livePointerUp);el.addEventListener('pointercancel',livePointerUp);$('#live-reset')?.addEventListener('click',resetLiveMap);
 }catch(error){console.error('Falha ao carregar mapa vetorial:',error);el.innerHTML='<div class="live-map-loading">Não foi possível carregar o mapa. Atualize a página e tente novamente.</div>'}}
function liveWheel(e){if(!liveSvgRoot)return;e.preventDefault();const r=liveSvgRoot.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*1440,py=(e.clientY-r.top)/r.height*720,factor=e.deltaY>0?1.16:.86;liveZoomAt(px,py,factor);if(e.deltaY>0&&liveView.w*factor>=1000)liveSvgRoot.classList.remove('regions-hidden')}
function livePointerDown(e){if(e.target.closest('.live-svg-region')||e.target.closest('[data-country]'))return;livePointer={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...liveView}};e.currentTarget.setPointerCapture(e.pointerId)}
function livePointerMove(e){if(!livePointer||e.pointerId!==livePointer.id)return;const r=liveSvgRoot.getBoundingClientRect(),dx=(e.clientX-livePointer.x)/r.width*liveView.w,dy=(e.clientY-livePointer.y)/r.height*liveView.h;liveView.x=Math.max(0,Math.min(1440-liveView.w,livePointer.view.x-dx));liveView.y=Math.max(0,Math.min(720-liveView.h,livePointer.view.y-dy));liveSvgRoot.setAttribute('viewBox',`${liveView.x} ${liveView.y} ${liveView.w} ${liveView.h}`)}
function livePointerUp(e){if(livePointer&&e.pointerId===livePointer.id)livePointer=null}
function liveContinentRegionFromIso(iso){const feature=COUNTRY_CONTINENT[iso]||'world';const regions={africa:{name:'África',lat:2,lng:20,zoom:3.2},asia:{name:'Ásia',lat:28,lng:95,zoom:3.2},europe:{name:'Europa',lat:51,lng:15,zoom:4},north_america:{name:'América do Norte',lat:42,lng:-102,zoom:3.2},south_america:{name:'América do Sul',lat:-15,lng:-60,zoom:3.2},oceania:{name:'Oceania',lat:-20,lng:140,zoom:3.2}};const r=regions[feature]||{name:'Mundo',lat:22,lng:8,zoom:2};return {id:feature,...r,synthetic:true}}
function showLiveRegion(region){liveStage='region';liveSelectedRegion=region;liveSvgRoot?.classList.add('regions-hidden');liveFocus(region.lat,region.lng,Math.max(330,1440/Math.pow(2,region.zoom-1)),1100);$('#live-map-label').textContent=region.name;$('#live-info').innerHTML=`<div class="live-info-region"><span class="eyebrow">REGIÃO SELECIONADA</span><h2>${esc(region.name)}</h2><p>Agora toque diretamente no território de qualquer país para abrir seu painel.</p><div class="live-mini-note">Todos os territórios permanecem selecionáveis.</div></div>`}
function liveFocusSvgBox(node,width=220,duration=950){if(!node||!liveSvgRoot)return;const b=node.getBBox();const cx=b.x+b.width/2,cy=b.y+b.height/2;const w=Math.max(180,Math.min(520,Math.max(b.width,b.height*2)*2.8,width));const h=w/2;liveSetView({x:cx-w/2,y:cy-h/2,w,h},duration)}
function showLiveCountry(country,region,clickedPath=null){liveStage='country';liveSelectedRegion=region;if(country.name==='França'){liveSetView({x:625,y:114,w:220,h:110},950)}else if(country.id==='RUS'){liveFocus(61,103,220,950)}else{let node=clickedPath;if(!node)node=liveSvgRoot?.querySelector(`[data-iso="${CSS.escape(country.id)}"]`);if(node)liveFocusSvgBox(node,220,950)}$('#live-map-label').textContent=country.name;liveRenderCountryNews(country,region)}
function resetLiveMap(){if(!liveSvgRoot)return;liveStage='world';liveSelectedRegion=null;liveSvgRoot.classList.remove('regions-hidden');liveSetView({x:0,y:0,w:1440,h:720},1050);$('#live-map-label').textContent='Visão mundial';$('#live-info').innerHTML=`<div class="live-info-empty"><span class="live-info-icon">◎</span><span class="eyebrow">EXPLORE O MAPA</span><h2>O mundo em foco</h2><p>Selecione uma região ou toque diretamente no território de um país para abrir seu painel.</p></div>`}

const VIEWS={jornada:journey,atlas,questoes:vestibularQuestions,progresso:progress,'ao-vivo':liveRadar};
function bind(){const root=$('#content');$$('[data-home]',document).forEach(b=>b.onclick=e=>{e.preventDefault();session=null;go('jornada')});$$('[data-view]',root).forEach(b=>b.onclick=()=>go(b.dataset.view));$$('[data-lesson]',root).forEach(b=>b.onclick=()=>startLesson(b.dataset.lesson));const cont=$('[data-continue]',root);if(cont)cont.onclick=()=>{const l=nextLesson();if(l)startLesson(l.id)};const begin=$('[data-begin]',root);if(begin)begin.onclick=()=>{session.phase='question';renderSession()};$$('[data-answer]',root).forEach(b=>b.onclick=()=>answer(+b.dataset.answer));$$('[data-lesson-map-country]',root).forEach(p=>{p.onclick=()=>answerMapCountry(p.dataset.lessonMapCountry);p.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();answerMapCountry(p.dataset.lessonMapCountry)}}});const nxt=$('[data-next]',root);if(nxt)nxt.onclick=nextQuestion;const exit=$('[data-exit]',root);if(exit)exit.onclick=()=>{session=null;go('jornada')};const finish=$('[data-finish]',root);if(finish)finish.onclick=()=>{const lessonIndex=lessons().findIndex(x=>x.id===session?.lesson?.id),currentModule=moduleFor(active(),lessonIndex),hasNextModule=!!currentModule&&moduleGroups(active()).some(g=>g.number===currentModule.number+1),nextModule=session?.phase==='result'&&session.correct/session.lesson.questions.length>=.6&&lessonIndex>=0&&(!lessons()[lessonIndex+1]||moduleFor(active(),lessonIndex+1)?.number!==currentModule.number)&&hasNextModule?currentModule.number+1:null;session=null;go('jornada');if(nextModule)setTimeout(()=>document.querySelector(`[data-module="${nextModule}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),180)};const retry=$('[data-retry]',root);if(retry)retry.onclick=()=>{session.index=0;session.correct=0;session.phase='question';session.answered=false;renderSession()};const quick=$('[data-quick]',root);if(quick)quick.onclick=()=>{const pool=DATA.flatMap(c=>c.lessons.flatMap(l=>l.questions.map(q=>({...q,topic:q.topic||c.name})))).sort(()=>Math.random()-.5).slice(0,5);startLesson('quick',true,pool)};$$('[data-exam]',root).forEach(b=>b.onclick=()=>openExam(b.dataset.exam));$$('[data-enem-answer]',root).forEach(b=>b.onclick=()=>answerExam('enem',+b.dataset.enemAnswer,+b.dataset.choice));$$('[data-random-answer]',root).forEach(b=>b.onclick=()=>answerExam('random',+b.dataset.randomAnswer,+b.dataset.choice));const nextExam=$('[data-exam-next]',root);if(nextExam)nextExam.onclick=()=>{createExamBatch(examView);renderExam()};$$('[data-enem-source]',root).forEach(b=>{b.onclick=()=>{const id=state.examBatch.enem?.[+b.dataset.enemSource],q=ENEM_QUESTIONS.find(x=>examQuestionId('enem',x)===id);if(q?.url)window.open(q.url,'_blank','noopener')}});const examBack=$('[data-exam-back]',root);if(examBack)examBack.onclick=()=>{examView='menu';go('questoes')}; $$('[data-mapmode]',root).forEach(b=>b.onclick=()=>{map.mode=b.dataset.mapmode;if(map.mode==='biomes')resetBiomes();else if(!map.data){map.targets=null;map.target=null}go('atlas')});$$('[data-continent]',root).forEach(b=>b.onclick=()=>{map.continent=b.dataset.continent;resetCountries();renderCountries()});const resetMap=$('[data-mapreset]',root);if(resetMap)resetMap.onclick=()=>{if(map.mode==='biomes'){resetBiomes();renderBiomes()}else{resetCountries();renderCountries()}};const retryMap=$('[data-mapretry]',root);if(retryMap)retryMap.onclick=()=>{if(map.mode==='biomes')map.biomeData=null;else map.data=null;loadAtlas()};$$('[data-country]',root).forEach(p=>{p.onclick=()=>clickCountry(p.dataset.country);p.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();clickCountry(p.dataset.country)}}});$$('[data-biome]',root).forEach(p=>{p.onclick=()=>clickBiome(p.dataset.biome);p.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();clickBiome(p.dataset.biome)}}});}
// ========================================
// CONTA, LOGIN E SINCRONIZAÇÃO NA NUVEM
// ========================================
function authScreen(){
  if(document.getElementById('authScreen'))return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="authScreen" class="auth-screen" role="dialog" aria-modal="true" aria-labelledby="authTitle">
      <div class="auth-card">
        <div class="auth-logo"><img src="logo.svg" alt=""><span>VESTIBULANDO <b>GEO</b></span></div>
        <div class="auth-kicker">SUA JORNADA, EM QUALQUER DISPOSITIVO</div>
        <h1 id="authTitle">Seu progresso merece continuar.</h1>
        <p class="auth-intro">Entre na sua conta para salvar suas conquistas e continuar estudando de onde parou.</p>
        <div class="auth-tabs"><button type="button" data-auth-mode="login" class="active">Entrar</button><button type="button" data-auth-mode="signup">Criar conta</button></div>
        <form id="authForm" class="auth-form">
          <label id="authNameWrap" class="auth-field hidden">Seu nome<input id="authName" type="text" autocomplete="name" placeholder="Como podemos te chamar?"></label>
          <label class="auth-field">E-mail<input id="authEmail" type="email" autocomplete="email" placeholder="seu@email.com" required></label>
          <label class="auth-field">Senha<input id="authPassword" type="password" autocomplete="current-password" placeholder="Mínimo de 6 caracteres" minlength="6" required></label>
          <button id="authSubmit" class="primary auth-submit" type="submit">Entrar na minha conta →</button>
          <p id="authMessage" class="auth-message" role="status" aria-live="polite"></p>
        </form>
        <div class="auth-foot">Seu progresso fica salvo neste dispositivo e sincronizado na sua conta.</div>
      </div>
    </div>`);
  const screen=$('#authScreen');
  screen.querySelectorAll('[data-auth-mode]').forEach(b=>b.addEventListener('click',()=>setAuthMode(b.dataset.authMode)));
  $('#authForm').addEventListener('submit',submitAuth);
}
function setAuthMode(mode){
  authMode=mode;
  screenMode();
  function screenMode(){
    $('#authScreen').querySelectorAll('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));
    $('#authNameWrap').classList.toggle('hidden',mode!=='signup');
    $('#authPassword').autocomplete=mode==='signup'?'new-password':'current-password';
    $('#authSubmit').textContent=mode==='signup'?'Criar minha conta →':'Entrar na minha conta →';
    $('#authTitle').textContent=mode==='signup'?'Comece sua jornada.':'Seu progresso merece continuar.';
    $('#authMessage').textContent='';
  }
}
function authMessage(message,error=false){const el=$('#authMessage');if(el){el.textContent=message;el.classList.toggle('error',error)}}
async function submitAuth(event){
  event.preventDefault();
  if(!supabaseClient){authMessage('A conexão com a conta não está disponível. Você pode continuar estudando e seu progresso ficará salvo neste aparelho.',true);return;}
  const email=$('#authEmail').value.trim(),password=$('#authPassword').value;
  const name=$('#authName').value.trim();
  const button=$('#authSubmit');button.disabled=true;button.textContent='Aguarde...';authMessage('');
  try{
    if(authMode==='signup'){
      const {data,error}=await supabaseClient.auth.signUp({email,password,options:{data:{display_name:name}}});
      if(error)throw error;
      if(!data.session){authMessage('Conta criada! Confira seu e-mail para confirmar o cadastro. Depois, volte aqui e entre.');return}
      authUser=data.user;
    }else{
      const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
      if(error)throw error;
      authUser=data.user;
    }
    rememberDeviceAuth(authUser);
    try{await loadCloudProgress(true)}catch(syncError){
      // A autenticação foi concluída; uma falha temporária na nuvem não deve bloquear o estudo.
      syncReady=false;
      console.warn('Conta autenticada; sincronização ficará pendente:',syncError);
    }
    showAuthenticated();
    notify(syncReady?'Conta conectada. Progresso sincronizado!':'Conta conectada. Progresso salvo neste aparelho; sincronização pendente.');
  }catch(error){authMessage(authErrorText(error),true)}
  finally{button.disabled=false;button.textContent=authMode==='signup'?'Criar minha conta →':'Entrar na minha conta →'}
}
function authErrorText(error){
  const m=String(error?.message||'');
  if(/invalid login credentials/i.test(m))return 'E-mail ou senha incorretos.';
  if(/already registered/i.test(m))return 'Este e-mail já possui uma conta. Entre nela.';
  if(/password should be|at least/i.test(m))return 'A senha precisa ter pelo menos 6 caracteres.';
  return m||'Não foi possível conectar. Verifique sua internet e tente novamente.';
}
async function loadCloudProgress(isLogin=false){
  if(!supabaseClient) return;
  syncReady=false;
  const {data,error}=await supabaseClient.from('profiles').select('progress,display_name').eq('id',authUser.id).maybeSingle();
  if(error)throw error;
  const cloud=data?.progress;
  const hasCloud=cloud&&typeof cloud==='object'&&Object.keys(cloud).length>0;
  const localRaw=localStorage.getItem(KEY);
  const hasLocal=!!localRaw&&localRaw!=='{}';
  const hasOfflineChanges=localStorage.getItem(OFFLINE_DIRTY_KEY)==='1';
  if(hasOfflineChanges && hasLocal){
    // O progresso local é a cópia mais recente quando houve estudo sem rede.
    try{state={...defaults(),...JSON.parse(localRaw)}}catch{state=defaults()}
    syncReady=true;
    updateHeader();
    if(view)go(view);
    await syncProgress(true);
    return;
  }
  if(hasCloud){
    state={...defaults(),...cloud,examCorrect:{...defaults().examCorrect,...(cloud.examCorrect||{})},examAttempts:{...defaults().examAttempts,...(cloud.examAttempts||{})},examBatch:{...defaults().examBatch,...(cloud.examBatch||{})},examBatchAnswers:{...defaults().examBatchAnswers,...(cloud.examBatchAnswers||{})}};
    try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}
  }else if(hasLocal){
    // Na primeira conexão, preserva o progresso que já existia no aparelho.
    await syncProgress(true);
  }else{
    state=defaults();
    try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}
  }
  syncReady=true;
  updateHeader();
  if(view)go(view);
}
async function syncProgress(force=false){
  if(!supabaseClient||!authUser||(!syncReady&&!force))return;
  const totalCorrect=Object.values(state.stats||{}).reduce((n,s)=>n+(Number(s.correct)||0),0);
  const totalAnswers=Object.values(state.stats||{}).reduce((n,s)=>n+(Number(s.total)||0),0);
  const payload={progress:state,xp:Number(state.xp)||0,streak:Number(state.streak)||0,lessons_completed:Object.keys(state.completed||{}).filter(k=>state.completed[k]).length,correct_answers:totalCorrect,incorrect_answers:Math.max(0,totalAnswers-totalCorrect)};
  const {error}=await supabaseClient.from('profiles').update(payload).eq('id',authUser.id);
  if(error){console.warn('Falha ao sincronizar progresso:',error.message);if(!force)notify('Não foi possível sincronizar. Seu progresso continua salvo neste aparelho.');return false}
  try{localStorage.removeItem(OFFLINE_DIRTY_KEY)}catch{}
  return true;
}
function showAuthenticated(){
  const screen=$('#authScreen');if(screen)screen.remove();
  let chip=$('#accountChip');
  if(!chip){chip=document.createElement('div');chip.id='accountChip';chip.className='account-chip';$('.topbar').appendChild(chip)}
  const label=authUser.user_metadata?.display_name||authUser.email?.split('@')[0]||'Minha conta';
  chip.innerHTML=`<span class="account-dot">✓</span><span class="account-label">${esc(label)}</span><button type="button" id="authLogout">Sair</button>`;
  $('#authLogout').onclick=logout;
}
async function logout(){
  try{
    if(supabaseClient){
      const {error}=await supabaseClient.auth.signOut({scope:'local'});
      if(error)throw error;
    }
  }catch(error){notify('Não foi possível sair da conta.');return}
  try{localStorage.removeItem(AUTH_DEVICE_KEY);localStorage.removeItem(SUPABASE_STORAGE_KEY)}catch{}
  authUser=null;syncReady=false;
  const chip=$('#accountChip');if(chip)chip.remove();
  authScreen();setAuthMode('login');
  authMessage('Você saiu da conta. Seu progresso continua salvo neste aparelho.');
}
async function initAuth(){
  // A sessão local já libera o dispositivo; a validação/sincronização acontece em segundo plano.
  if(!supabaseClient || !navigator.onLine || authInitializing || supabaseInitialized) return;
  authInitializing=true;
  try{
    const {data,error}=await supabaseClient.auth.getSession();if(error)throw error;
    if(data.session?.user){
      authUser=data.session.user;
      rememberDeviceAuth(authUser);
      try{await loadCloudProgress()}catch(syncError){
        syncReady=false;
        console.warn('Sessão válida; sincronização ficará pendente:',syncError);
      }
      showAuthenticated();
    }else if(!readDeviceAuth()){
      authScreen();setAuthMode('login');
    }else{
      // Dispositivo já autenticado anteriormente: mantém o progresso local disponível.
      restoreDeviceAuth();
    }
    if(!authListenerRegistered){
      supabaseClient.auth.onAuthStateChange((event,session)=>{
        if(event==='SIGNED_OUT'){
          try{localStorage.removeItem(AUTH_DEVICE_KEY)}catch{}
          authUser=null;syncReady=false;
          const chip=$('#accountChip');if(chip)chip.remove();
          authScreen();setAuthMode('login');
        }
      });
      authListenerRegistered=true;
    }
    supabaseInitialized=true;
  }catch(error){
    console.warn('Não foi possível atualizar a sessão; mantendo o modo local quando autorizado:',error);
    syncReady=false;
    if(readDeviceAuth())restoreDeviceAuth();
    else{authScreen();authMessage('Não foi possível verificar sua conta. Conecte-se à internet para entrar.',true)}
    // Permite tentar novamente quando a conexão voltar.
    supabaseInitialized=false;
  }finally{authInitializing=false}
}

function loadSupabaseSdk(){
  if(supabaseClient){initAuth();return}
  if(supabaseLoading || !navigator.onLine)return;
  supabaseLoading=true;
  const script=document.createElement('script');
  script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  script.async=true;
  const timeout=setTimeout(()=>{supabaseLoading=false;script.remove()},6000);
  script.onload=()=>{
    clearTimeout(timeout);supabaseLoading=false;
    if(window.supabase?.createClient){
      supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
      initAuth();
    }
  };
  script.onerror=()=>{clearTimeout(timeout);supabaseLoading=false;console.warn('SDK de conta indisponível; o app seguirá em modo local.')};
  document.head.appendChild(script);
}

const deviceAlreadyAuthorized=restoreDeviceAuth();
if(!deviceAlreadyAuthorized)authScreen();
$('#switcher').onclick=()=>{$('#contentMenu').classList.toggle('hidden');$('#switcher').setAttribute('aria-expanded',String(!$('#contentMenu').classList.contains('hidden')))};$('#contentMenu').onclick=e=>{const b=e.target.closest('[data-content]');if(!b)return;state.active=b.dataset.content;save();$('#contentMenu').classList.add('hidden');go('jornada')};document.addEventListener('click',e=>{if(!e.target.closest('.switch-wrap'))$('#contentMenu').classList.add('hidden');const b=e.target.closest('[data-view]');if(b&&!$('#content').contains(b))go(b.dataset.view)});document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#contentMenu').classList.add('hidden')});go('jornada');
window.addEventListener('online',()=>{
  // Revalida a sessão ao voltar a rede e envia alterações feitas offline.
  supabaseInitialized=false;
  loadSupabaseSdk();
});
loadSupabaseSdk();
})();
