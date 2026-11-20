#!/usr/bin/env node
import assert from 'node:assert/strict';
import {normalizeJob,requestedYears,terminalJobError,REVISION} from '../nas/viabilidad/service.mjs';
import {inLand} from '../nas/viabilidad/seed.mjs';
import {worldGrid,WORLD_LEVELS} from '../nas/viabilidad/mundo.mjs';
const j=normalizeJob({site:{n:'Prueba',lat:41.576342,lon:-0.798139},profileId:'SP_45W_6Ah',period:'30'});
assert.equal(j.revision,REVISION);
assert.equal(terminalJobError('Trabajo histórico caducado por cambio de año; reencolar periodo vigente'),true);
assert.equal(terminalJobError('Diferencia de configuración NAS/visor: trabajo rechazado'),true);
assert.equal(terminalJobError('Diferencia de firma al terminar: resultado descartado'),true);
assert.equal(terminalJobError('Fuente meteorológica HTTP 429'),false);
assert.equal(terminalJobError('Fuente meteorológica HTTP 503'),false);
assert.equal(terminalJobError('Error meteorológico: timeout'),false);
assert.deepEqual(requestedYears('30',new Date('2026-12-31T23:59:59Z')),[1996,2025]);
assert.deepEqual(requestedYears('30',new Date('2027-01-01T00:00:00Z')),[1997,2026]);
assert.deepEqual(requestedYears('2024',new Date('2026-01-01T00:00:00Z')),[2024,2024]);
assert.throws(()=>requestedYears('2026',new Date('2026-01-01T00:00:00Z')),/Periodo inválido/);
const atEnd2026=normalizeJob({site:{lat:41.5,lon:-5},period:'30'},
  new Date('2026-12-31T23:59:59Z'));
const atStart2027=normalizeJob({site:{lat:41.5,lon:-5},period:'30'},
  new Date('2027-01-01T00:00:00Z'));
assert.deepEqual(atEnd2026.yearRange,[1996,2025]);
assert.deepEqual(atStart2027.yearRange,[1997,2026]);
assert.notEqual(atEnd2026.id,atStart2027.id,
  'La cola no puede deduplicar 1996–2025 con 1997–2026');
assert.equal(j.site.lat,41.576342);
assert.equal(j.id,normalizeJob({site:{n:'Otro',lat:41.576342,lon:-0.798139},profileId:'SP_45W_6Ah',period:'30'}).id);
assert.notEqual(j.id,normalizeJob({site:j.site,profileId:'STRING_60W_6Ah',period:'30'}).id);
assert.throws(()=>normalizeJob({site:{lat:150,lon:0}}),/Coordenadas/);
assert.throws(()=>normalizeJob({site:{lat:null,lon:0}}),/Coordenadas ausentes/);
assert.throws(()=>normalizeJob({site:{lat:'',lon:' '}}),/Coordenadas ausentes/);
assert.throws(()=>normalizeJob({site:{lat:undefined,lon:42}}),/Coordenadas ausentes/);
assert.throws(()=>normalizeJob({site:{lat:42,lon:null}}),/Coordenadas ausentes/);
assert.throws(()=>normalizeJob({site:{lat:42,lon:0},period:0}),/Periodo inválido/);
assert.equal(normalizeJob({site:{lat:0,lon:0}}).site.lat,0,
  'La coordenada 0 explícita sí es válida; la ausente no');
assert.throws(()=>normalizeJob({site:{lat:40,lon:0},period:2030}),/Periodo/);
/* Las coordenadas de una planta tienen más de 6 decimales y NO se recortan. */
const exactSite={n:'San José',lat:-16.5957735,lon:-71.8064406};
const precise=normalizeJob({site:exactSite,profileId:'SP_45W_6Ah',period:'30'});
assert.equal(precise.site.lat,exactSite.lat);
assert.equal(precise.site.lon,exactSite.lon);
assert.notEqual(precise.id,normalizeJob({site:{...exactSite,lat:-16.595773},profileId:'SP_45W_6Ah',period:'30'}).id);
/* La cola rechaza una firma sin ajustes y no deduplica escenarios distintos. */
const scenario={motorModel:'curva',soh:0.8,vientoStow:'racha',
  socTgt:80,socCrit:30,fcDays:5,tMin:0,poaMin:0,
  mountTilt:null,strategy:true,winter:false,soc0:null,physics:{}};
const sig='escenario-completo-paridad-2026';
const job1=normalizeJob({site:exactSite,profileId:'SP_45W_6Ah',period:'30',scenario,signature:sig});
const job2=normalizeJob({site:exactSite,profileId:'SP_45W_6Ah',period:'30',
  scenario:{...scenario,socCrit:40},signature:sig});
assert.equal(job1.signature,sig);
assert.notEqual(job1.id,job2.id);
assert.throws(()=>normalizeJob({site:exactSite,signature:sig}),/firma exige parámetros/i);
assert.throws(()=>normalizeJob({site:exactSite,scenario:{...scenario,soh:NaN},signature:sig}),/no finito/);
assert.throws(()=>normalizeJob({site:exactSite,scenario:{...scenario,physics:{otra:-1}},signature:sig}),/físico inválido/);

const land={type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[
  [[-3,40],[3,40],[3,44],[-3,44],[-3,40]],[[0,41],[1,41],[1,42],[0,42],[0,41]]
]}}]};
assert.equal(inLand(-2,41,land),true);
assert.equal(inLand(0.5,41.5,land),false);
assert.equal(inLand(10,40,land),false);
/* Mundo entero: no sólo 20 puntos. El generador debe recuperar islotes
   menores de la celda y conservar N/S, costas, polos y agujeros (lagos). */
const island=(x,y,d)=>[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]];
const mockWorld={type:'FeatureCollection',features:[
  {geometry:{type:'Polygon',coordinates:[island(-5,41.5,0.012)]}},
  {geometry:{type:'Polygon',coordinates:[island(175,-17.5,0.012)]}},
  {geometry:{type:'Polygon',coordinates:[island(45,-89.5,0.022)]}},
  {geometry:{type:'Polygon',coordinates:[island(-30,78.5,0.022)]}},
  {geometry:{type:'Polygon',coordinates:[island(20,10,2),
    island(20,10,0.75)]}}
]};
assert.deepEqual(WORLD_LEVELS,[5,2,1]);
for(const level of WORLD_LEVELS){
  const grid=worldGrid(mockWorld,level);
  assert.ok(grid.nodes.length>=4,'Debe conservar cuatro regiones, paso '+level);
  const pts=grid.nodes.map(x=>[x.lon,x.lat]);
  assert.ok(pts.some(([x,y])=>Math.abs(x+5)<0.025&&Math.abs(y-41.5)<0.025));
  assert.ok(pts.some(([x,y])=>Math.abs(x-175)<0.025&&Math.abs(y+17.5)<0.025));
  assert.ok(pts.some(([x,y])=>Math.abs(x-45)<0.03&&Math.abs(y+89.5)<0.03));
  assert.ok(pts.some(([x,y])=>Math.abs(x+30)<0.03&&Math.abs(y-78.5)<0.03));
  for(const node of grid.nodes){
    assert.equal(inLand(node.lon,node.lat,mockWorld),true,
      'No se permite crear un nodo sin tierra');
    assert.ok(Math.abs(node.lat)<90&&Math.abs(node.lon)<=180);
    assert.ok(node.id.startsWith('grid:'+level+':'));
  }
  assert.deepEqual(worldGrid(mockWorld,level).nodes,grid.nodes,
    'La rejilla mundial ha de ser estable para poder reanudar');
}
const hasHole=worldGrid(mockWorld,1).nodes.some(node=>
  node.lat>9.4&&node.lat<10.6&&node.lon>19.4&&node.lon<20.6);
assert.equal(hasHole,false,'Nunca se califica un lago como tierra');
/* Cuatro ubicaciones reproducibles: San José sale de la CARTERA, no de una
   coordenada duplicada; las otras tres son puntos urbanos provisionales. */
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const preview=JSON.parse(execFileSync(process.execPath,[
  'nas/viabilidad/seed.mjs','--sites',
  'nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json',
  '--period','30'
],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'}));
assert.equal(preview.modo,'SOLO VISTA PREVIA');
assert.equal(preview.ubicaciones,4);
assert.equal(preview.trabajos,20); // cinco equipos × cuatro ubicaciones
assert.equal(preview.consultas_meteo_unicas_sin_cache,240);
assert.equal(preview.emplazamientos[2].lat,-16.5957735);
assert.equal(preview.emplazamientos[2].lon,-71.8064406);
assert.match(preview.emplazamientos[2].fuente,/layout:sanjose/);
assert.match(preview.emplazamientos[0].fuente,/NO parcela/);
assert.match(preview.emplazamientos[1].fuente,/NO parcela/);
assert.match(preview.emplazamientos[3].fuente,/NO parcela/);
/* Regresión operativa: una VISTA PREVIA jamás mueve el JSON de running a
   pending. Ese movimiento pertenece únicamente a la recuperación del
   servidor tras un reinicio, no a un segundo proceso que ejecuta seed. */
const scratch=mkdtempSync(join(tmpdir(),'factiun-nas-preview-'));
try {
  mkdirSync(join(scratch,'running'),{recursive:true});
  const running=join(scratch,'running','trabajo-activo.json');
  writeFileSync(running,JSON.stringify({id:'trabajo-activo',status:'running'}));
  execFileSync(process.execPath,[
    'nas/viabilidad/seed.mjs','--sites',
    'nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json',
    '--period','30'
  ],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',
     env:{...process.env,FACTIUN_MAPA_DATA:scratch}});
  assert.equal(existsSync(running),true,
    'Una preview debe preservar el trabajo que está corriendo');
  assert.equal(existsSync(join(scratch,'pending','trabajo-activo.json')),false);
  assert.equal(existsSync(join(scratch,'pending')),false,
    'La preview tampoco debe crear carpetas de cola');
} finally {rmSync(scratch,{recursive:true,force:true});}
/* Smoke HTTP real: servidor de Synology sin clave ni API externa.
   El JSON canónico de casos es legible en el mapa, pero el código de
   servicio y los ejemplos de secretos no son públicos. */
import {createServer} from 'node:http';
const srvData=mkdtempSync(join(tmpdir(),'factiun-nas-http-'));
/* Dos evidencias antiguas en disco NO son intercambiables: el resultado
   del periodo vigente se publica, el del rango anterior se conserva
   en /data/done para auditoría, pero nunca aparece como vigente. */
mkdirSync(join(srvData,'done'),{recursive:true});
const fresh=normalizeJob({site:{n:'Corte vigente',lat:41.5,lon:-5},
  profileId:'SP_45W_6Ah',period:'30'});
const oldYears=[fresh.yearRange[0]-1,fresh.yearRange[1]-1];
writeFileSync(join(srvData,'done','antiguo.json'),JSON.stringify({
  ...fresh,id:'antiguo',yearRange:oldYears,
  record:{sig:'resultado-obsoleto',results:[{k:'std',status:'apto'}]}
}));
writeFileSync(join(srvData,'done','vigente.json'),JSON.stringify({
  ...fresh,id:'vigente',
  record:{sig:'resultado-vigente',results:[{k:'std',status:'apto'}]}
}));
const probe=createServer();
await new Promise((ok,fail)=>{probe.once('error',fail);probe.listen(0,'127.0.0.1',ok);});
const port=probe.address().port;
await new Promise(ok=>probe.close(ok));
const child=spawn(process.execPath,['nas/viabilidad/service.mjs'],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),
  env:{...process.env,FACTIUN_MAPA_DATA:srvData,PORT:String(port),
    OPEN_METEO_API_KEY:'',ENABLE_UI_QUEUE:'0',FACTIUN_MAPA_TOKEN:''},
  stdio:['ignore','pipe','pipe']
});
let logs='';
child.stdout.on('data',x=>{logs+=String(x).slice(-1500);});
child.stderr.on('data',x=>{logs+=String(x).slice(-1500);});
try{
  let ready=false;
  for(let n=0;n<50;n++){
    if(child.exitCode!==null)break;
    try{const r=await fetch('http://127.0.0.1:'+port+'/api/mapa/health');
      if(r.ok){ready=true;break;}}catch(_){}
    await new Promise(ok=>setTimeout(ok,100));
  }
  assert.equal(ready,true,'Servicio no arranca: '+logs);
  const url='http://127.0.0.1:'+port;
  const health=await (await fetch(url+'/api/mapa/health')).json();
  assert.equal(health.meteorologia,'pendiente_de_licencia');
  assert.equal(health.counts.done,2);
  const sites=await fetch(url+'/nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json');
  assert.equal(sites.status,200);
  assert.equal((await sites.json()).length,4);
  const browserCode=await fetch(url+'/sim/mapa-viabilidad.js');
  assert.equal(browserCode.status,200);
  assert.match(await browserCode.text(),/loadPrioritySites/);
  assert.equal((await fetch(url+'/bateria.html')).status,200);
  assert.equal((await fetch(url+'/nas/viabilidad/service.mjs')).status,404);
  assert.equal((await fetch(url+'/nas/viabilidad/.env.example')).status,404);
  assert.equal((await fetch(url+'/api/mapa/jobs',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({site:{lat:41.5,lon:-5},profileId:'SP_45W_6Ah'})
  })).status,403);
  const snapshot=await (await fetch(url+'/api/mapa/snapshot')).json();
  assert.equal(snapshot.items.length,1);
  assert.equal(snapshot.items[0].job_id,'vigente');
  assert.equal(snapshot.items[0].record.sig,'resultado-vigente');
  assert.equal(snapshot.items.some(i=>i.record?.sig==='resultado-obsoleto'),false);
}finally{
  child.kill('SIGTERM');
  if(child.exitCode===null)await new Promise(ok=>child.once('exit',ok));
  rmSync(srvData,{recursive:true,force:true});
}
console.log('NAS viabilidad: HTTP, permisos, previews y 4 emplazamientos OK');
