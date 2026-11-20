/* Factiun TCU worldwide · NAS service
 * Chromium executes bateria.html: no new battery formulas.
 * Runs serially; JSON checkpoints survive Synology restarts.
 */
import {createServer} from 'node:http';
import {readFile,writeFile,rename,readdir,unlink,mkdir} from 'node:fs/promises';
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
export const REVISION=createHash('sha256').update(
  ['bateria.html','sim/mapa-viabilidad.js','sim/fisica.js','sim/viento.js',
   'sim/canon.js','sim/cartera.js','pines.json',
   'nas/viabilidad/service.mjs','nas/viabilidad/seed.mjs']
  .map(f=>readFileSync(join(ROOT,f))).reduce((a,b)=>Buffer.concat([a,b]),Buffer.alloc(0))
).digest('hex').slice(0,16);
const hash=s=>createHash('sha256').update(s).digest('hex');
const folders=['pending','running','done','failed','meteo'];
const jobPath=(folder,id)=>join(DATA,folder,id+'.json');
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
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>89||Math.abs(lon)>180)
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
  return {id,revision:REVISION,site,profileId,period,yearRange,panelW,
    scenario,signature,attempts:0,created_at:new Date().toISOString()};
}
export async function enqueue(input){
  const job=normalizeJob(input);
  for(const d of ['pending','running','done']){
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
async function compute(job){
  /* No arrancar una cola de 2026 con fecha 2027 ni mezclar resultados
     de periodos distintos en la misma etiqueta. */
  const expected=requestedYears(job.period);
  if(!Array.isArray(job.yearRange)||job.yearRange.length!==2||
     job.yearRange[0]!==expected[0]||job.yearRange[1]!==expected[1])
    throw Error('Trabajo histórico caducado por cambio de año; reencolar periodo vigente');
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,
    args:['--disable-dev-shm-usage','--js-flags=--max-old-space-size=2048']});
  try{
    const context=await browser.newContext({viewport:{width:1200,height:800}});
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
  }finally{await browser.close();}
}
/* Los errores de escenario/cobertura son definitivos. Reintentarlos tres
   veces volvería a usar recursos de la cola sin posibilidad de corregirlos
   mediante descargas meteorológicas. Las cuotas 429 y fallos de red sí
   siguen siendo reintentables. */
export function terminalJobError(message){
  return /^(?:Trabajo histórico caducado|Diferencia de configuración NAS\/visor|Diferencia de firma al terminar|Perfil NAS no presente|Coordenadas NAS inválidas|Periodo NAS no reconocido)/.test(String(message||''));
}
let running=false,snapshotCache=null;
async function tick(){
  if(running||!KEY)return;
  const pending=await list('pending');
  const job=pending.find(j=>!j.retry_after||Date.parse(j.retry_after)<=Date.now());
  if(!job)return;
  running=true;
  try{
    await rename(jobPath('pending',job.id),jobPath('running',job.id));
    const record=await compute(job);
    if(!record||!record.sig||!Array.isArray(record.results))throw Error('Simulador sin veredicto');
    await atomic(jobPath('done',job.id),{...job,record,completed_at:new Date().toISOString()});
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
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&path==='/api/mapa/health'){
    const count={};for(const d of ['pending','running','done','failed'])count[d]=(await list(d)).length;
    return json(res,200,{ok:true,revision:REVISION,meteorologia:KEY?'licenciada':'pendiente_de_licencia',
      puede_encolar:UI_QUEUE&&!!TOKEN,counts:count});
  }
  if(req.method==='GET'&&path==='/api/mapa/snapshot')
    return json(res,200,await getSnapshot());
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
