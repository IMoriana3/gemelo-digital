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
assert.match(js,/fetchYearDeclarado\(site,y\)/);
assert.match(js,/simulaSeguido\(met.tramos,derived.p,site,derived.o\)/);
assert.match(js,/simulate\(met.tramos\[0\].meteo,derived.p,site,socEstacionario\(derived.o\),derived.o\)/);
assert.doesNotMatch(js,/function simulate\(/);
assert.doesNotMatch(js,/synthMeteo\(/);
assert.match(js,/if\(!fullYear\(m,years\[i\]\)\)/);

const ctx={
  document:{readyState:'loading',addEventListener(){}},
  FISICA:{consumoTCU:function consumo(){}},
  Abanderamiento:function Abanderamiento(){},
  simulate:function simulate(){},
  simulaSeguido:function simulaSeguido(){},
  summarize:function summarize(){},
  controlesPara:function controlesPara(){},
  opcionesPara:function opcionesPara(){},
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
const S={hZero:0,periodosRes:0,inactivePct:0,hSinRacha:0,hSinNieve:0,diasRes:0,hStow:0,hNieve:0};
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
console.log('Mapa TCU: pruebas de integridad y clasificación correctas.');
