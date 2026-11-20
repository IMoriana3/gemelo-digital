/* Encola proyectos o rejilla terrestre. Solo escribe si se pasa --enqueue. */
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {ROOT,DATA,REVISION,requestedYears,enqueue,normalizeJob} from './service.mjs';
import {worldGrid,inLand,inPolygon,geometries,WORLD_LEVELS} from './mundo.mjs';
export {inLand} from './mundo.mjs';
const args=process.argv.slice(2);
const get=(key,fallback='')=>{const i=args.indexOf(key);return i<0?fallback:(args[i+1]||fallback);};
const has=key=>args.includes(key);
const profiles=get('--profiles','SP_45W_6Ah,STRING_60W_6Ah,SP_45W_6Ah_LT,STRING_60W_6Ah_LT,TNC_45W_6Ah')
  .split(',').map(s=>s.trim()).filter(Boolean);
const period=get('--period','30'),limit=Number(get('--limit','0')),step=Number(get('--grid','0'));
async function land(){
 const file=join(DATA,'ne_110m_land.geojson');
 if(!existsSync(file)){
   if(!has('--download-land'))throw Error('Falta la máscara de tierra; añade --download-land.');
   const u='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson';
   const r=await fetch(u,{signal:AbortSignal.timeout(60000)});
   if(!r.ok)throw Error('No se pudo obtener Natural Earth: HTTP '+r.status);
   const data=await r.text();
   if(JSON.parse(data).type!=='FeatureCollection')throw Error('GeoJSON de tierra inválido');
   await mkdir(DATA,{recursive:true});await writeFile(file,data);
 }
 return JSON.parse(await readFile(file,'utf8'));
}
async function cartera(){
 /* cartera.js expone la autoridad por module.exports/window.CARTERA, no
    context.CARTERA: la IIFE guarda su var como local. */
 const context={module:{exports:{}}};
 runInNewContext(await readFile(join(ROOT,'sim/cartera.js'),'utf8'),context);
 const catalog=context.module.exports;
 if(!catalog||!Array.isArray(catalog.plantas)||typeof catalog.rotulo!=='function')
   throw Error('La cartera canónica no se ha podido cargar');
 let index=0;
 return catalog.plantas.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon))
   .map(p=>({id:'portfolio:'+(index++),codigo:p.num,n:catalog.rotulo(p),lat:p.lat,lon:p.lon,
      fuente:p.fuente||'Cartera Factiun'}));
}
/* Lotes específicos: admiten coordenadas públicas de ciudad o un código de
   cartera para tomar la geometría ORIGINAL, sin copiarla a otro catálogo. */
async function fileSites(){
 const relative=get('--sites');
 if(!relative)return [];
 const path=resolve(ROOT,relative);
 if(!path.startsWith(ROOT+'/'))throw Error('--sites debe estar dentro del repositorio');
 const entries=JSON.parse(await readFile(path,'utf8'));
 if(!Array.isArray(entries)||!entries.length)throw Error('--sites requiere una lista JSON no vacía');
 const portfolio=await cartera();
 return entries.map((item,i)=>{
   if(item.cartera_num!=null){
     const matches=portfolio.filter(p=>p.codigo===String(item.cartera_num));
     if(matches.length!==1)throw Error('Código de cartera sin coincidencia única: '+item.cartera_num);
     const p=matches[0];
     return {...p,n:item.n||p.n};
   }
   const site={id:item.id||'caso:'+i,n:String(item.n||'Emplazamiento '+(i+1)),
     lat:Number(item.lat),lon:Number(item.lon),
     fuente:String(item.fuente||'Referencia indicada, sin parcela')};
   normalizeJob({site,profileId:profiles[0],period}); // validación canónica
   return site;
 });
}
async function grid(){
 if(!Number.isFinite(step)||step<=0||step>20)throw Error('--grid requiere paso 0–20 grados');
 const bounds=get('--bounds','-85,-180,85,180').split(',').map(Number);
 if(bounds.length!==4||bounds.some(v=>!Number.isFinite(v)))throw Error('--bounds latMin,lonMin,latMax,lonMax');
 const mask=await land(),res=[];
 for(let lat=-90+step/2;lat<90;lat+=step){
   if(lat<bounds[0]||lat>bounds[2])continue;
   for(let lon=-180+step/2;lon<180;lon+=step){
     if(lon<bounds[1]||lon>bounds[3]||!inLand(lon,lat,mask))continue;
     res.push({id:'grid:'+step+':'+lat.toFixed(3)+':'+lon.toFixed(3),
       n:'Rejilla '+step+'° · '+lat.toFixed(2)+', '+lon.toFixed(2),
       lat,lon,fuente:'Natural Earth 1:110m, punto exploratorio; no representa una parcela'});
   }
 }return res;
}
/* El alcance GLOBAL no se reduce a los primeros 20 nodos. Se genera
   un MANIFIESTO persistente para cada nivel 5° -> 2° -> 1° de toda la
   tierra reconocida por Natural Earth 1:10m, incluyendo islas pequeñas.
   El servidor dosifica sus trabajos a la cola según capacidad disponible. */
async function worldMask(){
  const dir=join(DATA,'world'),file=join(dir,'ne_10m_land.geojson');
  if(!existsSync(file)){
    if(!has('--download-land'))throw Error('Falta máscara mundial de 10m: añade --download-land');
    const u='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson';
    const r=await fetch(u,{signal:AbortSignal.timeout(120000)});
    if(!r.ok)throw Error('Natural Earth 10m: HTTP '+r.status);
    const value=await r.text();
    if(value.length<100000||value.length>35000000||
       JSON.parse(value).type!=='FeatureCollection')
      throw Error('Máscara mundial Natural Earth 10m inválida');
    await mkdir(dir,{recursive:true});
    await writeFile(file,value);
  }
  const bytes=await readFile(file,'utf8'),mask=JSON.parse(bytes);
  if(mask.type!=='FeatureCollection')throw Error('Máscara mundial corrupta');
  return {mask,sha256:createHash('sha256').update(bytes).digest('hex')};
}
// IRENA 2026: capacidad fotovoltaica acumulada a cierre de 2025.
const PV_PRIORITY=['CHN','USA','IND','DEU','JPN','BRA','ESP','AUS','ITA','KOR'];
function priorityCountries(geo){
  if(geo.type!=='FeatureCollection')throw Error('Límites de países inválidos');
  return PV_PRIORITY.map(code=>{
    const features=geo.features.filter(f=>f.properties?.ISO_A3_EH===code);
    if(!features.length)throw Error('País prioritario ausente en Natural Earth: '+code);
    return {code,polygons:geometries({type:'FeatureCollection',features})};
  });
}
function prioritizeSites(sites,countries){
  const buckets=new Map(countries.map(({code})=>[code,[]]));
  const remaining=[];
  for(const site of sites){
    const {lat,lon}=site;
    const country=countries.find(({polygons})=>polygons.some(({bb,rings})=>
      lon>=bb.xmin&&lon<=bb.xmax&&lat>=bb.ymin&&lat<=bb.ymax&&inPolygon(lon,lat,rings)));
    (country?buckets.get(country.code):remaining).push(site);
  }
  return {sites:[...Array.from(buckets.values()).flat(),...remaining],
    counts:Object.fromEntries([...buckets].map(([code,nodes])=>[code,nodes.length]))};
}
async function worldCountries(){
  const file=join(DATA,'world','ne_10m_admin_0_countries.geojson');
  if(!existsSync(file)){
    if(!has('--download-land'))throw Error('Faltan límites de países; añade --download-land');
    const url='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
    const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error('Límites Natural Earth: HTTP '+response.status);
    const bytes=await response.text();
    priorityCountries(JSON.parse(bytes));
    await mkdir(join(DATA,'world'),{recursive:true});
    const temp=file+'.'+randomUUID()+'.tmp';
    await writeFile(temp,bytes);
    await rename(temp,file);
  }
  const bytes=await readFile(file,'utf8');
  return {countries:priorityCountries(JSON.parse(bytes)),
    country_mask_sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function worldPlan(){
  const mode=get('--world','');
  if(!['all','5','2','1'].includes(mode))
    throw Error('--world admite all, 5, 2 o 1 (grados)');
  if(get('--sites')||has('--cartera')||step||limit)
    throw Error('--world no admite --sites, --cartera, --grid ni --limit: no se recorta el planeta');
  if(has('--enqueue')&&!has('--confirm-world'))
    throw Error('Para registrar toda la Tierra añade --confirm-world');
  const {mask,sha256}=await worldMask();
  const {countries,country_mask_sha256}=await worldCountries();
  const levels=mode==='all'?WORLD_LEVELS:[Number(mode)];
  const yearRange=requestedYears(period);
  const profHash=createHash('sha256').update(JSON.stringify(profiles)).digest('hex').slice(0,12);
  const tasks=[],results=[];
  for(const level of levels){
    const geo=worldGrid(mask,level);
    const {sites,counts}=prioritizeSites(geo.nodes,countries);
    const count=sites.length,work=count*profiles.length;
    const name='plan-'+String(level).replace('.','p')+'-'+REVISION+'-'+yearRange.join('_')+'-'+profHash+'.json';
    const file=join(DATA,'world',name);
    const plan={
      schema:'factiun.world-coverage.v1',revision:REVISION,mask_sha256:sha256,
      source:'Natural Earth 1:10m land polygons, public domain',
      step:level,period,yearRange,profiles,sites,
      country_mask_sha256,pv_priority:PV_PRIORITY,pv_capacity_year:2025,
      pv_capacity_source:'https://ourworldindata.org/grapher/solar-pv-cumulative-capacity',
      total:work,cursor:0,enabled:true,created_at:new Date().toISOString(),
      disclaimer:'EXPLORACIÓN GLOBAL: las celdas no están certificadas ni interpoladas'
    };
    results.push({step:level,sitios:count,trabajos:work,nodos_paises_prioritarios:counts,
      peticiones_historicas_sin_cache:count*(period==='30'?30:1)*2,
      comprobaciones_geometricas:geo.candidateChecks,
      detalle:'Un nodo terrestre por celda con tierra detectable a 1:10m'});
    tasks.push({file,plan});
  }
  if(has('--enqueue')){
    await mkdir(join(DATA,'world'),{recursive:true});
    for(const {file,plan} of tasks){
      if(existsSync(file)){
        const prev=JSON.parse(await readFile(file,'utf8'));
        if(prev.schema!==plan.schema||prev.revision!==plan.revision||
           prev.mask_sha256!==plan.mask_sha256||prev.total!==plan.total||
           JSON.stringify(prev.profiles)!==JSON.stringify(plan.profiles))
          throw Error('Plan previo incompatible: no se sobrescribe '+file);
        if(JSON.stringify(prev.pv_priority)!==JSON.stringify(plan.pv_priority)||
           prev.country_mask_sha256!==plan.country_mask_sha256)
          throw Error('El plan ya registrado tiene otro orden. Se conserva su cursor: '+file);
        continue; // --enqueue idempotente, no reinicia el cursor ni el progreso
      }
      const temp=file+'.'+randomUUID()+'.tmp';
      await writeFile(temp,JSON.stringify(plan)+'\n',{mode:0o600});
      const {rename}=await import('node:fs/promises');
      await rename(temp,file);
    }
  }
  console.log(JSON.stringify({
    modo:has('--enqueue')?'PLAN MUNDIAL REGISTRADO · ejecución NAS automática con licencia':'VISTA PREVIA GLOBAL · sin cálculos',
    cobertura:'todas las celdas terrestres detectables por Natural Earth 1:10m; no áreas certificadas',
    mascara_sha256:sha256,prioridad_fv_2025:PV_PRIORITY,periodo:yearRange,perfiles:profiles,
    etapas:results,
    total_nodos:results.reduce((n,x)=>n+x.sitios,0),
    total_trabajos:results.reduce((n,x)=>n+x.trabajos,0),
    peticiones_meteo_sin_cache:results.reduce((n,x)=>n+x.peticiones_historicas_sin_cache,0),
    espera_meteo_teorica_dias_sin_cache:(function(){
      const calls=results.reduce((n,x)=>n+x.peticiones_historicas_sin_cache,0);
      const gap=Math.max(1000,Number(process.env.METEO_GAP_MS)||2500);
      return Math.round(calls*gap/86400000*10)/10;
    })(),
    advertencia_capacidad:'La espera teórica solo contempla el intervalo entre peticiones sin caché; no incluye descargas, cálculos TCU, límites comerciales ni reintentos. No es un plazo de ejecución.',
    declaracion:'NINGÚN SOC CALCULADO: se requieren licencia, ejecución NAS y revisión de resultados'
  },null,2));
}
/* Pausa sin riesgo de perder el cursor: el indicador vive en fichero
   independiente. El trabajo que ya se está ejecutando termina, pero el
   servidor no iniciará ni encolará otro mundial hasta reanudar. */
async function worldPauseControl(){
  const pause=has('--pause-world'),resume=has('--resume-world');
  if(pause===resume)throw Error('Selecciona solo --pause-world o --resume-world');
  if(resume&&!has('--confirm-world'))
    throw Error('Para reanudar la cobertura mundial añade --confirm-world');
  const file=join(DATA,'world','PAUSED.json');
  await mkdir(join(DATA,'world'),{recursive:true});
  if(pause){
    const temp=file+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify({paused_at:new Date().toISOString(),
      reason:'Pausa manual de operador · los trabajos activos no se cancelan'})+'\n',{mode:0o600});
    await rename(temp,file);
  }else await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
  console.log(JSON.stringify({
    accion:pause?'COBERTURA MUNDIAL PAUSADA':'COBERTURA MUNDIAL REANUDADA',
    pausada:pause,
    seguridad:'El manifiesto y su cursor no se modifican; no se generan nuevos resultados'
  },null,2));
}
async function main(){
 if(has('--pause-world')||has('--resume-world'))return worldPauseControl();
 if(get('--world'))return worldPlan();
 if(!has('--cartera')&&!step&&!get('--sites'))throw Error('Especifica --cartera, --sites archivo.json o --grid 5');
 if(limit&&(!Number.isInteger(limit)||limit<1))throw Error('--limit requiere entero positivo');
 /* Una vista previa NUNCA recupera trabajos running. La recuperación tras
    reinicio pertenece exclusivamente al servidor; de otro modo una preview
    desde otra terminal movería el trabajo en ejecución a pending y podría
    producir doble cálculo del mismo emplazamiento. */
 if(has('--enqueue')){
   for(const folder of ['pending','running','done','failed','meteo'])
     await mkdir(join(DATA,folder),{recursive:true});
 }
 const sites=[...(has('--cartera')?await cartera():[]),...(get('--sites')?await fileSites():[]),
   ...(step?await grid():[])];
 const seen=new Set();
 let unique=sites.filter(s=>{const k=String(s.lat)+','+String(s.lon);
   if(seen.has(k))return false;seen.add(k);return true;});
 if(limit)unique=unique.slice(0,limit);
 const jobs=[];
 for(const site of unique)for(const profileId of profiles)
   jobs.push(normalizeJob({site,profileId,period}));
 console.log(JSON.stringify({
   modo:has('--enqueue')?'EN COLA':'SOLO VISTA PREVIA',
   ubicaciones:unique.length,emplazamientos:unique.map(s=>({nombre:s.n,lat:s.lat,lon:s.lon,
      fuente:s.fuente})),perfiles:profiles.length,trabajos:jobs.length,
   consultas_meteo_unicas_sin_cache:unique.length*(period==='30'?30:1)*2,
   meteo:'Se requiere licencia comercial. No se calculan zonas entre nodos.'
 },null,2));
 if(!has('--enqueue'))return;
 if(jobs.length>200&&!has('--confirm-large'))
   throw Error('Lote de más de 200: limita nodos o añade --confirm-large');
 let added=0,already=0;
 for(const job of jobs){const q=await enqueue(job);if(q.already)already++;else added++;}
 console.log('Encolados '+added+' · existentes '+already);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error(e.message);process.exitCode=1;});
