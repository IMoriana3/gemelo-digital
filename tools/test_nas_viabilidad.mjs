#!/usr/bin/env node
import assert from 'node:assert/strict';
import {normalizeJob,REVISION} from '../nas/viabilidad/service.mjs';
import {inLand} from '../nas/viabilidad/seed.mjs';
const j=normalizeJob({site:{n:'Prueba',lat:41.576342,lon:-0.798139},profileId:'SP_45W_6Ah',period:'30'});
assert.equal(j.revision,REVISION);
assert.equal(j.site.lat,41.576342);
assert.equal(j.id,normalizeJob({site:{n:'Otro',lat:41.576342,lon:-0.798139},profileId:'SP_45W_6Ah',period:'30'}).id);
assert.notEqual(j.id,normalizeJob({site:j.site,profileId:'STRING_60W_6Ah',period:'30'}).id);
assert.throws(()=>normalizeJob({site:{lat:150,lon:0}}),/Coordenadas/);
assert.throws(()=>normalizeJob({site:{lat:40,lon:0},period:2030}),/Periodo/);
const land={type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[
  [[-3,40],[3,40],[3,44],[-3,44],[-3,40]],[[0,41],[1,41],[1,42],[0,42],[0,41]]
]}}]};
assert.equal(inLand(-2,41,land),true);
assert.equal(inLand(0.5,41.5,land),false);
assert.equal(inLand(10,40,land),false);
/* Cuatro ubicaciones reproducibles: San José sale de la CARTERA, no de una
   coordenada duplicada; las otras tres son puntos urbanos provisionales. */
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const preview=JSON.parse(execFileSync(process.execPath,[
  'nas/viabilidad/seed.mjs','--sites',
  'nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json',
  '--period','30'
],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'}));
assert.equal(preview.modo,'SOLO VISTA PREVIA');
assert.equal(preview.ubicaciones,4);
assert.equal(preview.trabajos,20); // cinco equipos × cuatro ubicaciones
assert.equal(preview.consultas_meteo_unicas_sin_cache,120);
assert.equal(preview.emplazamientos[2].lat,-16.5957735);
assert.equal(preview.emplazamientos[2].lon,-71.8064406);
assert.match(preview.emplazamientos[2].fuente,/layout:sanjose/);
assert.match(preview.emplazamientos[0].fuente,/NO parcela/);
assert.match(preview.emplazamientos[1].fuente,/NO parcela/);
assert.match(preview.emplazamientos[3].fuente,/NO parcela/);
console.log('NAS viabilidad: cola, máscara terrestre y lote de cuatro emplazamientos OK');
