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
assert.match(html,/models=era5&windspeed_unit=ms/);
assert.match(html,/models=era5_land/);
assert.match(html,/a\.time\[i\]!==b\.time\[i\]/);
assert.match(js,/var control=controls\[j\],derived=opcionesDe\(control,profile,cfg.base\)/);
assert.doesNotMatch(js,/derived=opcionesPara\(control/);
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
  enCatalogo:function(){return true;},
};
ctx.Abanderamiento.prototype.paso=function(){};
vm.createContext(ctx);
const code=js.replace("if(document.readyState==='loading')",
  'globalThis.__mapTests={fullYear,outcome};\nif(document.readyState===\'loading\')');
assert.notEqual(code,js,'No se ha encontrado el punto de inyección de pruebas');
vm.runInContext(code,ctx,{filename:'sim/mapa-viabilidad.js'});
const {fullYear,outcome}=ctx.__mapTests;

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

console.log('Mapa TCU: integridad, clasificación y cierres conservadores correctos.');
