/* Factiun TCU worldwide · NAS service
 * Chromium executes bateria.html: no new battery formulas.
 * Runs serially; JSON checkpoints survive Synology restarts.
 */
import {createServer} from 'node:http';
import {readFile,writeFile,rename,readdir,unlink,mkdir,stat,statfs} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';

export const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
export const DATA=resolve(process.env.FACTIUN_MAPA_DATA||join(ROOT,'.nas-map-data'));
const PORT=Number(process.env.PORT||8787);
const KEY=process.env.OPEN_METEO_API_KEY||'';
const TOKEN=process.env.FACTIUN_MAPA_TOKEN||'';
const UI_QUEUE=process.env.ENABLE_UI_QUEUE==='1';
const MIN_DISK_GB=(function(){
  const supplied=process.env.MIN_DISK_FREE_GB;
  const n=supplied==null?20:Number(supplied);
  if(!Number.isFinite(n)||n<0||n>100000)
    throw Error('MIN_DISK_FREE_GB debe ser un número entre 0 y 100000');
  return n;
})();
async function diskSpace(){
  const fs=await statfs(DATA);
  const freeGB=Number(fs.bavail)*Number(fs.bsize)/1e9;
  if(!Number.isFinite(freeGB)||freeGB<0)
    throw Error('No se puede verificar el espacio disponible en el NAS');
  return {free_gb:Math.round(freeGB*100)/100,
    min_free_gb:MIN_DISK_GB,paused:freeGB<MIN_DISK_GB};
}
export const REVISION=createHash('sha256').update(
  ['bateria.html','sim/mapa-viabilidad.js','sim/fisica.js','sim/viento.js',
   'sim/canon.js','sim/cartera.js','pines.json',
   'nas/viabilidad/service.mjs','nas/viabilidad/seed.mjs','nas/viabilidad/mundo.mjs']
  .map(f=>readFileSync(join(ROOT,f))).reduce((a,b)=>Buffer.concat([a,b]),Buffer.alloc(0))
).digest('hex').slice(0,16);
const hash=s=>createHash('sha256').update(s).digest('hex');
/* Los resultados globales NO deben alimentar el snapshot de plantas:
   decenas de miles de JSON en /done saturarían la memoria del navegador. */
const folders=['pending','running','done','world-done','failed','meteo','world'];
/* 170.435 resultados mundiales en una sola carpeta degradarían Btrfs.
   Distribuirlos por los 256 prefijos SHA sin cambiar su identidad ni su
   evidencia. Las plantas individuales siguen en /done plano. */
const jobPath=(folder,id)=>folder==='world-done'
  ?join(DATA,folder,id.slice(0,2),id+'.json')
  :join(DATA,folder,id+'.json');
async function atomic(file,obj){
  const tmp=file+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify(obj,null,2)+'\n',{mode:0o600});
  await rename(tmp,file);
}
async function list(folder){
  const out=[];
  for(const filename of (await readdir(join(DATA,folder))).filter(f=>f.endsWith('.json')).sort()){
    try{out.push(JSON.parse(await readFile(join(DATA,folder,filename),'utf8')));}catch(_){}
  }return out;
}
export async function initStorage(){
  for(const f of folders)await mkdir(join(DATA,f),{recursive:true});
  for(const job of await list('running')){
    job.recovered_at=new Date().toISOString();
    await atomic(jobPath('pending',job.id),job);
    await unlink(jobPath('running',job.id)).catch(()=>{});
  }
}
/* Contrato idéntico al mapa: una petición "30 años" SE IDENTIFICA por
   los 30 años concretos. La cola no debe reutilizar el cálculo de
   1996–2025 cuando el calendario ya requiere 1997–2026. */
export function requestedYears(period,now=new Date()){
  const cutoff=now.getUTCFullYear()-1;
  if(period==='30')return [cutoff-29,cutoff];
  const y=Number(period);
  if(!Number.isInteger(y)||y<1940||y>cutoff)
    throw Error('Periodo inválido: año histórico aún no completo');
  return [y,y];
}
const profiles=new Set(['SP_45W_3Ah','SP_45W_6Ah','SP_60W_6Ah',
  'STRING_60W_3Ah','STRING_60W_6Ah','SP_45W_6Ah_LT','STRING_60W_6Ah_LT',
  'TNC_45W_3.8Ah','TNC_45W_6Ah','TNC_45W_8Ah',
  'TNC_60W_3.8Ah','TNC_60W_6Ah','TNC_60W_8Ah']);
export function normalizeJob(input,asOf=new Date()){
  if(!input||typeof input!=='object')throw Error('Trabajo vacío');
  const src=input.site||input;
  /* Number(null)==0 y Number('')==0: sin esta puerta, una planta sin
     coordenadas se convierte en 0,0 y aparenta un emplazamiento real. */
  if(src.lat==null||src.lon==null||
     String(src.lat).trim()===''||String(src.lon).trim()==='')
    throw Error('Coordenadas ausentes: no se puede asignar 0,0');
  const lat=Number(src.lat),lon=Number(src.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>=90||Math.abs(lon)>180)
    throw Error('Coordenadas no válidas');
  const profileId=String(input.profileId||'SP_45W_6Ah');
  if(!profiles.has(profileId))throw Error('Modelo de TCU desconocido');
  const period=String(input.period==null?'30':input.period);
  const yearRange=requestedYears(period,asOf);
  const panelW=input.panelW==null?null:Number(input.panelW);
  if(panelW!==null&&![30,45,60,90].includes(panelW))throw Error('Panel no válido');
  /* No se redondean coordenadas: siete decimales de la parcela real
     pueden cambiar el ángulo solar y romper paridad con batería.html. */
  const site={n:String(src.n||src.name||'Coordenadas').trim(),
    id:String(src.id||'custom:'+lat+':'+lon),
    lat,lon,fuente:String(src.fuente||'Coordenadas solicitadas').trim()};
  if(site.n.length>160||site.id.length>160||site.fuente.length>160)throw Error('Texto demasiado largo');
  /* Cualquier parámetro diferente crea OTRO trabajo y debe reproducirse
     byte a byte en el navegador headless. Nunca sobrescribir un escenario
     diferente por tener iguales coordenadas/modelo. */
  const signature=input.signature==null?null:String(input.signature);
  if(signature!==null&&(signature.length<16||signature.length>16000))
    throw Error('Firma de escenario inválida');
  if(signature!==null&&!input.scenario)
    throw Error('La firma exige parámetros de escenario completos');
  let scenario=null;
  if(input.scenario!=null){
    if(typeof input.scenario!=='object'||Array.isArray(input.scenario))
      throw Error('Escenario inválido');
    const names=['motorModel','soh','vientoStow','socTgt','socCrit',
      'fcDays','tMin','poaMin','mountTilt','strategy','winter','soc0','physics'];
    const obj=input.scenario;
    if(Object.keys(obj).some(k=>!names.includes(k)))
      throw Error('Campo de escenario desconocido');
    if(!Object.hasOwn(obj,'physics')||typeof obj.physics!=='object'||!obj.physics||
       Array.isArray(obj.physics))throw Error('Parámetros físicos ausentes');
    if(Object.keys(obj.physics).length>32)throw Error('Demasiados parámetros físicos');
    for(const [k,v] of Object.entries(obj.physics))
      if(!/^[A-Z][A-Z0-9_]{0,39}$/.test(k)||!Number.isFinite(v))
        throw Error('Parámetro físico inválido: '+k);
    for(const name of ['soh','socTgt','socCrit','fcDays','tMin','poaMin'])
      if(!Number.isFinite(obj[name]))throw Error('Escenario no finito: '+name);
    if(obj.mountTilt!=null&&!Number.isFinite(obj.mountTilt))
      throw Error('Inclinación no finita');
    if(obj.soc0!=null&&(!Number.isFinite(obj.soc0)||obj.soc0<0||obj.soc0>1))
      throw Error('SOC inicial inválido');
    if(typeof obj.vientoStow!=='string'||typeof obj.strategy!=='boolean'||
       typeof obj.winter!=='boolean')
      throw Error('Política de control inválida');
    if(!(typeof obj.motorModel==='string'||Number.isFinite(obj.motorModel)))
      throw Error('Motor inválido');
    scenario={...obj,physics:{...obj.physics}};
  }
  const id=hash(JSON.stringify([REVISION,site.lat,site.lon,profileId,period,
    yearRange,panelW,scenario,signature])).slice(0,24);
  /* Metadatos de la cola mundial. No tienen efecto en la física ni en el
     identificador del escenario, sólo permiten auditar de qué plan viene. */
  const world=input.world==null?null:input.world;
  if(world!==null&&(typeof world!=='object'||!['5','2','1'].includes(String(world.step))||
     !/^plan-[0-9]+-[0-9a-f]{16}-[0-9]{4}_[0-9]{4}-[0-9a-f]{12}\.json$/.test(String(world.plan||''))))
    throw Error('Origen de plan mundial inválido');
  return {id,revision:REVISION,site,profileId,period,yearRange,panelW,
    scenario,signature,world,attempts:0,created_at:new Date().toISOString()};
}
export async function enqueue(input){
  const job=normalizeJob(input);
  /* Un nodo fallido no se reencola automáticamente por aparecer también
     en otra resolución: requiere intervención o una revisión nueva. */
  for(const d of ['pending','running','done','world-done','failed']){
    if(existsSync(jobPath(d,job.id)))return {job,already:d};
  }
  await atomic(jobPath('pending',job.id),job);
  return {job,already:null};
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let meteoGate=Promise.resolve();
async function limitRequests(){
  const prev=meteoGate;let release;
  meteoGate=new Promise(r=>{release=r;});
  await prev;await pause(Math.max(1000,Number(process.env.METEO_GAP_MS)||2500));
  release();
}
async function historicLicensed(requestUrl){
  const input=new URL(requestUrl);
  if(input.hostname!=='archive-api.open-meteo.com'||input.pathname!=='/v1/archive')
    throw Error('API meteorológica no autorizada');
  const file=join(DATA,'meteo',hash(input.origin+input.pathname+input.search)+'.json');
  if(existsSync(file))return readFile(file,'utf8');
  if(!KEY)throw Error('Falta acceso histórico autorizado para uso comercial');
  const url=new URL('https://customer-archive-api.open-meteo.com/v1/archive');
  for(const [k,v] of input.searchParams)url.searchParams.append(k,v);
  url.searchParams.set('apikey',KEY);
  let error;
  for(let i=0;i<3;i++){
    await limitRequests();
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(90000)});
      if(!response.ok)throw Error('Fuente meteorológica HTTP '+response.status);
      const text=await response.text(),obj=JSON.parse(text);
      if(!Array.isArray(obj?.hourly?.time)||obj.hourly.time.length<24)
        throw Error('Serie meteorológica no válida');
      const temp=file+'.'+randomUUID()+'.tmp';
      await writeFile(temp,text,{mode:0o600});await rename(temp,file);
      return text;
    }catch(e){error=e;if(i<2)await pause((i+1)*10000);}
  }throw Error(error?.message||'Error meteorológico');
}
/* 170k escenarios no deben lanzar 170k procesos Chromium. Cada escenario
   usa un BrowserContext nuevo: cookies, localStorage, memoria y controles
   quedan aislados. El navegador se recicla tras un número acotado de
   trabajos para controlar acumulación de memoria. La fórmula energética
   sigue siendo EXCLUSIVAMENTE bateria.html. */
const MAX_BROWSER_JOBS=Math.min(100,Math.max(1,
  Number(process.env.BROWSER_RECYCLE_JOBS)||20));
let sharedBrowser=null,browserUses=0;
async function getWorkerBrowser(){
  if(sharedBrowser&&(!sharedBrowser.isConnected()||browserUses>=MAX_BROWSER_JOBS)){
    await sharedBrowser.close().catch(()=>{});
    sharedBrowser=null;browserUses=0;
  }
  if(!sharedBrowser){
    const {chromium}=await import('playwright');
    sharedBrowser=await chromium.launch({headless:true,
      args:['--disable-dev-shm-usage','--js-flags=--max-old-space-size=2048']});
  }
  browserUses++;
  return sharedBrowser;
}
async function compute(job){
  if(job.revision!==REVISION)
    throw Error('Trabajo de revisión antigua: reencolar con motor vigente');
  /* No arrancar una cola de 2026 con fecha 2027 ni mezclar resultados
     de periodos distintos en la misma etiqueta. */
  const expected=requestedYears(job.period);
  if(!Array.isArray(job.yearRange)||job.yearRange.length!==2||
     job.yearRange[0]!==expected[0]||job.yearRange[1]!==expected[1])
    throw Error('Trabajo histórico caducado por cambio de año; reencolar periodo vigente');
  const browser=await getWorkerBrowser();
  let context=null;
  try{
    /* Aislamiento real por trabajo, aunque compartan proceso Chromium. */
    context=await browser.newContext({viewport:{width:1200,height:800}});
    const weatherEvidence=[];
    await context.route(/^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?/,async route=>{
      try{const txt=await historicLicensed(route.request().url());
        weatherEvidence.push({request_hash:hash(route.request().url()),payload_hash:hash(txt)});
        await route.fulfill({status:200,contentType:'application/json',
          headers:{'access-control-allow-origin':'*'},body:txt});
      }catch(e){await route.fulfill({status:503,contentType:'application/json',
        headers:{'access-control-allow-origin':'*'},
        body:JSON.stringify({error:String(e.message)})});}
    });
    await context.route(/^https:\/\/tile\.openstreetmap\.org\//,r=>r.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+PORT+'/bateria.html',
      {waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>!!window.FACTIUN_MAPA_NAS,{timeout:30000});
    if(errors.length)throw Error('Error inicial del simulador: '+errors[0]);
    const record=await page.evaluate(async j=>window.FACTIUN_MAPA_NAS.run(j),job);
    weatherEvidence.sort((a,b)=>a.request_hash.localeCompare(b.request_hash));
    record.meteo_auditoria={fuente:'Open-Meteo histórica, API comercial',
      ficheros:weatherEvidence.length,
      sha256:hash(JSON.stringify(weatherEvidence)),
      detalle:'Hash compuesto de los datos horarios descargados, sin guardar la clave API'};
    return record;
  }finally{
    if(context)await context.close().catch(()=>{});
    if(!browser.isConnected()){sharedBrowser=null;browserUses=0;}
  }
}
/* Los errores de escenario/cobertura son definitivos. Reintentarlos tres
   veces volvería a usar recursos de la cola sin posibilidad de corregirlos
   mediante descargas meteorológicas. Las cuotas 429 y fallos de red sí
   siguen siendo reintentables. */
export function terminalJobError(message){
  return /^(?:Trabajo histórico caducado|Trabajo de revisión antigua|Diferencia de configuración NAS\/visor|Diferencia de firma al terminar|Perfil NAS no presente|Coordenadas NAS inválidas|Periodo NAS no reconocido)/.test(String(message||''));
}
/* Plan mundial sin limit=20: cola reanudable, con cantidad acotada de
   pendientes. Un plan completo ocupa UN fichero con cursor persistente;
   nunca se crean centenares de miles de JSON simultáneamente. */
const WORLD_BUFFER=Math.min(50,Math.max(1,Number(process.env.WORLD_QUEUE_BUFFER)||12));
const worldFile=name=>join(DATA,'world',name);
/* Pausa global como fichero SEPARADO: nunca se edita el manifiesto
   mientras el NAS actualiza el cursor, evitando perder avances por
   operaciones concurrentes entre terminal y contenedor. */
const WORLD_PAUSE_FILE=join(DATA,'world','PAUSED.json');
const worldPaused=()=>existsSync(WORLD_PAUSE_FILE);
/* Los manifiestos 1° contienen decenas de miles de puntos. El servidor
   no debe parsearlos cada 5 segundos: usa memoria de lectura cuyo origen
   de verdad sigue siendo siempre el JSON persistido en /data/world. */
const worldPlanCache=new Map();
async function readWorldPlan(name){
  const file=worldFile(name),info=await stat(file);
  const cached=worldPlanCache.get(name);
  if(cached&&cached.mtimeMs===info.mtimeMs&&cached.size===info.size)
    return cached.plan;
  const plan=JSON.parse(await readFile(file,'utf8'));
  worldPlanCache.set(name,{mtimeMs:info.mtimeMs,size:info.size,plan});
  return plan;
}
async function worldPlans(){
  const files=(await readdir(join(DATA,'world'))).filter(f=>
    /^plan-(5|2|1)-[0-9a-f]{16}-[0-9]{4}_[0-9]{4}-[0-9a-f]{12}\.json$/.test(f));
  const out=[];
  for(const name of files){
    try{
      const p=await readWorldPlan(name);
      if(p.schema!=='factiun.world-coverage.v1'||p.revision!==REVISION||
         !p.enabled||!Array.isArray(p.sites)||!Array.isArray(p.profiles)||p.cursor>p.total||
         p.total!==p.sites.length*p.profiles.length||p.step<=0)continue;
      const yrs=requestedYears(p.period);
      if(p.yearRange?.[0]!==yrs[0]||p.yearRange?.[1]!==yrs[1])continue;
      out.push({name,plan:p});
    }catch(_){}
  }
  return out.sort((a,b)=>b.plan.step-a.plan.step);
}
export async function fillWorldQueue(){
  if(!KEY||worldPaused())return;
  let backlog=(await readdir(join(DATA,'pending'))).filter(f=>f.endsWith('.json')).length+
              (await readdir(join(DATA,'running'))).filter(f=>f.endsWith('.json')).length;
  if(backlog>=WORLD_BUFFER)return;
  for(const {name,plan} of await worldPlans()){
    if(plan.cursor>=plan.total){
      /* No iniciar la etapa siguiente mientras queden trabajos activos
         de la etapa anterior. Los errores terminales cuentan como cerrados. */
      if(backlog>0)return;
      continue;
    }
    while(!worldPaused()&&backlog<WORLD_BUFFER&&plan.cursor<plan.total){
      const index=plan.cursor,at=Math.floor(index/plan.profiles.length),
        profileId=plan.profiles[index%plan.profiles.length],site=plan.sites[at];
      const q=await enqueue({site,profileId,period:plan.period,
        world:{step:plan.step,plan:name}});
      /* Atomicidad: primero el JSON pending/done; DESPUÉS se avanza
         el cursor. Tras un crash se reintenta y enqueue es idempotente. */
      plan.cursor++;
      await atomic(worldFile(name),plan);
      if(q.already===null)backlog++;
    }
    return;
  }
}
let running=false,snapshotCache=null,lowDiskNotice=false;
async function tick(){
  if(running||!KEY)return;
  /* El histórico global puede ocupar cientos de GB: reservar margen para
     el NAS y sus servicios. Sin espacio suficiente, PAUSAR la cola sin
     invalidar trabajos ni consumir reintentos de meteorología. */
  const capacity=await diskSpace();
  if(capacity.paused){
    if(!lowDiskNotice)console.error('Cola mundial pausada: libre '+
      capacity.free_gb+' GB, mínimo '+capacity.min_free_gb+' GB');
    lowDiskNotice=true;
    return;
  }
  lowDiskNotice=false;
  await fillWorldQueue();
  const pending=await list('pending'),paused=worldPaused();
  const job=pending.find(j=>
    (!paused||!j.world)&&(!j.retry_after||Date.parse(j.retry_after)<=Date.now()));
  if(!job)return;
  running=true;
  try{
    await rename(jobPath('pending',job.id),jobPath('running',job.id));
    const record=await compute(job);
    if(!record||!record.sig||!Array.isArray(record.results))throw Error('Simulador sin veredicto');
    if(job.world)await mkdir(join(DATA,'world-done',job.id.slice(0,2)),
      {recursive:true});
    await atomic(jobPath(job.world?'world-done':'done',job.id),
      {...job,record,completed_at:new Date().toISOString()});
    await unlink(jobPath('running',job.id));
    snapshotCache=null;
    console.log('NAS TCU: '+job.site.n+' · '+job.profileId+' · '+record.yearsOK+'/'+record.yearsAsked+' años');
  }catch(e){
    job.last_error=String(e.message).slice(0,450);
    const terminal=terminalJobError(job.last_error);
    job.attempts=terminal?Math.max(3,job.attempts+1):job.attempts+1;
    job.retry_after=terminal?null:new Date(Date.now()+job.attempts*600000).toISOString();
    await atomic(jobPath(job.attempts>=3?'failed':'pending',job.id),job);
    await unlink(jobPath('running',job.id)).catch(()=>{});
    console.error('NAS TCU trabajo '+job.id+': '+job.last_error);
  }finally{running=false;}
}
/* Cobertura mundial por ventana, nunca porcentajes inventados:
   las celdas sin evaluación son grises; los resultados solo se colorean
   con la MISMA firma que el simulador que los consulta. */
async function activeWorldCounts(){
  const alive=(await list('pending')).concat(await list('running'));
  const counts=new Map();
  for(const job of alive){
    const plan=job.world?.plan;
    if(plan)counts.set(plan,(counts.get(plan)||0)+1);
  }
  return counts;
}
export async function getWorldCoverage(query){
  const step=Number(query.get('step')||5),profileId=query.get('profile')||'SP_45W_6Ah';
  const period=query.get('period')||'30',control=query.get('control')||'std';
  const limit=Math.min(2500,Math.max(1,Number(query.get('limit')||1600)));
  if(![5,2,1].includes(step)||!profiles.has(profileId)||
     !['none','std','winter','cons','tnc'].includes(control))
    throw Error('Parámetros de cobertura mundial inválidos');
  const raw=(query.get('bounds')||'-90,-180,90,180').split(',').map(Number);
  if(raw.length!==4||raw.some(x=>!Number.isFinite(x))||raw[0]>=raw[2]||
     raw[1]>=raw[3]||raw[0]<-90||raw[2]>90||raw[1]<-180||raw[3]>180)
    throw Error('Ventana mundial fuera de rango');
  const yrs=requestedYears(period);
  const plans=await worldPlans(),active=await activeWorldCounts();
  const selected=plans.find(x=>x.plan.step===step&&
    x.plan.period===period&&x.plan.profiles.includes(profileId));
  const stages=plans.map(x=>({step:x.plan.step,cells:x.plan.sites.length,
    jobs:x.plan.total,assigned:x.plan.cursor,
    pending:(active.get(x.name)||0),
    closed:Math.max(0,x.plan.cursor-(active.get(x.name)||0)),
    years:x.plan.yearRange}));
  if(!selected)return {ok:true,configured:false,step,stages,nodes:[],
    note:'La cobertura global no está registrada todavía; no se inventan estados'};
  const plan=selected.plan;
  const candidates=plan.sites.filter(site=>
    site.lat>=raw[0]&&site.lat<=raw[2]&&site.lon>=raw[1]&&site.lon<=raw[3]);
  const items=[];
  for(const site of candidates.slice(0,limit)){
    const job=normalizeJob({site,profileId,period});
    let state='sin_evaluar',record=null;
    /* Si el mismo emplazamiento/modelo ya se calculó como planta en /done,
       reutilizamos exactamente esa evidencia; no duplicamos la fórmula ni
       damos por "sin evaluar" una simulación válida solo por su carpeta. */
    const resultFile=existsSync(jobPath('world-done',job.id))
      ?jobPath('world-done',job.id)
      :jobPath('done',job.id);
    if(existsSync(resultFile)){
      try{
        const done=JSON.parse(await readFile(resultFile,'utf8'));
        if(done.revision===REVISION&&done.record&&
           done.yearRange?.[0]===yrs[0]&&done.yearRange?.[1]===yrs[1]){
          state='calculado';record={sig:done.record.sig,
            weather:done.record.weather||null,
            yearsOK:done.record.yearsOK,yearsAsked:done.record.yearsAsked,
            result:done.record.results?.find(x=>x.k===control)||null};
        }
      }catch(_){}
    }else if(existsSync(jobPath('failed',job.id)))state='fallido';
    else if(existsSync(jobPath('running',job.id)))state='calculando';
    else if(existsSync(jobPath('pending',job.id)))state='en_cola';
    items.push({site,state,record});
  }
  return {ok:true,configured:true,paused:worldPaused(),step,period,control,profileId,
    years:yrs,stages,planned_cells:plan.sites.length,
    visible_cells:candidates.length,truncated:candidates.length>limit,
    nodes:items,
    note:'Nodos discretos; no significa que la superficie entre puntos esté evaluada'};
}
async function getSnapshot(){
  var utcCutoff=new Date().getUTCFullYear()-1;
  /* El caché de 10 segundos NO debe retener estudios de un rango
     diferente justo al cambiar el año UTC. */
  if(snapshotCache&&snapshotCache.cutoff===utcCutoff&&
     Date.now()-snapshotCache.time<10000)return snapshotCache.value;
  /* El snapshot no publica conclusiones obsoletas después de Año Nuevo,
     aunque siga existiendo su evidencia histórica en /data/done. */
  const items=(await list('done')).filter(j=>{
    if(j.revision!==REVISION||!j.record||!Array.isArray(j.yearRange))return false;
    try{const expected=requestedYears(j.period);
      return j.yearRange[0]===expected[0]&&j.yearRange[1]===expected[1];
    }catch(_){return false;}
  }).map(j=>({site:j.site,record:j.record,job_id:j.id}));
  const value={ok:true,revision:REVISION,items};
  snapshotCache={value,time:Date.now(),cutoff:utcCutoff};return value;
}
function json(res,status,obj){
  const buf=Buffer.from(JSON.stringify(obj));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'content-length':buf.length,'cache-control':'no-store',
    'x-content-type-options':'nosniff'});res.end(buf);
}
async function receive(req){
  const chunks=[];let size=0;
  for await(const b of req){size+=b.length;if(size>32768)throw Error('Entrada demasiado grande');chunks.push(b);}
  return JSON.parse(Buffer.concat(chunks).toString());
}
function authed(req){
  if(!TOKEN||!req.headers.origin)return false;
  try{if(new URL(req.headers.origin).host!==req.headers.host)return false;}catch(_){return false;}
  const a=Buffer.from(String(req.headers['x-factiun-token']||'')),b=Buffer.from(TOKEN);
  return a.length===b.length&&timingSafeEqual(a,b);
}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.css':'text/css','.json':'application/json','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.glb':'model/gltf-binary'};
async function staticFile(res,pathname){
  let decoded;
  try{decoded=decodeURIComponent(pathname);}catch(_){return json(res,400,{error:'Ruta inválida'});}
  if(decoded.includes('..')||decoded.includes('\\'))return json(res,403,{error:'Acceso denegado'});
  const relative=decoded==='/'?'bateria.html':decoded.replace(/^\/+/,'');
  if(!/^(?:bateria\.html|favicon\.svg|sim\/|lib\/|assets\/|nas\/viabilidad\/casos-tordesillas-chorzele-joya-dunedin\.json$)/.test(relative))
    return json(res,404,{error:'No encontrado'});
  const file=resolve(ROOT,relative);
  if(!file.startsWith(ROOT+sep)||!mime[extname(file).toLowerCase()])
    return json(res,404,{error:'No encontrado'});
  try{const b=await readFile(file);
    res.writeHead(200,{'content-type':mime[extname(file).toLowerCase()],
      'content-length':b.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(b);
  }catch(_){return json(res,404,{error:'No encontrado'});}
}
async function request(req,res){
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(req.method==='GET'&&path==='/api/mapa/health'){
    const count={};for(const d of ['pending','running','done','failed'])
      count[d]=(await readdir(join(DATA,d))).filter(x=>x.endsWith('.json')).length;
    const storage=await diskSpace();
    const alive=await activeWorldCounts();
    const world=(await worldPlans()).map(x=>({step:x.plan.step,
      nodes:x.plan.sites.length,total_jobs:x.plan.total,
      assigned_jobs:x.plan.cursor,
      closed_jobs:Math.max(0,x.plan.cursor-(alive.get(x.name)||0)),
      year_range:x.plan.yearRange}));
    return json(res,200,{ok:true,revision:REVISION,meteorologia:KEY?'licenciada':'pendiente_de_licencia',
      puede_encolar:UI_QUEUE&&!!TOKEN,counts:count,
      almacenamiento:storage,
      cobertura_mundial:{registrada:world.length>0,pausada:worldPaused(),etapas:world}});
  }
  if(req.method==='GET'&&path==='/api/mapa/snapshot')
    return json(res,200,await getSnapshot());
  if(req.method==='GET'&&path==='/api/mapa/world'){
    try{return json(res,200,await getWorldCoverage(url.searchParams));}
    catch(e){return json(res,400,{error:e.message});}
  }
  if(req.method==='POST'&&path==='/api/mapa/jobs'){
    if(!UI_QUEUE||!authed(req))return json(res,403,{error:'Cola no autorizada'});
    try{const r=await enqueue(await receive(req));return json(res,202,{ok:true,id:r.job.id,already:r.already});}
    catch(e){return json(res,400,{error:e.message});}
  }
  if(req.method==='GET')return staticFile(res,path);
  return json(res,405,{error:'Método no permitido'});
}
export async function start(){
  await initStorage();
  const server=createServer((req,res)=>request(req,res).catch(e=>json(res,500,{error:e.message})));
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(PORT,'0.0.0.0',ok);});
  console.log('NAS Factiun TCU '+PORT+' · '+REVISION+' · API '+(KEY?'con licencia':'sin licencia, cola detenida'));
  setInterval(()=>tick().catch(e=>console.error(e.message)),5000);
  await tick();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  start().catch(e=>{console.error(e);process.exitCode=1;});
