#!/usr/bin/env node
// Contratos del mapa TCU: no se inventan puntos aptos ni se duplican motores.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../bateria.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../sim/mapa-viabilidad.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../sim/mapa-viabilidad.css',import.meta.url),'utf8');

assert.match(html,/id="mv-open"/);
assert.match(html,/<link rel="stylesheet" href="sim\/mapa-viabilidad.css">/);
assert.match(html,/<script src="sim\/mapa-viabilidad.js"><\/script>/);
assert.match(css,/#viab-map/);
assert.match(js,/fetchYearDeclarado\(weatherSite,y\)/);
assert.match(js,/meteoMode:'era5_hybrid'/);
assert.match(js,/var keep=all\.filter\(function\(x\)\{return x&&x\.sig!==cfg\.key;\}\);/);
assert.match(html,/loc&&loc\.meteoMode==='era5_hybrid'/);
assert.match(html,/wind_gusts_10m/);
assert.match(html,/models=era5&wind_speed_unit=ms/);
assert.match(html,/models=era5_land&wind_speed_unit=ms/);
assert.match(html,/wind_gusts_10m:b.wind_gusts_10m/);
assert.match(html,/hourly_units.wind_gusts_10m!=='m\/s'/);
assert.match(html,/wind_speed_unit=ms/);
assert.match(html,/a\.time\[i\]!==b\.time\[i\]/);
assert.match(js,/var control=controls\[j\],derived=opcionesDe\(control,profile,cfg.base\)/);
assert.doesNotMatch(js,/derived=opcionesPara\(control/);
assert.match(html,/function opcionesDelPanel\(prof\)/);
assert.match(html,/var opts=opcionesDelPanel\(prof\)/);
assert.match(js,/var base=opcionesDelPanel\(p\)/);
assert.match(js,/async function loadPrioritySites\(\)/);
assert.match(js,/if\(item\.cartera_num!=null\)return/);
const cases=JSON.parse(readFileSync(
  new URL('../nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json',import.meta.url),'utf8'));
assert.equal(cases.length,4);
assert.equal(cases.filter(c=>c.cartera_num==='24019').length,1);
assert.equal(cases.filter(c=>c.cartera_num!=null&&c.lat!=null).length,0,
  'La Joya no duplica coordenadas de la cartera');
assert.match(js,/meteoForSite,fullYear,outcome,FISICA\.consumoTCU/);
assert.match(js,/poaAt,etaAtCrate,etaCharger,cRateSafeLFP,hotDerate,motorTrackWh/);
assert.match(html,/function ejecutaBalanceTCU\(meteoOTramos,prof,loc,opts,conf\)/);
assert.match(html,/function calculaControlTCU\(meteoOTramos,prof,loc,base,control,conf\)/);
assert.match(html,/var full=ejecutaBalanceTCU\(tramos,prof,loc,opts,\{seguido:true\}\)/);
assert.match(html,/var refFull=ejecutaBalanceTCU\(tramos,prof,loc,refOpts,\{seguido:true\}\)/);
assert.match(html,/var mng=ejecutaBalanceTCU\(meteo,prof,loc,opts,\{soc0:soc0\}\)/);
assert.match(html,/var ref=ejecutaBalanceTCU\(meteo,prof,loc,refOpts,\{soc0:soc0\}\)/);
assert.match(html,/var rows=ejecutaBalanceTCU\(meteoOTramos,od.p,loc,od.o,conf\)/);
assert.match(js,/var baseRows=ejecutaBalanceTCU\(met.tramos,profile,site,cfg.base,\{seguido:true\}\)/);
assert.doesNotMatch(js,/function ejecutaBalanceTCU\(/);
assert.match(html,/return calculaControlTCU\(meteo,prof,loc,base,c,\{soc0:soc0\}\)/);
assert.match(js,/var result=calculaControlTCU\(/);
assert.match(js,/\{soc0:cfg.soc0\}/);
assert.match(js,/BAT_METEO_PARIDAD/);
assert.match(html,/function meteoExactaMapa\(loc,years\)/);
assert.doesNotMatch(js,/rows=simulaSeguido\(/);
assert.doesNotMatch(js,/rows=simulate\(/);
assert.doesNotMatch(js,/function simulate\(/);
assert.doesNotMatch(js,/synthMeteo\(/);
assert.match(js,/if\(!fullYear\(m,years\[i\]\)\)/);
assert.match(js,/var years=historicalYears\(period\)/);
assert.match(js,/years:\[years\[0\],years\[years\.length-1\]\],nYears:years\.length/);
assert.match(js,/var year=new Date\(\)\.getUTCFullYear\(\)-1/);

const ctx={
  document:{readyState:'loading',addEventListener(){}},
  FISICA:{consumoTCU:function consumo(){}},
  Abanderamiento:function Abanderamiento(){},
  simulate:function simulate(){},
  simulaSeguido:function simulaSeguido(){},
  calculaControlTCU:function calculaControlTCU(){},
  ejecutaBalanceTCU:function ejecutaBalanceTCU(){},
  summarize:function summarize(){},
  controlesPara:function controlesPara(){},
  opcionesDe:function opcionesDe(){},
  opcionesDelPanel:function opcionesDelPanel(){},
  enCatalogo:function(){return true;},
  cuentaReserva:function cuentaReserva(){},
  poaAt:function poaAt(){},
  etaAtCrate:function etaAtCrate(){},
  etaCharger:function etaCharger(){},
  cRateSafeLFP:function cRateSafeLFP(){},
  hotDerate:function hotDerate(){},
  motorTrackWh:function motorTrackWh(){},
  controlDe:function controlDe(){},
  parseOM:function parseOM(){},
  fetchOpenMeteoYear:function fetchOpenMeteoYear(){},
  resumenInviernos:function resumenInviernos(){},
  peorInvierno:function peorInvierno(){},
};
ctx.Abanderamiento.prototype.paso=function(){};
vm.createContext(ctx);
const code=js.replace("if(document.readyState==='loading')",
  'globalThis.__mapTests={fullYear,outcome,historicalYears};\nif(document.readyState===\'loading\')');
assert.notEqual(code,js,'No se ha encontrado el punto de inyección de pruebas');
vm.runInContext(code,ctx,{filename:'sim/mapa-viabilidad.js'});
const {fullYear,outcome,historicalYears}=ctx.__mapTests;
/* Año 2027: `30` ya no significa 1996–2025, sino 1997–2026.
   La firma de caché debe contener ese rango y caducar automáticamente. */
const roll2026=Array.from(historicalYears('30',new Date(Date.UTC(2026,11,31,23,59))));
const roll2027=Array.from(historicalYears('30',new Date(Date.UTC(2027,0,1))));
assert.equal(roll2026.length,30);
assert.equal(roll2026[0],1996);
assert.equal(roll2026.at(-1),2025);
assert.equal(roll2027[0],1997);
assert.equal(roll2027.at(-1),2026);
assert.notDeepEqual(roll2026,roll2027);
assert.deepEqual(Array.from(historicalYears('2024',new Date(Date.UTC(2026,0,1)))),[2024]);
assert.throws(()=>historicalYears('2026',new Date(Date.UTC(2026,0,1))),/fuera de periodo/);
assert.throws(()=>historicalYears('30a',new Date(Date.UTC(2026,0,1))),/fuera de periodo/);

// Año completo verificable, sin saltos ni datos de otro año.
const y=2025,rows=Array.from({length:8760},(_,i)=>({t:new Date(Date.UTC(y,0,1)+i*3600000)}));
assert.equal(fullYear(rows,y),true);
assert.equal(fullYear(rows.slice(0,-1),y),false);
rows[123].t=new Date(+rows[122].t);
assert.equal(fullYear(rows,y),false);

const met={years:Array(30).fill(2025),missing:[],qa:{sin_irradiancia:0,sin_temperatura:0,sin_viento:0}};
const control={k:'std',n:'Estrategia estándar'};
const opts={vientoStow:'racha'};
const profile={tCarga:[0,45],tDescarga:[-10,60]};
const thermal={min:5,max:30};
const S={reservaWh:5.37,margenMin:8.2,hBajoReserva:0,socMin:0.65,
  hZero:0,periodosRes:0,inactivePct:0,hSinRacha:0,hSinNieve:0,
  diasRes:0,hStow:0,hNieve:0};
/* Las cuatro estrategias CAMBIAN la política: opcionesPara cambia química
   entre perfiles, pero no sirve para combinar una lógica con la misma TCU. */
const a=html.indexOf('function opcionesDe(c,prof,base){');
const b=html.indexOf('function runControls(',a);
assert.ok(a>0&&b>a,'opcionesDe canónica no encontrada');
const strategyCtx={};
vm.createContext(strategyCtx);
vm.runInContext(html.slice(a,b)+'\nglobalThis.__opts=opcionesDe;',strategyCtx);
const equipo={id:'SP_45W_6Ah',wh:153.6};
const principal={strategy:true,socTgt:80,socCrit:30,fcDays:5};
const winter=strategyCtx.__opts({o:{socTgt:90,socCrit:30,fcDays:3,winter:true}},equipo,principal);
const conservador=strategyCtx.__opts({o:{socTgt:80,socCrit:40,fcDays:5,winter:false}},equipo,principal);
const sinGestion=strategyCtx.__opts({o:{strategy:false,socTgt:100,socCrit:0,fcDays:5}},equipo,principal);
assert.equal(winter.p,equipo);
assert.equal(winter.o.socTgt,90);
assert.equal(winter.o.fcDays,3);
assert.equal(conservador.o.socCrit,40);
assert.equal(sinGestion.o.strategy,false);
assert.equal(outcome(S,control,met,opts,'2017/18',profile,thermal).status,'apto');
assert.equal(outcome({...S,hZero:3},control,met,opts,'2017/18',profile,thermal).status,'no_apto');
assert.equal(outcome({...S,periodosRes:1},control,met,opts,'2017/18',profile,thermal).status,'condicionado');
assert.equal(outcome(S,{k:'none',n:'Sin gestión'},met,opts,'2017/18',profile,thermal).status,'condicionado');
assert.equal(outcome(S,control,{...met,missing:[2018]},opts,'2017/18',profile,thermal).status,'pendiente');
assert.equal(outcome(S,control,{...met,years:[2025]},opts,'2025',profile,thermal).status,'pendiente');
assert.equal(outcome(S,control,met,opts,'2017/18',{...profile,sinFicha:true},thermal).status,'pendiente');
assert.equal(outcome(S,control,met,opts,'2017/18',profile,{min:-20,max:30}).status,'pendiente');
assert.equal(outcome(S,control,met,{vientoStow:'media'},'2017/18',profile,thermal).status,'pendiente');
assert.equal(outcome(S,control,{...met,qa:{sin_irradiancia:2,sin_temperatura:0,sin_viento:0}},opts,'2017/18',profile,thermal).status,'pendiente');
// Regresiones críticas: una simulación con NaN, métricas ausentes o
// temperatura sin medir NUNCA puede colorearse «apta» por defecto.
assert.equal(outcome({...S,hZero:NaN},control,met,opts,'2017/18',profile,thermal).status,'pendiente');
assert.equal(outcome({...S,socMin:Infinity},control,met,opts,'2017/18',profile,thermal).status,'pendiente');
assert.equal(outcome({...S,margenMin:undefined},control,met,opts,'2017/18',profile,thermal).status,'pendiente');
assert.equal(outcome({...S,inactivePct:-1},control,met,opts,'2017/18',profile,thermal).status,'pendiente');
assert.equal(outcome(S,control,met,opts,'2017/18',profile,{min:Infinity,max:-Infinity}).status,'pendiente');
assert.equal(outcome(S,control,met,opts,'2017/18',profile,thermal,1).status,'pendiente');
assert.equal(outcome(S,control,{...met,ok:29},opts,'2017/18',profile,thermal).status,'pendiente');
assert.equal(outcome({...S,hZero:3},control,met,opts,'2017/18',profile,thermal,0).status,'no_apto');
assert.equal(outcome({...S,hStow:4},control,met,opts,'2017/18',profile,thermal,0,0).status,'condicionado');
assert.equal(outcome(S,control,met,opts,'2017/18',profile,thermal,0,5).status,'condicionado');
assert.match(outcome(S,control,met,opts,'2017/18',profile,thermal,0,5).limitations.join(' '),/nieve en suelo/);
// El lector histórico no puede esconder NaN ni valores negativos convirtiéndolos
// en «cero viento / cero nieve» y, con ello, declarar el punto apto.
const start=html.indexOf('function parseOM(j){');
const end=html.indexOf('\nvar OM_VARS=',start);
assert.ok(start>0&&end>start,'No se localiza el parser meteorológico');
const parseCtx={};
vm.createContext(parseCtx);
vm.runInContext(html.slice(start,end)+'\nglobalThis.__parse=parseOM;',parseCtx);
const series=parseCtx.__parse({hourly:{
  time:['2025-01-01T00:00','2025-01-01T01:00','2025-01-01T02:00'],
  shortwave_radiation:[0,NaN,-1],diffuse_radiation:[0,10,-2],
  temperature_2m:[-1,NaN,-5],windspeed_10m:[0,NaN,-1],
  wind_gusts_10m:[3,NaN,-2],snow_depth:[0,NaN,-0.01]
}});
assert.equal(series.mapaQA.sin_irradiancia,2);
assert.equal(series.mapaQA.sin_temperatura,1);
assert.equal(series.mapaQA.sin_viento,2);
assert.equal(series[1].gust,null);
assert.equal(series[2].snowDepth,null);
assert.equal(series[0].wind,0);
assert.equal(Object.keys(series).includes('mapaQA'),false);

// El mapa y el panel consumen la misma lectura física. Variar hardware
// sólo cambia el suelo de carga si el equipo NO es el seleccionado.
const pStart=html.indexOf('function opcionesDelPanel(prof){');
const pEnd=html.indexOf('function opcionesReferenciaTCU(opts){',pStart);
assert.ok(pStart>0&&pEnd>pStart,'No existe lector común del panel');
const panelValues={
 prof:{value:'0'},panel:{value:'45'},motor:{value:'curva'},
 aged:{checked:true},vientoStow:{value:'racha'},winter:{checked:false},
 socTgt:{value:'80'},socCrit:{value:'30'},fc:{value:'5'},
 tmin:{value:'-15'},poaMin:{value:'0'},mount:{value:'trk'},tilt:{value:'30'}
};
const panelP={id:'SP_45W_6Ah',wh:153.6,chgW:45,tCarga:[0,45]};
const panelOther={id:'SP_45W_6Ah_LT',wh:166.4,chgW:45,tCarga:[-20,60]};
const panelCtx={
 PROFILES:[panelP,panelOther],SOH_FIN_VIDA:0.8,
 $:function(k){return panelValues[k];},
 conPanel:function(p,w){return w===p.chgW?p:{...p,chgW:w,id:p.id.replace('_45W_','_'+w+'W_')}}
};
vm.createContext(panelCtx);
vm.runInContext(html.slice(pStart,pEnd)+'\nglobalThis.__opts=opcionesDelPanel;',panelCtx);
const selectedOpts=panelCtx.__opts(panelP);
const alternateOpts=panelCtx.__opts(panelOther);
assert.equal(selectedOpts.tMin,-15,'umbral personalizado del perfil seleccionado');
assert.equal(alternateOpts.tMin,-20,'umbral de ficha cuando se selecciona otra química');
assert.equal(selectedOpts.soh,0.8);
assert.equal(selectedOpts.motorModel,'curva');
assert.equal(selectedOpts.vientoStow,'racha');
assert.equal(alternateOpts.socCrit,selectedOpts.socCrit);
// Contrato real entre dos reanálisis: ERA5 es viento medio; ERA5-Land,
// ráfaga y nieve. No aceptar por accidente km/h como m/s.
const startYear=html.indexOf('function fetchOpenMeteoYear(loc,year){');
const endYear=html.indexOf('/* Sintético:',startYear);
assert.ok(startYear>0&&endYear>startYear,'No se encuentra el lector histórico');
const dates=['2025-01-01T00:00','2025-01-01T01:00'];
const weatherCtx={parseOM:j=>j.hourly};
const urls=[];
weatherCtx.fetch=async function(url){
  const u=new URL(url),model=u.searchParams.get('models');
  urls.push(u);
  const params=u.searchParams.get('hourly');
  assert.equal(u.searchParams.get('wind_speed_unit'),'ms');
  if(model==='era5'){
    assert.equal(params,'shortwave_radiation,diffuse_radiation,windspeed_10m');
    return {ok:true,json:async()=>({
      hourly:{time:dates,shortwave_radiation:[0,500],diffuse_radiation:[0,160],
        windspeed_10m:[4.2,5.6]},hourly_units:{windspeed_10m:'m/s'}})};
  }
  assert.equal(model,'era5_land');
  assert.equal(params,'temperature_2m,snow_depth,wind_gusts_10m');
  return {ok:true,json:async()=>({
    hourly:{time:dates,temperature_2m:[-4,-3],snow_depth:[0.01,0.01],
      wind_gusts_10m:[8.6,11.2]},
    hourly_units:{wind_gusts_10m:'m/s'}})};
};
vm.createContext(weatherCtx);
vm.runInContext(html.slice(startYear,endYear)+'\nglobalThis.__load=fetchOpenMeteoYear;',weatherCtx);
const hybrid=await weatherCtx.__load({lat:41.5,lon:-5,meteoMode:'era5_hybrid'},2025);
assert.equal(urls.length,2);
assert.equal(hybrid.windspeed_10m[1],5.6);
assert.equal(hybrid.wind_gusts_10m[1],11.2);
assert.equal(hybrid.snow_depth[1],0.01);
const origFetch=weatherCtx.fetch;
weatherCtx.fetch=async u=>{
  const r=await origFetch(u),json=r.json;
  return {...r,json:async()=>{
    const j=await json();
    if(new URL(u).searchParams.get('models')==='era5_land')
      j.hourly_units.wind_gusts_10m='km/h';
    return j;
  }};
};
await assert.rejects(
  weatherCtx.__load({lat:41.5,lon:-5,meteoMode:'era5_hybrid'},2025),
  /unidad del viento no es m\/s/);

console.log('Mapa TCU: integridad, un solo lector físico y clasificación conservadora OK');
