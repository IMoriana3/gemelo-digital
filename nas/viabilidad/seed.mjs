/* Encola proyectos o rejilla terrestre. Solo escribe si se pasa --enqueue. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {ROOT,DATA,initStorage,enqueue,normalizeJob} from './service.mjs';
const args=process.argv.slice(2);
const get=(key,fallback='')=>{const i=args.indexOf(key);return i<0?fallback:(args[i+1]||fallback);};
const has=key=>args.includes(key);
const profiles=get('--profiles','SP_45W_6Ah,STRING_60W_6Ah,SP_45W_6Ah_LT,STRING_60W_6Ah_LT,TNC_45W_6Ah')
  .split(',').map(s=>s.trim()).filter(Boolean);
const period=get('--period','30'),limit=Number(get('--limit','0')),step=Number(get('--grid','0'));
function inRing(x,y,ring){let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const a=ring[i],b=ring[j];
   if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;
}
function inPolygon(x,y,rings){return rings.length>0&&inRing(x,y,rings[0])&&!rings.slice(1).some(r=>inRing(x,y,r));}
export function inLand(x,y,collection){
 const features=collection.type==='FeatureCollection'?collection.features:[{geometry:collection.geometry||collection}];
 return features.some(f=>{const g=f.geometry;if(!g)return false;
   if(g.type==='Polygon')return inPolygon(x,y,g.coordinates);
   if(g.type==='MultiPolygon')return g.coordinates.some(poly=>inPolygon(x,y,poly));
   return false;
 });
}
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
 const context={};
 runInNewContext(await readFile(join(ROOT,'sim/cartera.js'),'utf8'),context);
 let index=0;
 return (context.CARTERA.plantas||[]).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon))
   .map(p=>({id:'portfolio:'+(index++),n:context.CARTERA.rotulo(p),lat:p.lat,lon:p.lon,
      fuente:p.fuente||'Cartera Factiun'}));
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
async function main(){
 if(!has('--cartera')&&!step)throw Error('Especifica --cartera o --grid 5');
 if(limit&&(!Number.isInteger(limit)||limit<1))throw Error('--limit requiere entero positivo');
 await initStorage();
 const sites=[...(has('--cartera')?await cartera():[]),...(step?await grid():[])];
 const seen=new Set();
 let unique=sites.filter(s=>{const k=s.lat.toFixed(6)+','+s.lon.toFixed(6);
   if(seen.has(k))return false;seen.add(k);return true;});
 if(limit)unique=unique.slice(0,limit);
 const jobs=[];
 for(const site of unique)for(const profileId of profiles)
   jobs.push(normalizeJob({site,profileId,period}));
 console.log(JSON.stringify({
   modo:has('--enqueue')?'EN COLA':'SOLO VISTA PREVIA',
   ubicaciones:unique.length,perfiles:profiles.length,trabajos:jobs.length,
   consultas_meteo_unicas_sin_cache:unique.length*(period==='30'?30:1),
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
