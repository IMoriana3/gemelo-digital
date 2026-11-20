#!/usr/bin/env node
/* DIAGNÓSTICO PARCIAL, NO MAPA DE VIABILIDAD.
 * NASA POWER hourly: GHI/DHI, temperatura y viento MEDIO de 2025.
 * NO incluye rachas ni nieve: NO declarar ningún equipo "apto" con esto.
 * El SOC se calcula con la función simulate() REAL de bateria.html.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const specs=JSON.parse(readFileSync(join(ROOT,
  'nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json'),'utf8'));
const ctx={module:{exports:{}}};
runInNewContext(readFileSync(join(ROOT,'sim/cartera.js'),'utf8'),ctx);
const catalog=ctx.module.exports;
if(!catalog?.plantas)throw Error('Cartera canónica no legible');
const sites=specs.map(s=>{
 if(s.cartera_num){
  const matches=catalog.plantas.filter(p=>p.num===String(s.cartera_num));
  if(matches.length!==1)throw Error('Código de cartera ambiguo '+s.cartera_num);
  return {...s,lat:matches[0].lat,lon:matches[0].lon,fuente:matches[0].fuente};
 }
 return s;
});
const PARAMS=['ALLSKY_SFC_SW_DWN','ALLSKY_SFC_SW_DIFF','T2M','WS10M'];
async function nasa(s,year){
 const url=new URL('https://power.larc.nasa.gov/api/temporal/hourly/point');
 for(const [k,v] of Object.entries({latitude:s.lat,longitude:s.lon,
   start:year+'0101',end:year+'1231',community:'RE',format:'JSON',
   parameters:PARAMS.join(','),'time-standard':'UTC'})) url.searchParams.set(k,v);
 let err;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const resp=await fetch(url,{signal:AbortSignal.timeout(120000)});
   if(!resp.ok)throw Error('NASA POWER HTTP '+resp.status);
   const obj=await resp.json(),p=obj.properties?.parameter;
   if(!p)throw Error('NASA POWER sin properties.parameter');
   const dates=Object.keys(p[PARAMS[0]]||{}).sort();
   if(dates.length!==8760)throw Error('2025: '+dates.length+' horas, esperadas 8760');
   const meteo=dates.map(key=>{
    const get=k=>p[k]?.[key];
    const vals=PARAMS.map(get);
    if(vals.some(v=>!Number.isFinite(v)||v<=-900))
      throw Error('NASA POWER: valores incompletos '+key);
    const [ghi,dhi,temp,wind]=vals;
    if(ghi<0||dhi<0||wind<0||dhi>ghi+20)
      throw Error('NASA POWER: variables incoherentes '+key);
    return {t:new Date(key.slice(0,4)+'-'+key.slice(4,6)+'-'+key.slice(6,8)+
        'T'+key.slice(8,10)+':00:00.000Z'),
      ghi,dhi,temp,wind,gust:null,snowDepth:null};
   });
   return {meteo,source:{title:obj.header?.title,version:obj.header?.api?.version,
     data_sources:obj.header?.sources||[],lat:s.lat,lon:s.lon,
     parameter_units:obj.parameters||{},time:'UTC',year}};
  }catch(e){err=e;if(attempt<3)await new Promise(r=>setTimeout(r,1000*attempt));}
 }
 throw err;
}
let {chromium}=await import('playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();
page.setDefaultTimeout(120000);
await page.goto(pathToFileURL(join(ROOT,'bateria.html')).href,{waitUntil:'load'});
await page.waitForFunction(()=>typeof simulate==='function'&&typeof opcionesDe==='function');
const out={
 label:'DIAGNOSTICO METEOROLOGICO INCOMPLETO. NO UTILIZAR COMO VEREDICTO DE VIABILIDAD',
 source:'NASA POWER 2025, meteorologia horaria; sin rachas, nieve ni extremos de diseño',
 equipment:'SUNNER SP 6Ah, STRING 6Ah, LT/LTH, Track N Co 6Ah',
 assumptions:'SOH=80%; panel 45W SP / 60W STRING; control estándar, winter, conservador, sin gestión; Track N Co con su firmware',
 sites:[],generated_at:new Date().toISOString()
};
for(const site of sites){
 console.error('NASA '+site.n+' ...');
 try{
  const {meteo,source}=await nasa(site,2025);
  const comparison=await page.evaluate(({site,raw})=>{
   const input=raw.map(x=>({...x,t:new Date(x.t)}));
   const profiles=['SP_45W_6Ah','STRING_60W_6Ah','SP_45W_6Ah_LT',
     'STRING_60W_6Ah_LT','TNC_45W_6Ah'];
   const results=[];
   for(const id of profiles){
    const p=PROFILES.find(x=>x.id===id);
    if(!p)throw Error('TCU ausente '+id);
    const options={motorModel:'curva',soh:0.8,vientoStow:'media',winter:false,
      strategy:true,socTgt:80,socCrit:30,fcDays:5,
      tMin:p.tCarga[0],poaMin:0,mountTilt:null};
    for(const c of controlesPara(p).filter(c=>!c.prof)){
      const o=opcionesDe(c,p,options);
      /* Mismo ejecutor que usa la interfaz del simulador y el mapamundi. */
      const resultado=calculaControlTCU(input,p,site,options,c,
        {soc0:socEstacionario(o.o)});
      const S=resultado.S;
      results.push({perfil:id,estrategia:c.k,soc_min_pct:+(100*S.socMin).toFixed(2),
        horas_soc_cero:S.hZero,episodios_sin_reserva:S.periodosRes,
        horas_de_indisponibilidad_pct:+S.inactivePct.toFixed(3),
        meteo_incompleta:'faltan ráfagas y nieve (100 % del periodo)'});
    }
   }
   return results;
  },{site,raw:meteo});
  out.sites.push({name:site.n,lat:site.lat,lon:site.lon,fuente_coordenada:site.fuente,
    hours:meteo.length,meteo:source,results:comparison,
    verdict:'SIN EVALUACION COMPLETA: viento medio, no racha; nieve no evaluada'});
  console.log(JSON.stringify({sitio:site.n,horas:meteo.length,resultados:comparison}));
 }catch(e){
  out.sites.push({name:site.n,lat:site.lat,lon:site.lon,
    error:String(e.message||e),verdict:'SIN EVALUACION'});
  console.error('NO DATA '+site.n+' '+String(e.message||e));
 }
}
await browser.close();
mkdirSync(join(ROOT,'outputs'),{recursive:true});
writeFileSync(join(ROOT,'outputs','diagnostico_nasa_2025_cuatro.json'),JSON.stringify(out,null,2)+'\n');
if(out.sites.every(s=>s.error))process.exitCode=2;
