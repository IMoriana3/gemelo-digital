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
  const C = [fila('none', null, 64, 0.7306, 14.9), fila('std', null, 3, 4.7260, 15.7), fila('winter', null, 6, 4.0982, 15.2),
    fila('cons', null, 0, 5.7648, 15.7), fila('lt', lt, 0, 1.0, 15.7)];
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
ok(inf.cols.join(',') === 'none,std,winter,cons,lt' && inf.ltProf === 'SP_45W_6Ah_LT',
  'las columnas son none,std,winter,cons y, para un perfil sin calefactor, la -LT apuntando a su gemelo (' + inf.ltProf + '); «plano» ya no está', inf.cols.join(','));
ok(inf.colsDeLT.indexOf('lt') < 0, 'y el propio perfil -LT no la trae (no hay gemelo del gemelo)', inf.colsDeLT.join(','));
ok(inf.chgStdFrio === 0 && inf.chgLTFrio > 0,
  'la columna -LT SIMULA con el perfil calefactado: a −10 °C el estándar capta 0 Wh y la -LT ' + inf.chgLTFrio.toFixed(0) + ' Wh',
  'std ' + inf.chgStdFrio + ' · lt ' + inf.chgLTFrio);
ok(inf.mejor === 'cons' && inf.minZero === 0 && inf.descartados.join(',') === 'none,std,winter',
  'el «más favorable» descarta a los que agotan la batería, ignora la columna -LT y elige «cons» (el único con 0 h)',
  'mejor ' + inf.mejor + ' · minZero ' + inf.minZero + ' · descartados ' + inf.descartados.join(','));
ok(inf.mejorVacio, 'y sin comparativa no inventa veredicto');
ok(inf.barrido.res.join(',') === '2013' && inf.barrido.caidos.join(' | ') === '2014:HTTP 429 tras 4 intentos | 2015:no está en la fuente | 2016:serie incompleta (288 h)',
  'el barrido LISTA los años que no bajaron, con motivo, en vez de saltarlos', JSON.stringify(inf.barrido));
ok(inf.alTercero.llamadas === 3 && inf.alTercero.filas === 3 && !inf.alTercero.error,
  'un 429 se reintenta: dos rechazos y al tercero baja', JSON.stringify(inf.alTercero));
ok(inf.nunca.llamadas === 4 && inf.nunca.error === 'HTTP 429' && inf.nunca.intentos === 4 && !inf.nunca.esNull,
  'y si persiste vuelve DECLARADO: {error:"HTTP 429", intentos:4}, nunca null', JSON.stringify(inf.nunca));

/* ── 5) UNA TCU MUERTA NO SIGUE AL SOL ──
   «Sin gestión» salía con 66 h de batería agotada y 100 % de producción: con
   SOC 0 % el seguidor seguía moviéndose sin energía. Se simula un perfil que
   no puede cargar (tMin imposible) hasta que muere, y después de muerta la
   posición tiene que quedarse clavada, el motor a 0 y la producción perdida
   contada. Y el interruptor «para el cliente» cambia el rótulo del informe. */
const muerta = await pg.evaluate(() => {
  const loc = { n: 'Banco', lat: 45.57, lon: 8.63 };
  const prof = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  const meteo = synthMeteo(loc, 8, 170, 10);                     /* verano despejado: hay sol que perder */
  const o = { motorModel: 'curva', winter: false, strategy: false, socTgt: 100, socCrit: 0, fcDays: 5, tMin: 99, poaMin: 0, mountTilt: null };
  const rows = simulate(meteo, prof, loc, 0.03, o);
  const i0 = rows.findIndex((r) => r.soc <= 0.001);
  const despues = rows.slice(i0 + 1);
  const S = summarize(rows);
  return { i0, n: despues.length,
    movTras: despues.reduce((a, r) => a + r.mov, 0),
    posDistintas: new Set(despues.map((r) => Math.round(r.pos * 100))).size,
    conSol: despues.filter((r) => r.poaPot > 0).length,
    perdida: S.prodLostPct, rel: S.prodRelPct, hZero: S.hZero };
});
ok(muerta.i0 > 0 && muerta.n > 24, 'el banco llega a matar la batería (' + muerta.i0 + ' h) y la observa ' + muerta.n + ' h después', JSON.stringify(muerta));
ok(muerta.movTras === 0 && muerta.posDistintas === 1,
  'muerta, la TCU no mueve nada: motor 0° y una sola posición durante ' + muerta.n + ' h',
  'mov ' + muerta.movTras + ' · posiciones ' + muerta.posDistintas);
ok(muerta.conSol > 0 && muerta.perdida > 0 && muerta.rel < 100,
  'y la producción de esas horas de sol se cuenta como perdida (' + muerta.perdida.toFixed(2) + ' %, relativa ' + muerta.rel.toFixed(2) + ' %)',
  JSON.stringify(muerta));
{
  const bat3 = readFileSync(path.join(RAIZ, 'bateria.html'), 'utf8');
  ok(bat3.includes('id="cliente"') && bat3.includes("paraCliente?'Documento elaborado por Factiun para el cliente.':'Uso interno de Factiun.'"),
    'el informe lleva interruptor «para el cliente» y sin él se rotula como uso interno');
}

/* ── 6) LA -LT NO LLEVA CALEFACTOR: ES OTRA QUÍMICA (2026-10-21) ──
   El mantenedor corrigió el modelo: la variante -LT no es una batería calentada,
   es una celda LiFePO4 de baja temperatura. De su ficha: carga −20..60 °C contra
   0..45 de la estándar, descarga −40..60 contra −10..60, y 6500 mAh en 8S2P
   contra 6000 en 8S1P. El modelo viejo le cobraba 1,0 + 0,15·|T| W de calefactor
   —consumo que no existe— y el informe lo imprimía como característica del
   producto, en un documento para cliente. */
const quim = await pg.evaluate(() => {
  const loc = { n: 'Banco', lat: 45.57, lon: 8.63 };
  const sin = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  const lt = PROFILES.filter((p) => p.id === 'SP_45W_6Ah_LT')[0];
  const meteo = synthMeteo(loc, 10, 350, 20).map((m) => Object.assign({}, m, { temp: -10 }));
  const o = { motorModel: 'curva', winter: false, strategy: true, socTgt: 80, socCrit: 30, fcDays: 5, poaMin: 0, mountTilt: null };
  const corre = (prof, tMin) => summarize(simulate(meteo, prof, loc, 0.8, Object.assign({}, o, { tMin })));
  const R = {};
  /* a) ningún perfil declara calefactor, y nadie gasta un vatio en calentar */
  R.conFlagHeated = PROFILES.filter((p) => p.heated).map((p) => p.id);
  R.heatLT = corre(lt, -20).heatWh;
  R.heatSin = corre(sin, 0).heatWh;
  /* b) la ficha del equipo, tal y como la leyó el mantenedor */
  R.ficha = { lt: { wh: lt.wh, carga: lt.tCarga, descarga: lt.tDescarga, lt: !!lt.lt },
              sin: { wh: sin.wh, carga: sin.tCarga, lt: !!sin.lt } };
  /* c) a −10 °C la química decide quién carga: la estándar no, la LT sí */
  R.chgSinA10 = corre(sin, 0).chg;
  R.chgLTa10 = corre(lt, -20).chg;
  /* d) la columna de EQUIPO trae su propio suelo aunque el panel diga 0 */
  const C = runControls(meteo, sin, loc, null, Object.assign({}, o, { tMin: 0 }));
  const col = C.filter((x) => x.c.k === 'lt')[0];
  R.colLT = col ? { prof: col.prof.id, tMinUsado: col.c.tMin, chg: col.S.chg } : null;
  R.colStd = C.filter((x) => x.c.k === 'std')[0].S.chg;
  return R;
});
ok(quim.conFlagHeated.length === 0, 'ningún perfil se declara calefactado', 'siguen con heated: ' + quim.conFlagHeated.join(', '));
ok(quim.heatLT === 0 && quim.heatSin === 0,
  'y a −10 °C nadie gasta un vatio en calentar (el calefactor se fue con la corrección)',
  'LT ' + quim.heatLT + ' Wh · estándar ' + quim.heatSin + ' Wh');
ok(quim.ficha.lt.lt && quim.ficha.lt.wh === 166.4 && quim.ficha.lt.carga.join() === '-20,60' && quim.ficha.lt.descarga.join() === '-40,60',
  'la -LT lleva la ficha real: 166,4 Wh, carga −20..60 °C, descarga −40..60 °C',
  JSON.stringify(quim.ficha.lt));
ok(!quim.ficha.sin.lt && quim.ficha.sin.wh === 153.6 && quim.ficha.sin.carga.join() === '0,45',
  'y la estándar la suya: 153,6 Wh, carga 0..45 °C', JSON.stringify(quim.ficha.sin));
ok(quim.chgSinA10 === 0 && quim.chgLTa10 > 0,
  'a −10 °C la estándar NO carga (0 Wh) y la -LT sí (' + quim.chgLTa10.toFixed(0) + ' Wh): lo decide la química, no un calefactor',
  'estándar ' + quim.chgSinA10 + ' · LT ' + quim.chgLTa10);
ok(quim.colLT && quim.colLT.tMinUsado === -20 && quim.colLT.chg > 0 && quim.colStd === 0,
  'la columna de EQUIPO usa el suelo de SU ficha (−20 °C) aunque el panel diga 0: capta ' + (quim.colLT ? quim.colLT.chg.toFixed(0) : '?') + ' Wh contra 0 de la estándar',
  JSON.stringify({ colLT: quim.colLT, colStd: quim.colStd }));
/* El suelo de carga del perfil llega a la simulación por el PANEL, y eso lo hace
   `sincronizaTmin()` al elegir equipo. Sin esa sincronía el suelo del equipo no
   entra en ninguna parte, así que se comprueba EN LA PÁGINA, moviendo el selector. */
const sincro = await pg.evaluate(() => {
  const idx = PROFILES.map((p, i) => [p.id, i]);
  const pon = (id) => { $('prof').value = String(idx.filter((x) => x[0] === id)[0][1]); $('prof').onchange(); return +$('tmin').value; };
  return { lt: pon('SP_45W_6Ah_LT'), sin: pon('SP_45W_6Ah'), ltString: pon('STRING_60W_6Ah_LT') };
});
ok(sincro.lt === -20 && sincro.ltString === -20 && sincro.sin === 0,
  'elegir equipo escribe SU suelo de carga en el panel: −20 °C las -LT, 0 °C la estándar',
  JSON.stringify(sincro));

{
  const bat4 = readFileSync(path.join(RAIZ, 'bateria.html'), 'utf8');
  const prometen = ['Versión calefactada', 'calefactor auto en LT', 'batería calefactada', 'con el calefactor activo']
    .filter((t) => bat4.includes(t));
  ok(prometen.length === 0,
    'y ningún texto de la página sigue prometiendo un calefactor que el equipo no tiene',
    'siguen: ' + prometen.join(' · '));
}

/* ── 7) EL PANEL ES UN EJE PROPIO (2026-10-21) ──
   En una TCU self-powered `chgW` ES el pico del panel. Hasta hoy venía pegado
   al perfil y sólo existían tres parejas de catálogo, así que estudiar «esta
   batería con otro panel» exigía inventar una entrada. Ahora el panel se elige
   aparte, y una pareja que NO está en el catálogo se declara como estudio para
   que nadie cotice un equipo que no existe. */
const pan = await pg.evaluate(() => {
  const seis = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  const lt = PROFILES.filter((p) => p.id === 'SP_45W_6Ah_LT')[0];
  const str = PROFILES.filter((p) => p.string)[0];
  const R = {};
  /* a) cambia el panel y SOLO el panel */
  const c30 = conPanel(seis, 30);
  R.combina = { id: c30.id, chgW: c30.chgW, wh: c30.wh, base: c30.base.id, whIgual: c30.wh === seis.wh };
  /* b) no toca lo que no debe: mismo vataje y perfiles STRING vuelven el original */
  R.mismoW = conPanel(seis, 45) === seis;
  R.string = conPanel(str, 90) === str;
  /* c) el catálogo se pregunta por el equipo, no por el id construido */
  R.cat = { real: enCatalogo(seis), c60: enCatalogo(conPanel(seis, 60)), c30: enCatalogo(c30), c90: enCatalogo(conPanel(seis, 90)) };
  /* d) la columna -LT sigue el panel elegido, buscando el gemelo por el MODELO */
  const cols = controlesPara(c30);
  const col = cols.filter((c) => c.k === 'lt')[0];
  R.colLT = col ? { id: col.prof.id, chgW: col.prof.chgW, wh: col.prof.wh } : null;
  R.ltDirecto = controlesPara(conPanel(lt, 30)).map((c) => c.k).indexOf('lt');
  /* e) el selector existe, trae el catálogo y arranca en el del modelo */
  const idx = PROFILES.map((p, i) => [p.id, i]);
  const pon = (id) => { $('prof').value = String(idx.filter((x) => x[0] === id)[0][1]); $('prof').onchange(); };
  pon('SP_45W_6Ah');
  R.selector = { ws: [].map.call($('panel').options, (o) => +o.value), valor: +$('panel').value, visible: $('panelFld').style.display !== 'none' };
  pon('STRING_60W_6Ah');
  R.selectorString = $('panelFld').style.display;
  pon('SP_45W_6Ah');
  /* f) más panel, más carga (igualdad de todo lo demás).
        EL RÉGIMEN IMPORTA: con sol de sobra los cuatro paneles llenan la batería
        y captan EXACTAMENTE lo mismo (457 Wh los cuatro, medido). Ahí la prueba
        pasaría por casualidad en una y sólo una dirección: no mide nada. Se mide
        con 85 % de nubes en invierno, que es donde el panel es el límite. */
  const loc = { n: 'Banco', lat: 45.57, lon: 8.63 };
  const meteo = synthMeteo(loc, 12, 350, 85);
  const o = { motorModel: 'curva', winter: false, strategy: false, socTgt: 100, socCrit: 0, fcDays: 5, tMin: 0, poaMin: 0, mountTilt: null };
  R.carga = [30, 45, 60, 90].map((w) => +summarize(simulate(meteo, conPanel(seis, w), loc, 0.3, o)).chg.toFixed(0));
  return R;
});
ok(pan.combina.chgW === 30 && pan.combina.id === 'SP_30W_6Ah' && pan.combina.whIgual && pan.combina.base === 'SP_45W_6Ah',
  'elegir panel cambia el panel y SOLO el panel: SP_45W_6Ah + 30 W → ' + pan.combina.id + ', misma batería, y recuerda de qué modelo sale',
  JSON.stringify(pan.combina));
ok(pan.mismoW && pan.string,
  'y no toca lo que no debe: el mismo vataje y los perfiles STRING vuelven el perfil original',
  'mismoW ' + pan.mismoW + ' · string ' + pan.string);
ok(pan.cat.real && pan.cat.c60 && !pan.cat.c30 && !pan.cat.c90,
  'el catálogo distingue producto de estudio: 45 W y 60 W existen, 30 W y 90 W no',
  JSON.stringify(pan.cat));
ok(pan.colLT && pan.colLT.id === 'SP_30W_6Ah_LT' && pan.colLT.chgW === 30 && pan.colLT.wh === 166.4,
  'la columna -LT sigue al panel elegido (' + (pan.colLT ? pan.colLT.id : '?') + '): el gemelo se busca por el MODELO, no por el id construido',
  JSON.stringify(pan.colLT));
ok(pan.ltDirecto < 0, 'y un perfil -LT con panel apartado sigue sin traer columna -LT (no hay gemelo del gemelo)');
ok(pan.selector.visible && pan.selector.ws.join() === '30,45,60,90' && pan.selector.valor === 45,
  'el selector trae el catálogo de paneles y arranca en el del modelo (45 W)', JSON.stringify(pan.selector));
ok(pan.selectorString === 'none',
  'y se esconde en STRING, donde chgW es el regulador del generador y no un panel', pan.selectorString);
ok(pan.carga[0] < pan.carga[1] && pan.carga[1] < pan.carga[2] && pan.carga[2] < pan.carga[3],
  'más panel, más carga captada: ' + pan.carga.join(' < ') + ' Wh para 30/45/60/90 W',
  pan.carga.join(' · '));
{
  const bat5 = readFileSync(path.join(RAIZ, 'bateria.html'), 'utf8');
  ok(bat5.includes('combinación de estudio, no de catálogo') && bat5.includes('no debe cotizarse como producto'),
    'y el informe declara en portada y en el apartado 5 cuando la pareja es de estudio y no de catálogo');
}

/* Y DE PUNTA A PUNTA, porque lo de arriba prueba `conPanel` y NO que el selector
   llegue a la simulación. Un mutante que quitaba `conPanel` del manejador de
   «Simular» no mataba NADA: el selector habría quedado de adorno, que es
   exactamente el defecto que este banco encontró esta mañana en el flag `winter`.
   Se conduce la página de verdad —fuente sintética, sin red— y se lee el perfil
   que la simulación guardó en LAST. */
const puntaApunta = await pg.evaluate(async () => {
  const idx = PROFILES.map((p, i) => [p.id, i]);
  $('prof').value = String(idx.filter((x) => x[0] === 'SP_45W_6Ah')[0][1]);
  $('prof').onchange();
  $('src').value = 'synth'; if ($('src').onchange) $('src').onchange();
  $('cmp').checked = false;
  $('panel').value = '90'; $('panel').onchange();
  $('run').click();
  for (let i = 0; i < 200 && (!window.LAST || LAST.prof.chgW !== 90); i++) await new Promise((r) => setTimeout(r, 50));
  const conNoventa = window.LAST ? { id: LAST.prof.id, chgW: LAST.prof.chgW, wh: LAST.prof.wh } : null;
  $('panel').value = '45'; $('panel').onchange();
  $('run').click();
  for (let i = 0; i < 200 && (!window.LAST || LAST.prof.chgW !== 45); i++) await new Promise((r) => setTimeout(r, 50));
  const conCuarenta = window.LAST ? { id: LAST.prof.id, chgW: LAST.prof.chgW, wh: LAST.prof.wh } : null;
  return { conNoventa, conCuarenta };
});
ok(puntaApunta.conNoventa && puntaApunta.conNoventa.chgW === 90 && puntaApunta.conNoventa.id === 'SP_90W_6Ah' && puntaApunta.conNoventa.wh === 153.6,
  'y el selector LLEGA a la simulación: con 90 W elegido, la corrida usa SP_90W_6Ah a 90 W con la batería de siempre',
  JSON.stringify(puntaApunta.conNoventa));
ok(puntaApunta.conCuarenta && puntaApunta.conCuarenta.chgW === 45 && puntaApunta.conCuarenta.id === 'SP_45W_6Ah',
  'y volver al panel del modelo devuelve el perfil del catálogo, sin rastro de la combinación',
  JSON.stringify(puntaApunta.conCuarenta));

await nav.close();
console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ bateria.html abre, el espejo no derrama, su poaAt es Perez, sus 19 canónicos salen del espejo, el informe no se contradice, una TCU muerta no sigue al sol, la -LT es una química y el panel es un eje propio'));
process.exit(fallos ? 1 : 0);
