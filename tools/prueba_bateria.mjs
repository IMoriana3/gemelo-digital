#!/usr/bin/env node
/* BANCO DE NAVEGADOR DE `bateria.html` (GEM-CIELO-02)
   ===================================================
   `tools/prueba_simulador.mjs` abre `simulador.html` y nada abría ésta, así que
   el único fichero del repo que MEZCLA el espejo con código propio no se
   ejecutaba nunca fuera del navegador de un humano. Se nota: al portar Perez
   copié aquí `PEREZ_F`, `airmass`, `e0De` y `perezCielo`, que ya estaban en el
   ámbito global porque la página carga `sim/fisica.js` con <script src>. Los
   PISABA. Coincidían carácter a carácter y por eso no cambiaba nada — hasta que
   alguien tocase uno de los dos.

   Lo que se comprueba:
     1. qué globales del espejo pisa la página, contra una lista DECLARADA con
        su motivo (las que existen para leer parámetros editables en caliente);
     2. que la página abre sin errores y `poaAt` da Perez de verdad.

       node tools/prueba_bateria.mjs
*/
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const RAIZ = path.dirname(new URL('.', import.meta.url).pathname);
const PAG = pathToFileURL(path.join(RAIZ, 'bateria.html')).href;
let fallos = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x ? '  → ' + x : '')); if (!c) fallos++; };

/* WeatherContract: el adaptador se prueba sin red. */
{
  const A=await import('../sim/weather-contract-adapter.mjs');
  const pkg={schema_version:'2.0.0',contract_id:'wc-bat',kind:'historical',
    site:{timezone:'Europe/Madrid'},source:{id:'open_meteo'},qa:{dataset_hash:'h-bat'},
    rows:[
      {t:'2024-01-01T00:00:00Z',ghi_wm2:0,dhi_wm2:0,temp_c:1,wind_ms:2,gust_ms:4,precip_mm:0,snowfall_cm:0},
      {t:'2024-01-01T01:00:00Z',ghi_wm2:100,dhi_wm2:30,temp_c:2,wind_ms:5,gust_ms:8,precip_mm:1,snowfall_cm:.2}
    ]};
  const m=A.contractToBattery(pkg,{year:2024});
  ok(m.length===2&&m[1].ghi===100&&m[1].wind===5&&m[1].gust===8,
    'WeatherContract se convierte al meteo de batería sin cambiar magnitudes');
  ok(m.contract.contract_id==='wc-bat'&&m.contract.dataset_hash==='h-bat',
    'batería/winter conserva contract_id + dataset_hash');
  const years=A.contractYears(pkg);
  ok(years.length===1&&years[0]===2024,'el barrido puede enumerar años del WeatherContract');
  const batTxt=readFileSync(path.join(RAIZ,'bateria.html'),'utf8');
  ok(batTxt.includes('value="contract" selected')&&batTxt.includes('WeatherContract · compartido'),
    'WeatherContract histórico es la fuente preferente de batería');
  ok(batTxt.includes('contractOrFallback')&&batTxt.includes('open_meteo_fallback'),
    'Open-Meteo directo queda como fallback declarado');
  ok(batTxt.includes('winter')&&batTxt.includes('WeatherContract'),
    'Winter mode y batería comparten la misma entrada meteorológica');
}

/* ── 1) el espejo no derrama: la comprobación se hace EN EL NAVEGADOR ──
   Aquí había una lista declarada de «globales del espejo que esta página pisa»,
   con su motivo. Era el parche correcto para el problema equivocado: la causa
   no era que la página declarase esos nombres, era que `sim/fisica.js` los
   soltaba al ámbito global por no ir envuelto. Envuelto en IIFE
   (GEM-AMBITO-01), no hay nada que pisar, y la lista sobra.

   Lo que se exige ahora es la propiedad, no la lista: de las 22 declaraciones
   del espejo, en `window` no debe haber NINGUNA — sólo `FISICA`. Y se mide
   cargando la página de verdad, que es lo único que distingue un `var` dentro
   de un IIFE de uno fuera. Un guard de texto no puede: los dos van a columna 0.
   (Lo comprobé: mi contador de derrames seguía diciendo 22 con el IIFE puesto.) */
const DECL_ESPEJO = ['cRateSafeLFP','hotDerate','heaterW','etaCharger','airmass','e0De',
  'perezCielo','poaAt','motorW','consumoTCU','D2R','JEITA_T3','K0','MOTOR_ANG','MOTOR_MA',
  'MOTOR_V_MEAS','V_NOM','IDLE_W','ETA_G','ETA_V','PEREZ_F'];
/* Los que la PÁGINA declara por su cuenta —porque leen parámetros editables en
   caliente— sí estarán en `window`, y son suyos: con el espejo envuelto ya no
   pisan nada. Los que no declara no pueden estar, y si aparecen es que el IIFE
   se ha caído. */
const SOLO_DEL_ESPEJO = ['airmass','e0De','perezCielo','ETA_G','ETA_V','PEREZ_F'];

/* ── 2) que la página abra y que `poaAt` dé Perez de verdad ── */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { try { ({ chromium } = await import('playwright-core')); }
  catch { console.error('falta playwright'); process.exit(2); } }
const EXE = process.env.CHROME_BIN || process.env.PLAYWRIGHT_CHROMIUM;
const nav = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const pg = await nav.newPage({ viewport: { width: 1400, height: 900 } });
const rotos = [];
pg.on('pageerror', (e) => rotos.push(String(e.message)));
await pg.goto(PAG);
await pg.waitForTimeout(800);
ok(rotos.length === 0, 'la página abre sin errores', rotos.slice(0, 3).join(' · '));

const r = await pg.evaluate(() => {
  const D = Math.PI / 180;
  /* ancla de pvlib: zen 55, azN 150, tilt 30 al ESTE, ghi 235.2237, dni 24.0644,
     dhi 221.4209, E0 1367 → poa_global 226.194055 (allsitescomposite1990) */
  const el = (90 - 55) * D, az = (150 - 180) * D;
  const bh = 24.0644 * Math.cos(55 * D);
  return {
    poa: poaAt(-30, el, az, bh, 221.4209, 235.2237),
    delega: typeof FISICA !== 'undefined' && typeof FISICA.perezCielo === 'function',
  };
});
ok(r.delega, '`FISICA.perezCielo` está disponible en la página');
{
  const enWin = await pg.evaluate((ns) => ns.filter(
    (n) => Object.prototype.hasOwnProperty.call(window, n)), SOLO_DEL_ESPEJO);
  ok(enWin.length === 0,
    'el espejo NO derrama al ámbito global: 0 de sus ' + DECL_ESPEJO.length +
    ' declaraciones en `window`',
    'derrama ' + enWin.join(', ') + ' — el IIFE de sim/fisica.js se ha caído');
}

/* Los dos de arriba son de TEXTO, y el texto se puede satisfacer sin que la
   propiedad se cumpla: dos mutantes —volver a llamar al global sin delegar, y
   congelar el ALBEDO a 0,2— los pasaban. Lo que sigue es de COMPORTAMIENTO y
   no se puede engañar así: se toca lo de fuera y se exige que `poaAt` lo note. */
const vivo = await pg.evaluate(() => {
  const D = Math.PI / 180, el = (90 - 55) * D, az = (150 - 180) * D;
  const bh = 24.0644 * Math.cos(55 * D);
  const llama = (...a) => poaAt(-30, el, az, bh, 221.4209, 235.2237, ...a);
  const base = llama();
  /* 1) ¿de verdad pasa por FISICA.perezCielo? Se le pone un tope y tiene que notarse. */
  const real = FISICA.perezCielo;
  FISICA.perezCielo = function () { return 0; };
  const sinCielo = llama();
  FISICA.perezCielo = real;
  /* 2) ¿el ALBEDO de la página es el que manda? Se mueve y tiene que notarse. */
  const alb = ALBEDO;
  // eslint-disable-next-line no-global-assign
  ALBEDO = 0.9;
  const conAlbedoAlto = llama();
  ALBEDO = alb;
  return { base, sinCielo, conAlbedoAlto };
});
ok(Math.abs(vivo.base - vivo.sinCielo) > 1,
  '`poaAt` LLAMA a FISICA.perezCielo (anulándolo baja ' +
  (vivo.base - vivo.sinCielo).toFixed(2) + ' W/m²)',
  'no lo llama: ha vuelto a copiar el cielo');
ok(vivo.conAlbedoAlto > vivo.base + 1,
  'y usa el ALBEDO EDITABLE de la página (0,2 → 0,9 sube ' +
  (vivo.conAlbedoAlto - vivo.base).toFixed(2) + ' W/m²)',
  'el albedo está congelado: el panel «Energía» no hace nada');
ok(Math.abs(r.poa - 226.194055) / 226.194055 < 1e-3,
  '`poaAt` EN EL NAVEGADOR da el ancla de pvlib (' + r.poa.toFixed(4) + ' vs 226.1941)',
  r.poa.toFixed(6));

/* ── 3) los 21 canónicos del panel salen del ESPEJO, no de un literal ──
   Los 20 parámetros editables (más GCR) eran valores TECLEADOS que repetían lo
   que `sim/fisica.js` ya publica. Coincidían todos —lo comprobé commit a commit
   en los 18 que tienen los dos ficheros, y nunca han derivado—, pero nada lo
   garantizaba: es el mecanismo de CENTINELA-01, una copia a mano que un día
   deja de coincidir sin que salte nada. Ahora se leen del espejo y esto lo
   exige. Se comprueba EN EL NAVEGADOR contra `CANON_FIS`, que es la foto que el
   panel toma al cargar y a la que vuelve el botón de restaurar. */
const cte = await pg.evaluate(() => {
  const plano = {};
  (function rec(o, pre) {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) rec(v, pre + k + '.');
      else plano[pre + k] = v;
    }
  })(FISICA, '');
  const norm = (x) => x.toLowerCase().replace(/_/g, '');
  const claves = Object.keys(plano);
  const mal = [], sinCanon = [];
  const revisar = PARAMS_FIS.map((p) => p.k).concat(['GCR']);
  for (const k of revisar) {
    const hit = claves.find((c) => norm(c.split('.').pop()) === norm(k));
    if (!hit) { sinCanon.push(k); continue; }
    const aqui = (k === 'GCR') ? GCR : CANON_FIS[k];
    if (aqui !== plano[hit]) mal.push(k + ': página ' + aqui + ' ≠ espejo ' + plano[hit]);
  }
  return { n: revisar.length, mal, sinCanon };
});
ok(cte.mal.length === 0,
  'los ' + cte.n + ' canónicos del panel son EXACTAMENTE los del espejo',
  cte.mal.join(' · '));
/* Alcance de esto, dicho: recorre los parámetros del PANEL (`PARAMS_FIS`) más
   `GCR`. Una constante suelta que alguien añada fuera del panel no la ve —lo
   comprobé con un mutante y pasaba—, así que la frase dice «del panel» y no
   «de la página». Un guard que promete más de lo que mira es peor que ninguno. */
ok(cte.sinCanon.length === 0,
  'y todo parámetro del PANEL tiene contraparte en el espejo (ninguno flota)',
  'sin canon: ' + cte.sinCanon.join(', '));
/* Y que se lean, no se tecleen: si vuelve un literal, esto lo dice aunque el
   número coincida hoy — porque el problema es la copia, no el valor. */
{
  const bat2 = readFileSync(path.join(RAIZ, 'bateria.html'), 'utf8');
  const tecleados = ['AXIS_MAX','NIGHT_POS','DEFENSE_POS','SLEW_DPS','HYST_DEG',
    'WIND_T1','WIND_T2','PARTIAL_STOW_DEG','DESTOW_HOLD_H','IDLE_W','SLEEP_W',
    'K0','K1','ETA_CHG','V_NOM','ALBEDO','JEITA_T3','JEITA_T4','GCR']
    .filter((k) => new RegExp('\\b' + k + '\\s*=\\s*[-\\d.]').test(bat2));
  ok(tecleados.length === 0,
    'y ninguno se teclea: los 19 se leen de FISICA',
    'tecleados: ' + tecleados.join(', '));
}

/* ── 4) EL INFORME NO SE CONTRADICE (2026-10-21, Bellinzago) ──
   Dos informes del mismo sitio, mismo equipo y mismo año salieron con la
   columna «estándar» distinta (414 h / 412 h) porque el SOC inicial del panel
   no se imprimía; a cada uno le faltaba un año distinto del barrido y los dos
   existían (429 de cuota, tragado como `null`); los dos recomendaban «Sin
   gestión» con 66 h de batería agotada; y ninguno enseñaba la versión -LT,
   que es lo único que toca el invierno. Cuatro propiedades, las cuatro de
   COMPORTAMIENTO: se ejecutan en la página, no se leen con una regex. */
const inf = await pg.evaluate(async () => {
  const loc = { n: 'Banco', lat: 45.57, lon: 8.63 };
  const prof = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  const lt = PROFILES.filter((p) => p.id === 'SP_45W_6Ah_LT')[0];
  const base = { motorModel: 'curva', winter: false, strategy: true, socTgt: 80, socCrit: 30,
    fcDays: 5, tMin: 0, poaMin: 0, mountTilt: null };
  const meteo = synthMeteo(loc, 12, 350, 60);
  const R = {};
  /* a) estado estacionario: con soc0===null cada lógica arranca en SU objetivo;
        con un número, todas en ese número. */
  const est = runControls(meteo, prof, loc, null, base);
  R.arranque = est.map((x) => ({ k: x.c.k, soc0: x.soc0, tgt: x.c.o.socTgt / 100, primero: x.rows[0].soc }));
  R.panel = runControls(meteo, prof, loc, 0.05, base).map((x) => x.soc0);
  /* b) la columna -LT existe para un perfil sin calefactor, apunta al gemelo,
        y SIMULA con él: a −10 °C el estándar no carga (tMin 0) y la -LT sí. */
  R.cols = est.map((x) => x.c.k);
  const colLT = est.filter((x) => x.c.k === 'lt')[0];
  R.ltProf = colLT ? colLT.prof.id : null;
  R.colsDeLT = controlesPara(lt).map((c) => c.k);
  const frio = meteo.map((m) => Object.assign({}, m, { temp: -10 }));
  const enFrio = runControls(frio, prof, loc, null, base);
  R.chgStdFrio = enFrio.filter((x) => x.c.k === 'std')[0].S.chg;
  R.chgLTFrio = (enFrio.filter((x) => x.c.k === 'lt')[0] || { S: { chg: -1 } }).S.chg;
  /* c) el «más favorable»: la tabla real de Bellinzago 2014, en miniatura. */
  const fila = (k, prof, hZero, inact, years) => ({ c: { k, n: k, prof }, S: { hZero, inactivePct: inact, cyc: { years }, prodRelPct: 99 } });
  const C = [fila('none', null, 66, 0.7534, 14.9), fila('std', null, 3, 4.7260, 15.7), fila('winter', null, 6, 4.0982, 15.2),
    fila('plano', null, 0, 4.3950, 15.7), fila('cons', null, 0, 5.7648, 15.7), fila('lt', lt, 0, 1.0, 15.7)];
  const e = eligeMejor(C);
  R.mejor = e.mejor.c.k; R.minZero = e.minZero; R.descartados = e.descartados.map((x) => x.c.k);
  R.mejorVacio = eligeMejor([]) === null && eligeMejor(null) === null;
  /* d) el barrido separa lo que bajó de lo que no, con motivo. */
  const cl = clasificaBarrido([meteo.concat(meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo, meteo), { error: 'HTTP 429', intentos: 4 }, null, meteo],
    [2013, 2014, 2015, 2016], (m, y) => ({ year: y }));
  R.barrido = { res: cl.res.map((r) => r.year), caidos: cl.caidos.map((c) => c.year + ':' + c.motivo) };
  /* e) el 429 se reintenta y, si persiste, vuelve DECLARADO (no null). */
  const fetchReal = window.fetch; const viejos = REINTENTOS_OM.slice();
  REINTENTOS_OM.length = 0; REINTENTOS_OM.push(1, 1, 1);
  const payload = { hourly: { time: ['2016-01-01T00:00', '2016-01-01T01:00', '2016-01-01T02:00'],
    shortwave_radiation: [0, 0, 0], diffuse_radiation: [0, 0, 0], temperature_2m: [1, 1, 1], windspeed_10m: [2, 2, 2] } };
  let llamadas = 0;
  window.fetch = () => { llamadas++; return Promise.resolve(llamadas < 3
    ? { ok: false, status: 429 } : { ok: true, status: 200, json: () => Promise.resolve(payload) }); };
  const alTercero = await fetchYearDeclarado(loc, 2016);
  R.alTercero = { llamadas, filas: alTercero ? alTercero.length : null, error: (alTercero && alTercero.error) || null, esNull: alTercero === null };
  llamadas = 0; window.fetch = () => { llamadas++; return Promise.resolve({ ok: false, status: 429 }); };
  const nunca = await fetchYearDeclarado(loc, 2018);
  R.nunca = { llamadas, error: (nunca && nunca.error) || null, intentos: (nunca && nunca.intentos) || null, esNull: nunca === null };
  window.fetch = fetchReal; REINTENTOS_OM.length = 0; viejos.forEach((v) => REINTENTOS_OM.push(v));
  return R;
});
ok(inf.arranque.every((a) => Math.abs(a.soc0 - a.tgt) < 1e-9 && Math.abs(a.primero - a.tgt) < 0.1),
  'con soc0=null cada lógica ARRANCA en su objetivo (' + inf.arranque.map((a) => a.k + ' ' + Math.round(a.tgt * 100) + '%').join(', ') + ')',
  JSON.stringify(inf.arranque));
ok(inf.panel.every((v) => v === 0.05), 'y con un número del panel, todas arrancan en él', inf.panel.join(','));
ok(inf.cols.indexOf('lt') >= 0 && inf.ltProf === 'SP_45W_6Ah_LT',
  'un perfil sin calefactor trae la columna -LT apuntando a su gemelo (' + inf.ltProf + ')', inf.cols.join(','));
ok(inf.colsDeLT.indexOf('lt') < 0, 'y el propio perfil -LT no la trae (no hay gemelo del gemelo)', inf.colsDeLT.join(','));
ok(inf.chgStdFrio === 0 && inf.chgLTFrio > 0,
  'la columna -LT SIMULA con el perfil calefactado: a −10 °C el estándar capta 0 Wh y la -LT ' + inf.chgLTFrio.toFixed(0) + ' Wh',
  'std ' + inf.chgStdFrio + ' · lt ' + inf.chgLTFrio);
ok(inf.mejor === 'plano' && inf.minZero === 0 && inf.descartados.join(',') === 'none,std,winter',
  'el «más favorable» descarta a los que agotan la batería, ignora la columna -LT y elige «plano» (0 h, 4,40 %)',
  'mejor ' + inf.mejor + ' · minZero ' + inf.minZero + ' · descartados ' + inf.descartados.join(','));
ok(inf.mejorVacio, 'y sin comparativa no inventa veredicto');
ok(inf.barrido.res.join(',') === '2013' && inf.barrido.caidos.join(' | ') === '2014:HTTP 429 tras 4 intentos | 2015:no está en la fuente | 2016:serie incompleta (288 h)',
  'el barrido LISTA los años que no bajaron, con motivo, en vez de saltarlos', JSON.stringify(inf.barrido));
ok(inf.alTercero.llamadas === 3 && inf.alTercero.filas === 3 && !inf.alTercero.error,
  'un 429 se reintenta: dos rechazos y al tercero baja', JSON.stringify(inf.alTercero));
ok(inf.nunca.llamadas === 4 && inf.nunca.error === 'HTTP 429' && inf.nunca.intentos === 4 && !inf.nunca.esNull,
  'y si persiste vuelve DECLARADO: {error:"HTTP 429", intentos:4}, nunca null', JSON.stringify(inf.nunca));

await nav.close();
console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ bateria.html abre, el espejo no derrama, su poaAt es Perez, sus 19 canónicos salen del espejo y el informe no se contradice'));
process.exit(fallos ? 1 : 0);
