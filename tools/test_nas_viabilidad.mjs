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
console.log('NAS viabilidad: cola, identificación de motor y máscara terrestre OK');
