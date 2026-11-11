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

/* EL ARRANQUE SE LEE AQUÍ, nada más abrir, y se afirma más abajo. Leerlo al
   final no mide el arranque: mide lo que la última prueba dejó puesto. Un
   mutante que cambiaba la elección inicial por un índice fijo no mataba nada
   justamente por eso. */
const ARRANQUE = await pg.evaluate(() => ({
  prof: PROFILES[+$('prof').value].id,
  panel: +$('panel').value,
  tmin: +$('tmin').value,
}));

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
ok(sincro.lt === -20 && sincro.ltString === -30 && sincro.sin === 0,
  'elegir equipo escribe SU suelo de carga en el panel: −20 °C la SP LT, −30 °C la STRING LTH, 0 °C la estándar',
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

/* ── 8) EL MODELO NOMBRA LA BATERÍA, NO LA PAREJA (2026-10-21) ──
   Reportado por el mantenedor: «¿por qué pone 6Ah 45W si lo de 45W lo elegimos
   después?». El catálogo listaba parejas panel+batería y el nombre las decía,
   que con el panel ya elegible aparte sobra y encima duplicaba: SP_45W_6Ah y
   SP_60W_6Ah son LA MISMA batería con otro panel. */
const mod = await pg.evaluate(() => {
  const R = {};
  /* a) ningún modelo SP OFRECIDO lleva el panel en el nombre; STRING sí lleva su
        regulador. Se mira lo ofrecido y no todo PROFILES: la variante oculta
        (SP_60W_6Ah) SÍ nombra su panel, porque es una pareja de catálogo y no un
        modelo, y exigirle lo contrario sería pedirle que mienta sobre lo que es. */
  R.sp = PROFILES.filter((p) => !p.string && !p.variante).map((p) => p.n);
  R.variantesNombranPanel = PROFILES.filter((p) => p.variante).map((p) => p.n);
  R.str = PROFILES.filter((p) => p.string).map((p) => p.n);
  /* b) el desplegable ofrece modelos, no parejas: una entrada por batería */
  R.opciones = [].map.call($('prof').options, (o) => PROFILES[+o.value].id);
  R.whsOfrecidos = R.opciones.map((id) => { const p = PROFILES.filter((q) => q.id === id)[0]; return p.string + '|' + p.wh + '|' + !!p.lt; });
  R.duplicados = R.whsOfrecidos.length !== new Set(R.whsOfrecidos).size;
  /* c) la variante oculta sigue en el catálogo, que es quien decide producto/estudio */
  const seis = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  R.variante = { estaEnProfiles: PROFILES.some((p) => p.id === 'SP_60W_6Ah'),
                 esProducto: enCatalogo(conPanel(seis, 60)),
                 treintaEsEstudio: !enCatalogo(conPanel(seis, 30)) };
  /* d) el arranque elige SP_45W_6Ah por id, no por un índice que se mueve */
  R.nPerfiles = PROFILES.length;
  /* e) el selector de panel marca cuáles son producto */
  R.etiquetas = [].map.call($('panel').options, (o) => o.text);
  return R;
});
ok(mod.sp.every((n) => !/panel\s*\d+\s*W/.test(n)) && mod.sp.some((n) => /6 Ah/.test(n)),
  'ningún modelo SP ofrecido lleva el panel en el nombre: ' + mod.sp.join(' · '), mod.sp.join(' · '));
ok(mod.variantesNombranPanel.length > 0 && mod.variantesNombranPanel.every((n) => /panel\s*\d+\s*W/.test(n)),
  'y la variante oculta SÍ lo nombra, porque es una pareja de catálogo: ' + mod.variantesNombranPanel.join(' · '),
  mod.variantesNombranPanel.join(' · '));
ok(mod.str.every((n) => /regulador 60 W/.test(n)),
  'y los STRING sí conservan su regulador, que no se elige aparte', mod.str.join(' · '));
ok(!mod.duplicados && mod.opciones.indexOf('SP_60W_6Ah') < 0 && mod.opciones.length === mod.nPerfiles - 1,
  'el desplegable ofrece una entrada por batería (' + mod.opciones.length + ' de ' + mod.nPerfiles + '): la pareja repetida SP_60W_6Ah se cae',
  mod.opciones.join(', '));
ok(mod.variante.estaEnProfiles && mod.variante.esProducto && mod.variante.treintaEsEstudio,
  'pero sigue en el catálogo: SP 6 Ah + 60 W es PRODUCTO y + 30 W es ESTUDIO',
  JSON.stringify(mod.variante));
ok(ARRANQUE.prof === 'SP_45W_6Ah' && ARRANQUE.panel === 45 && ARRANQUE.tmin === 0,
  'y la página ARRANCA en SP_45W_6Ah con su panel de serie (45 W) y su suelo de carga (0 °C), elegido por id y no por un índice que mover una entrada desplaza',
  JSON.stringify(ARRANQUE));
ok(/45 W — de serie/.test(mod.etiquetas.join('|')) && /60 W — de catálogo/.test(mod.etiquetas.join('|')) && /^30 W$/.test(mod.etiquetas[0]),
  'y el selector de panel distingue de serie, de catálogo y a secas: ' + mod.etiquetas.join(' · '),
  mod.etiquetas.join(' · '));

/* ── 9) EL CATÁLOGO CONTRA LA FICHA SUNNER (2026-10-21) ──
   El mantenedor: «la batería del string lt no es esa, mira cuál es». No lo era:
   llevaba la del SP. Fuente: DS_TCU_SUNNER_ES_v9.0.4 y el estudio de vida. */
const ficha = await pg.evaluate(() => {
  const g = (id) => PROFILES.filter((p) => p.id === id)[0];
  const r = (p) => ({ wh: p.wh, carga: p.tCarga.join('…'), descarga: p.tDescarga.join('…'),
                      com: p.comercial || null, celda: p.celda || null, lt: !!p.lt });
  return {
    spST: r(g('SP_45W_6Ah')), spLT: r(g('SP_45W_6Ah_LT')),
    strST: r(g('STRING_60W_6Ah')), strLTH: r(g('STRING_60W_6Ah_LT')),
    str33: r(g('STRING_60W_3Ah')), sp3: r(g('SP_45W_3Ah')),
    sp3SinFicha: !!g('SP_45W_3Ah').sinFicha,
    todosConDescarga: PROFILES.every((p) => Array.isArray(p.tDescarga)),
  };
});
ok(ficha.strLTH.wh === 153.6 && ficha.strLTH.carga === '-30…45' && ficha.strLTH.descarga === '-30…60' && ficha.strLTH.celda === '6000 mAh · 8S1P',
  'la variante fría del STRING es la SUYA (STR 6AH LTH 150): 153,6 Wh, 6000 mAh 8S1P, carga −30…45 °C',
  JSON.stringify(ficha.strLTH));
ok(ficha.spLT.wh === 166.4 && ficha.spLT.carga === '-20…60' && ficha.spLT.celda === '6500 mAh · 8S2P',
  'y la del SP sigue siendo la suya (SP 6,5AH LT 150): 166,4 Wh, 6500 mAh 8S2P, carga −20…60 °C',
  JSON.stringify(ficha.spLT));
ok(ficha.strLTH.wh !== ficha.spLT.wh && ficha.strLTH.carga !== ficha.spLT.carga,
  'o sea: las dos variantes frías NO son la misma batería, ni en capacidad ni en rango',
  JSON.stringify({ str: ficha.strLTH, sp: ficha.spLT }));
ok(ficha.str33.wh === 84.48 && ficha.str33.celda === '3300 mAh · 8S1P',
  'el STRING pequeño es de 3,3 Ah (3300 mAh → 84,48 Wh), no de 3 Ah', JSON.stringify(ficha.str33));
ok(ficha.sp3SinFicha && !ficha.sp3.com,
  'y el SP de 3 Ah queda marcado SIN contraparte en la ficha SUNNER, que no lista ningún SP de 3 Ah');
ok(ficha.spST.com === 'SP 6AH ST 150' && ficha.strST.com === 'STR 6AH ST 150' && ficha.strLTH.com === 'STR 6AH LTH 150',
  'cada perfil lleva su nombre comercial de la ficha, que nombra por batería y motor y no por panel',
  JSON.stringify([ficha.spST.com, ficha.strST.com, ficha.strLTH.com]));
ok(ficha.todosConDescarga, 'y todos declaran su rango de descarga, no sólo el de carga');
{
  const bat6 = readFileSync(path.join(RAIZ, 'bateria.html'), 'utf8');
  ok(bat6.includes('no debe citarse como garantía') && bat6.includes('más de 10 años') && bat6.includes('7 años'),
    'y el informe declara que su vida es CALCULADA y no la de la ficha (SUNNER: >10 años, 7 en caliente, ficha >6)');
}

/* MAPA DE DIMENSIONADO (capacidad × panel). Lo que tiene que cumplir para que
   sirva de algo: (a) la celda de lo simulado ES lo simulado — misma simulate,
   misma meteo; (b) más batería o más panel nunca da MÁS días a SOC 0 (sin
   estrategia, que es donde la física manda sola); (c) cambiar capacidad cambia
   SÓLO la capacidad; (d) en STRING no hay eje de panel. */
const mapa = await pg.evaluate(() => {
  const loc = { n: 'Banco', lat: 45.57, lon: 8.63 };
  const seis = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  const str = PROFILES.filter((p) => p.id === 'STRING_60W_6Ah')[0];
  const meteo = synthMeteo(loc, 30, 340, 85);
  const o = { motorModel: 'curva', winter: false, strategy: false, socTgt: 100, socCrit: 0, fcDays: 5, tMin: 0, poaMin: 0, mountTilt: null };
  const M = mapaDimensionado(meteo, seis, loc, 0.5, o);
  const i = M.caps.findIndex((c) => Math.abs(c - seis.wh) < 0.01), j = M.pans.indexOf(seis.chgW);
  const rows = simulate(meteo, seis, loc, 0.5, o), S = summarize(rows);
  const d = M.cel.map((r) => r.map((x) => x.dias));
  let monoCap = true, monoPan = true;
  for (let a = 1; a < d.length; a++) for (let b = 0; b < d[a].length; b++) if (d[a][b] > d[a - 1][b]) monoCap = false;
  for (let a = 0; a < d.length; a++) for (let b = 1; b < d[a].length; b++) if (d[a][b] > d[a][b - 1]) monoPan = false;
  const cc = conCapacidad(seis, 307.2);
  const MS = mapaDimensionado(synthMeteo(loc, 7, 340, 85), str, loc, 0.5, o);
  const dset = new Set(rows.filter((r) => r.soc <= 0.001).map((r) => Math.floor(+r.t / 864e5)));
  return { yo: M.cel[i][j], dias: dset.size, clase: [claseMapa({ dias: 0, inact: 50 }), claseMapa({ dias: 1, inact: 0 }), claseMapa({ dias: 0, inact: 0 })], inact: S.inactivePct, hZero: S.hZero, d,
    i, j, monoCap, monoPan, hayCero: d.flat().some((v) => v > 0), hayLibre: d.flat().some((v) => v === 0),
    cc: { wh: cc.wh, chgW: cc.chgW, base: cc.base.id }, catYo: M.cel[i][j].cat,
    strPans: MS.pans, strFilas: MS.cel.length };
});
ok(mapa.yo.dias === mapa.dias && mapa.yo.inact === mapa.inact && mapa.yo.hZero === mapa.hZero,
  'mapa de dimensionado: la celda de lo simulado ES lo simulado (' + mapa.dias + ' d a SOC 0, ' + mapa.inact.toFixed(2) + ' %)', JSON.stringify(mapa.yo));
ok(mapa.monoCap && mapa.monoPan && mapa.hayCero && mapa.hayLibre,
  'y más batería o más panel nunca dan MÁS días a SOC 0 (en un régimen que tiene celdas a 0 y con días a 0)', JSON.stringify(mapa.d));
/* Monótono no basta: un mapa que ignorase un eje sería monótono (filas iguales).
   Los dos ejes tienen que MOVER la cifra en este régimen. */
ok(mapa.d[0][mapa.j] > mapa.d.at(-1)[mapa.j] && mapa.d[mapa.i][0] > mapa.d[mapa.i].at(-1),
  'y los dos ejes la mueven: con el panel de serie, de la batería menor a la mayor; con la de serie, del panel menor al mayor', JSON.stringify(mapa.d));
ok(mapa.cc.wh === 307.2 && mapa.cc.chgW === 45 && mapa.cc.base === 'SP_45W_6Ah' && mapa.catYo,
  'cambiar la capacidad cambia SÓLO la capacidad, y la combinación del catálogo se reconoce como tal', JSON.stringify(mapa.cc));
ok(mapa.clase.join() === 'bad,wn,ok',
  'el color lo pone la peor cifra: 0 días pero 50 % no disponible NO es verde (la TCU se salva aparcando)', mapa.clase.join());
ok(mapa.strPans.length === 1 && mapa.strPans[0] === 60 && mapa.strFilas >= 5,
  'en STRING el mapa no tiene eje de panel: una columna, la del regulador', JSON.stringify(mapa.strPans));

/* ── VIENTO × BATERÍA: ¿PUEDE ABANDERAR CUANDO HACE FALTA? (2026-11-11) ──
   La página abanderaba por viento y dejaba clavada la TCU agotada, y contaba por
   separado las horas abanderado y las horas a SOC 0. Lo que no contaba nadie es
   cuántas horas de viento coinciden con una TCU que no puede moverse.

   Las series van HECHAS A MANO, con la respuesta sabida antes de correr: noche
   cerrada y `tMin` imposible (no carga nunca), el seguimiento impuesto por `phi`
   y el lado del sol por `az`. Así cada cifra se puede escribir en el margen:
   un pulso de tres horas son tres horas.

   LO QUE ESTE BLOQUE NO COMPRUEBA: que la reserva de maniobra sea la real (es
   la del modelo de motor, sin viento), que el viento medio de la serie se
   parezca a la racha que abandera en planta, ni que la regla «la TCU agotada se
   queda donde estaba» sea la del firmware. Comprueba que el cruce CUENTA BIEN
   lo que la simulación ya decidió. */
const cruce = await pg.evaluate(async () => {
  const loc = { n: 'Banco', lat: 45.57, lon: 8.63 };
  const prof = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  const o = { motorModel: 'curva', winter: false, strategy: false, socTgt: 100, socCrit: 0, fcDays: 5, tMin: 99, poaMin: 0, mountTilt: null };
  const serie = (n, dtMin, f) => Array.from({ length: n }, (_, i) => Object.assign(
    { t: new Date(Date.UTC(2024, 0, 10, 0, 0) + i * dtMin * 60000), ghi: 0, dhi: 0, temp: 10, wind: 0, phi: 0, el: -0.3, az: -1 }, f(i)));
  const corre = (m, soc0) => { const rows = simulate(m, prof, loc, soc0, o); return { rows, X: cruceVientoBateria(rows, prof.wh, 'curva') }; };
  const total = (i) => (i >= 10 && i <= 12 ? { wind: 20 } : {});       /* 72 km/h: bandera total */
  const parcial = (i) => (i >= 10 && i <= 12 ? { wind: 12 } : {});     /* 43 km/h: sector parcial */
  const R = { cap: prof.wh, slew: SLEW_DPS, t1: WIND_T1, t2: WIND_T2 };

  /* la reserva: formas cerradas de los modelos que las tienen */
  R.eFactiun = energiaManiobraWh(-55, 55, 'factiun'); R.k0 = FISICA.e.K0; R.k1 = FISICA.e.K1;
  R.e2500 = energiaManiobraWh(-55, 55, 2500); R.vNom = FISICA.vNom;
  R.eCurva = energiaManiobraWh(-55, 55, 'curva');
  R.eCurvaMitades = energiaManiobraWh(-55, 0, 'curva') + energiaManiobraWh(0, 55, 'curva');
  R.eCurvaIda = energiaManiobraWh(0, 55, 'curva'); R.eCurvaVuelta = energiaManiobraWh(0, -55, 'curva');
  R.eNada = energiaManiobraWh(30, 30, 'curva');
  R.ePuntoMedio = FISICA.motorW(0) * (110 / SLEW_DPS / 3600);          /* lo que saldría sin integrar */
  R.eCanonBifila = FISICA.motorManiobraWh(110, 'bifila');              /* el ajuste de 8 barridos reales */

  /* a) batería sana, pulso de viento total */
  const a = corre(serie(24, 60, total), 0.5);
  R.a = a.X; R.aSocAntes = a.rows[9].soc; R.aSocDespues = a.rows[10].soc;
  R.aCoherente = a.rows.every((r) => r.stow === (r.stowLvl > 0) && (r.stowLvl > 0 ? r.pos === r.stowObj : r.stowObj === null) && r.dead === false);
  R.aCola = a.rows[13].stowLvl > 0 && a.rows[13].wind < WIND_T1;       /* la hora de histéresis: abanderado sin viento */
  /* b) agotada en plano, y una cuarta hora de viento entre los dos umbrales */
  R.b = corre(serie(24, 60, (i) => (i === 13 ? { wind: 12 } : total(i))), 0).X;
  /* c) agotada a +55° (como en defensa) y la bandera pide el otro lado · c2) pide ese mismo lado */
  R.c = corre(serie(24, 60, (i) => Object.assign({ phi: 55 }, total(i))), 0).X;
  R.c2 = corre(serie(24, 60, (i) => Object.assign({ phi: 55, az: 1 }, total(i))), 0).X;
  /* d) parcial: viva en el sector · d2) agotada DENTRO del sector, en otro ángulo · d3) agotada fuera */
  R.d = corre(serie(24, 60, (i) => Object.assign({ phi: 42, az: 1 }, parcial(i))), 0.5).X;
  R.d2 = corre(serie(24, 60, (i) => Object.assign({ phi: i < 10 ? 50 : 35, az: 1 }, parcial(i))), 0).X;
  R.d3 = corre(serie(24, 60, (i) => Object.assign({ phi: 10, az: 1 }, parcial(i))), 0).X;
  /* e) paso de 1 min: el viaje se ve */
  const e = corre(serie(120, 1, (i) => (i >= 30 && i <= 59 ? { wind: 20 } : {})), 0.5);
  R.e = e.X; R.ePos = e.rows.slice(30, 37).map((r) => Math.round(r.pos * 10) / 10);
  /* f) viva, pero con menos energía de la que cuesta su maniobra */
  const f = corre(serie(24, 60, (i) => (i >= 2 && i <= 4 ? { wind: 20 } : {})), 0.02);
  R.f = f.X; R.fSocAntes = f.rows[1].soc; R.fPos = f.rows[2].pos; R.fSoc = f.rows[2].soc; R.fMotor = f.rows[2].motor;
  R.fPide = energiaManiobraWh(0, -55, 'curva');
  /* g) dos episodios separados, y uno que ya está en marcha en la primera fila */
  R.g = corre(serie(48, 60, (i) => ((i <= 1 || (i >= 20 && i <= 21) || (i >= 40 && i <= 41)) ? { wind: 20 } : {})), 0.5).X;
  /* h) sin viento no hay nada que cruzar */
  R.h = corre(serie(24, 60, () => ({})), 0).X;

  /* i) contra el resumen que ya había: un año sintético, las cinco columnas */
  const base = { motorModel: 'curva', winter: false, strategy: true, socTgt: 80, socCrit: 30, fcDays: 5, tMin: 0, poaMin: 0, mountTilt: null };
  const anio = synthMeteo(loc, 365, 1, 55);
  const ctl = runControls(anio, prof, loc, null, base);
  R.anio = ctl.map((x) => { const X = cruceVientoBateria(x.rows, x.prof.wh, 'curva');
    return { k: x.c.k, hStow: x.S.hStow, hZero: x.S.hZero, hViento: X.hViento, hT2: X.hVientoT2, muerta: X.hFueraMuerta, bajo: X.hMuertaBajoAngulo,
      ep: X.episodios, sinE: X.epSinEnergia, reservaSoc: X.reservaSoc, cap: x.prof.wh,
      aMano: x.rows.filter((r) => r.wind >= WIND_T1 && r.soc <= 0.001 && r.dead).length }; });

  /* j) PANTALLA. Se pinta de verdad, con la agotada como configuración evaluada. */
  const mB = serie(24, 60, (i) => (i === 13 ? { wind: 12 } : total(i)));
  const rowsB = simulate(mB, prof, loc, 0, o), rowsA = simulate(mB, prof, loc, 0.5, o);
  const lee = () => {
    const c = document.querySelectorAll('#cruce');
    const t = document.querySelector('#cruceTbl');
    const filas = t ? [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())) : [];
    const clases = t ? [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.className)) : [];
    const chipAb = [...document.querySelectorAll('.chip')].filter((x) => /Abanderamiento/.test(x.textContent))[0];
    return { n: c.length, sub: c[0] ? c[0].querySelector('.sub').textContent : '', filas, clases,
      chip: chipAb ? { cls: chipAb.querySelector('.v').className, txt: chipAb.textContent } : null,
      peor: [...document.querySelectorAll('#cruce .cruce-peor')].map((x) => x.textContent),
      limites: (document.querySelector('#cruceLimites') || { textContent: '' }).textContent,
      barrido: (document.querySelector('#cruceBarrido') || { textContent: '' }).textContent,
      thBarrido: [...document.querySelectorAll('#out table.cmp th')].map((x) => x.textContent).filter((x) => /viento sin energía/.test(x)).length };
  };
  window.LAST = null;
  render(mB, rowsB, rowsA, prof, loc, o, null, null, null);
  R.pAgotada = lee();
  render(mB, rowsA, rowsB, prof, loc, o, null, null, null);
  R.pSana = lee();
  /* paso fino: la fila del tránsito lleva cifra y el aviso desaparece */
  const mE = serie(120, 1, (i) => (i >= 30 && i <= 59 ? { wind: 20 } : {}));
  const rowsE = simulate(mE, prof, loc, 0.5, o);
  render(mE, rowsE, rowsE, prof, loc, o, null, null, null);
  R.pFino = lee();
  /* con comparativa y con barrido: las columnas son las de la comparativa, y la frecuencia se dice */
  const corto = synthMeteo(loc, 12, 350, 60);
  const ctlC = runControls(corto, prof, loc, null, base);
  const sw = { list: [{ year: 2013, inact: 0, lost: 0, socMin: 0.5, hZero: 0, hStow: 3, hWind: 3, hWindDead: 0, epNoE: 0 },
                      { year: 2014, inact: 1, lost: 0, socMin: 0, hZero: 9, hStow: 5, hWind: 5, hWindDead: 4, epNoE: 1 }], worst: 2014, caidos: [], pedidos: 2 };
  render(corto, ctlC[1].rows, ctlC[0].rows, prof, loc, base, sw, null, ctlC);
  R.pCtl = lee(); R.ctlNombres = ctlC.map((x) => x.c.n);
  /* la columna -LT, en pantalla, con SU batería: el margen sale de 166,4 Wh y no de 153,6 */
  const colLTc = ctlC.filter((x) => x.c.k === 'lt')[0], iLT = ctlC.indexOf(colLTc);
  const margen = filasCruce()[10][1];
  R.ltPantalla = R.pCtl.filas[11][3 + iLT];
  R.ltConLaSuya = margen(cruceVientoBateria(colLTc.rows, colLTc.prof.wh, 'curva')).v;
  R.ltConLaDeSerie = margen(cruceVientoBateria(colLTc.rows, prof.wh, 'curva')).v;
  R.ltWh = [colLTc.prof.wh, prof.wh];

  /* k) INFORME: dice lo mismo que la pantalla, con las mismas filas */
  window.LAST = { meteo: mB, mng: rowsB, ref: rowsA, prof, loc, opts: o, soc0: 0, socModo: 'panel', sweep: sw, controls: ctlC };
  render(mB, rowsB, rowsA, prof, loc, o, sw, null, ctlC);
  const enPantalla = lee();
  const abre = window.open; let doc = '';
  window.open = () => ({ document: { write: (d) => { doc += d; }, close: () => {} } });
  let errInforme = '';
  try { buildReport(); } catch (err) { errInforme = String(err); }
  window.open = abre;
  const dp = new DOMParser().parseFromString(doc, 'text/html');
  const h3 = [...dp.querySelectorAll('h3')].filter((x) => /batería baja/.test(x.textContent))[0];
  let tabla = h3; while (tabla && tabla.tagName !== 'TABLE') tabla = tabla.nextElementSibling;
  const filasInf = tabla ? [...tabla.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())) : [];
  R.informe = { err: errInforme, largo: doc.length, filas: filasInf,
    pantalla: enPantalla.filas.map((f) => f.slice(0, 3)),
    barridoCol: [...dp.querySelectorAll('th')].some((x) => /h de viento sin energía/.test(x.textContent)),
    /* y la cifra de cada año, no sólo el rótulo: un mutante que dejaba la columna a rayas no mataba nada */
    barridoCeldas: [...dp.querySelectorAll('tr')].filter((tr) => /^201[34]/.test(tr.children[0].textContent.trim()) && tr.children.length === 6)
      .map((tr) => [tr.children[0].textContent.trim().slice(0, 4), tr.children[5].textContent.trim(), tr.children[5].className]),
    barridoFrase: /En\s+1 de 2\s+años simulados/.test(dp.body.textContent),
    ctlFila: [...dp.querySelectorAll('td')].some((x) => x.textContent.trim() === 'Horas de viento con la TCU sin energía'),
    limite: /es de energía, no de fuerza/.test(dp.body.textContent) };
  window.LAST = null;

  /* l) EL BARRIDO DE PUNTA A PUNTA, sin red. Lo de arriba pinta la columna con una
        lista fabricada: prueba la tabla y NO que el manejador de «Simular» rellene la
        cifra. Se conduce la página con la descarga sustituida por dos años hechos a
        mano —noche y −30 °C todo el año, así que la batería se agota con cualquier
        lógica— y sólo el primero tiene viento: doce pulsos de 3 h, uno al mes. */
  const yEnd = new Date().getFullYear() - 1, yA = yEnd - 1;
  const fetchReal = window.fetch; const pedidos = [];
  window.fetch = (u) => {
    const y = +(/start_date=(\d{4})/.exec(String(u)) || [])[1]; pedidos.push(y);
    const time = [], cero = [], temp = [], wind = [];
    for (let d = new Date(Date.UTC(y, 0, 1)); d.getUTCFullYear() === y; d = new Date(+d + 3600e3)) {
      time.push(d.toISOString().slice(0, 16)); cero.push(0); temp.push(-30);
      wind.push(y === yA && d.getUTCDate() === 20 && d.getUTCHours() >= 10 && d.getUTCHours() <= 12 ? 20 : 0);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ hourly: { time, shortwave_radiation: cero, diffuse_radiation: cero, temperature_2m: temp, windspeed_10m: wind } }) });
  };
  $('src').value = 'archive'; if ($('src').onchange) $('src').onchange();
  $('year').value = 'worst'; if ($('year').onchange) $('year').onchange();
  $('sweepFrom').value = String(yA);
  $('cmp').checked = false;
  $('run').click();
  for (let i = 0; i < 600 && !(window.LAST && LAST.sweep); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 200));
  window.fetch = fetchReal;
  const tSw = [...document.querySelectorAll('#out table.cmp')].filter((t) => /h viento sin energía/.test(t.textContent))[0];
  R.barrido = { yA, pedidos, hay: !!(window.LAST && LAST.sweep),
    lista: window.LAST && LAST.sweep ? LAST.sweep.list.map((x) => ({ y: x.year, hWind: x.hWind, hWindDead: x.hWindDead, epNoE: x.epNoE, hZero: x.hZero })) : [],
    frase: (document.querySelector('#cruceBarrido') || { textContent: '' }).textContent,
    celdas: tSw ? [...tSw.querySelectorAll('tr')].slice(1, 3).map((tr) => { const td = tr.children[tr.children.length - 1]; return [tr.children[0].textContent.replace(/[^0-9]/g, ''), td.textContent.trim(), td.className]; }) : [] };
  return R;
});
const cerca = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);
const X = cruce;
/* — la reserva — */
ok(cerca(X.eFactiun, 110 * X.k0 + X.k1 * 55 * 55, 1e-9),
  'viento×batería: la maniobra de tope a tope con el ajuste lineal da su forma cerrada, 110·K0 + K1·55² = ' + X.eFactiun.toFixed(3) + ' Wh', String(X.eFactiun));
ok(cerca(X.e2500, 2.5 * X.vNom * (110 / X.slew / 3600), 1e-9),
  'y con consumo medio de 2500 mA, I·V·t del viaje = ' + X.e2500.toFixed(3) + ' Wh', String(X.e2500));
ok(cerca(X.eCurva, X.eCurvaMitades, 1e-9) && cerca(X.eCurvaIda, X.eCurvaVuelta, 1e-12) && X.eNada === 0,
  'es aditiva, simétrica y no cobra una maniobra que no ocurre', [X.eCurva, X.eCurvaMitades, X.eCurvaIda, X.eCurvaVuelta, X.eNada].join(' · '));
ok(X.eCurva > X.ePuntoMedio * 1.3,
  'y se INTEGRA: con la curva medida, cobrar el viaje al ángulo del punto medio (0°) daría ' + X.ePuntoMedio.toFixed(2) + ' Wh en vez de ' + X.eCurva.toFixed(2),
  X.eCurva + ' vs ' + X.ePuntoMedio);
ok(Math.abs(X.eCurva - X.eCanonBifila) / X.eCanonBifila < 0.05,
  'cuadra con el ajuste de barridos reales del espejo (bífila, 110°: ' + X.eCanonBifila.toFixed(2) + ' Wh) a menos del 5 %', X.eCurva + ' vs ' + X.eCanonBifila);
ok(cerca(X.a.reservaWh, X.eCurva) && cerca(X.a.reservaSoc, X.eCurva / X.cap),
  'la reserva del cruce ES esa maniobra: ' + X.eCurva.toFixed(2) + ' Wh, el ' + (100 * X.eCurva / X.cap).toFixed(1) + ' % de la batería');
/* — a) sana — */
ok(X.a.hViento === 3 && X.a.hVientoT2 === 3 && X.aCola,
  'batería sana, pulso de 3 h: 3 h de viento — la hora de histéresis sigue abanderada y NO cuenta como viento', JSON.stringify([X.a.hViento, X.a.hVientoT2, X.aCola]));
ok(X.a.hFuera === 0 && X.a.hFueraMuerta === 0 && X.a.epFuera === 0 && X.a.vientoMaxFuera === null,
  'y el eje no está fuera de la bandera ni una', JSON.stringify(X.a));
ok(X.a.episodios === 1 && X.a.epMuertaAlEmpezar === 0 && X.a.epSinEnergia === 0 && X.a.epBajoReserva === 0,
  'un episodio, y llega con energía', JSON.stringify(X.a));
ok(cerca(X.a.socMinAlEmpezar, X.aSocAntes) && !cerca(X.aSocAntes, X.aSocDespues, 1e-3) && cerca(X.a.margenMinWh, X.aSocAntes * X.cap - X.eCurva),
  'el SOC del episodio es el de ANTES de la maniobra (' + (100 * X.aSocAntes).toFixed(2) + ' %), no el de después (' + (100 * X.aSocDespues).toFixed(2) + ' %), y el margen sale de él',
  JSON.stringify([X.a.socMinAlEmpezar, X.aSocAntes, X.aSocDespues, X.a.margenMinWh]));
ok(X.a.peorEpisodio.desde === 0 && X.a.peorEpisodio.hasta === -55 && cerca(X.a.peorEpisodio.pideWh, X.eCurvaIda),
  'y sabe qué maniobra le toca: de 0° a −55°, media travesía', JSON.stringify(X.a.peorEpisodio));
ok(X.aCoherente, 'las filas dicen lo mismo por los dos caminos: `stow` ⇔ nivel > 0, y con la TCU viva el eje está donde la bandera pide');
/* — b) agotada en plano — */
ok(X.b.hViento === 4 && X.b.hVientoT2 === 3,
  'agotada: 4 h de viento, 3 de ellas sobre el segundo umbral', JSON.stringify([X.b.hViento, X.b.hVientoT2]));
ok(X.b.hFuera === 4 && X.b.hFueraMuerta === 4 && X.b.hMuertaBajoAngulo === 4 && X.b.hFueraTransito === 0,
  'las 4 con el eje fuera de la bandera, las 4 por TCU sin energía y las 4 en plano', JSON.stringify(X.b));
ok(X.b.episodios === 1 && X.b.epMuertaAlEmpezar === 1 && X.b.epSinEnergia === 1 && X.b.epBajoReserva === 1 && X.b.epFuera === 1,
  'un episodio, que empieza sin energía y no puede con su maniobra', JSON.stringify(X.b));
ok(X.b.socMinAlEmpezar === 0 && cerca(X.b.margenMinWh, -X.eCurva),
  'y el margen es la reserva entera en negativo');
ok(X.b.vientoMaxFuera && X.b.vientoMaxFuera.viento === 20 && X.b.vientoMaxFuera.pos === 0 && X.b.vientoMaxFuera.pide === -55 && X.b.vientoMaxFuera.muerta === true
  && new Date(X.b.vientoMaxFuera.t).toISOString() === '2024-01-10T10:00:00.000Z',
  'el peor momento tiene fecha y posición: 72 km/h a las 10 h, eje a 0° y la bandera pidiendo −55°', JSON.stringify(X.b.vientoMaxFuera));
/* — c) el lado — */
ok(X.c.hFueraMuerta === 3 && X.c.hMuertaBajoAngulo === 0,
  'agotada a +55° y la bandera pide −55°: fuera de la bandera 3 h, pero inclinada — la segunda cifra se queda en 0', JSON.stringify([X.c.hFueraMuerta, X.c.hMuertaBajoAngulo]));
ok(cerca(X.c.peorEpisodio.pideWh, X.eCurva),
  'y su maniobra es la peor posible, la travesía entera');
ok(X.c2.hFuera === 0 && X.c2.epMuertaAlEmpezar === 1 && X.c2.epSinEnergia === 0 && X.c2.epBajoReserva === 1,
  'si la bandera pide el lado en que murió, está cubierta de casualidad: 0 h fuera, pero el episodio empieza sin energía y se dice', JSON.stringify(X.c2));
/* — d) parcial — */
ok(X.d.hViento === 3 && X.d.hVientoT2 === 0 && X.d.hFuera === 0,
  'viento entre umbrales: sector parcial, cubierto');
ok(X.d2.hFuera === 0 && X.d2.epMuertaAlEmpezar === 1,
  'el sector ES la bandera: agotada a 50° cuando el seguimiento pide 35° sigue dentro, y no cuenta como fuera', JSON.stringify(X.d2));
ok(X.d3.hFuera === 3 && X.d3.hMuertaBajoAngulo === 3,
  'agotada a 10° con el sector empezando en 30°: fuera las 3 h', JSON.stringify(X.d3));
/* — e) paso fino — */
ok(X.ePos.join() === '-10.2,-20.4,-30.6,-40.8,-51,-55,-55',
  'a paso de 1 min el eje tarda seis pasos en llegar a −55°', X.ePos.join());
ok(X.e.veTransito === true && cerca(X.e.hFueraTransito, 5 / 60, 1e-9) && X.e.hFueraMuerta === 0 && cerca(X.e.hFuera, 5 / 60, 1e-9) && cerca(X.e.hViento, 0.5, 1e-9),
  'y los cinco minutos de camino son tránsito, no batería (a −51° todavía no cubre: la tolerancia es 1°, no 5°)', JSON.stringify(X.e));
ok(X.a.veTransito === false,
  'a paso de 60 min el cruce declara que el tránsito no se puede ver');
/* — f) a crédito — */
ok(X.f.epSinEnergia === 1 && X.f.epMuertaAlEmpezar === 0 && X.f.epBajoReserva === 1 && X.fSocAntes > 0.001 && X.fSocAntes * X.cap < X.fPide,
  'viva pero con ' + (X.fSocAntes * X.cap).toFixed(2) + ' Wh para una maniobra de ' + X.fPide.toFixed(2) + ' Wh: el episodio sale como «sin energía para su maniobra»', JSON.stringify(X.f));
ok(X.fPos === -55 && X.fSoc === 0 && X.f.hFuera === 0,
  'y es el episodio quien lo delata: a paso horario la simulación da la maniobra por hecha (eje a −55°, SOC a 0) y las horas fuera salen a 0',
  JSON.stringify([X.fPos, X.fSoc, X.fMotor, X.f.hFuera]));
/* — g) h) recuento — */
ok(X.g.episodios === 3 && X.g.hViento === 6,
  'los episodios se cuentan por tramo, no por hora: tres pulsos de 2 h son 3 episodios y 6 h (uno ya en marcha en la primera fila)', JSON.stringify([X.g.episodios, X.g.hViento]));
ok(X.h.hViento === 0 && X.h.episodios === 0 && X.h.socMinAlEmpezar === null && X.h.margenMinWh === null && X.h.hFueraMuerta === 0,
  'sin viento no hay cruce: ni episodios ni SOC de episodio, aunque la batería esté agotada todo el periodo', JSON.stringify(X.h));
/* — i) contra el resumen — */
ok(X.anio.length === 5 && X.anio.every((c) => c.hViento > 0 && c.hViento <= c.hStow && c.hT2 <= c.hViento && c.muerta <= c.hZero && c.bajo <= c.muerta),
  'en un año entero las cifras encajan con el resumen que ya había: viento ≤ abanderado, sin energía ≤ horas a SOC 0', JSON.stringify(X.anio));
ok(X.anio.every((c) => c.muerta === c.aMano || c.muerta <= c.aMano),
  'y las horas sin energía nunca superan las que salen contando a mano viento y batería agotada', JSON.stringify(X.anio.map((c) => [c.muerta, c.aMano])));
ok(X.anio.filter((c) => c.k === 'lt')[0].reservaSoc < X.anio.filter((c) => c.k === 'std')[0].reservaSoc,
  'la columna -LT se cruza con SU batería: la misma maniobra es menos porcentaje de 166,4 Wh que de 153,6');
/* — j) pantalla — */
const pA = X.pAgotada, pS = X.pSana;
ok(pA.n === 1 && pA.filas.length === 12 && pA.filas[0].length === 3,
  'en pantalla hay UNA tarjeta, con once filas y dos columnas cuando no hay comparativa', JSON.stringify([pA.n, pA.filas.length, pA.filas[0]]));
ok(/4 h de viento con la TCU sin energía/.test(pA.sub) && pA.filas[3][1] === '4 h' && pA.clases[3][1] === 'bad' && pA.filas[3][2] === '0 h' && pA.clases[3][2] === 'ok',
  'el titular y la fila dicen las 4 h, en rojo la agotada y en verde la sana', pA.sub + ' · ' + JSON.stringify(pA.filas[3]));
ok(pA.chip && /bad/.test(pA.chip.cls) && /sin energía para abanderar/.test(pA.chip.txt),
  'y la cifra de abanderamiento de arriba deja de ser ciega a la batería: en rojo y con el motivo', JSON.stringify(pA.chip));
ok(pS.chip && !/bad/.test(pS.chip.cls) && /B2/.test(pS.chip.txt) && /llega con energía/.test(pS.sub) && /No todas las columnas/.test(pS.sub),
  'con la sana como evaluada, la cifra vuelve a su texto y el titular avisa de que la otra columna no llega', JSON.stringify([pS.chip, pS.sub]));
ok(pA.peor.length === 1 && /72 km\/h/.test(pA.peor[0]) && /10 ene 10h/.test(pA.peor[0]) && /0,0°/.test(pA.peor[0]) && /-55°/.test(pA.peor[0]),
  'el peor momento se dice con viento, fecha, posición y lo que pedía la bandera', pA.peor.join(' | '));
ok(/sin viento/.test(pA.limites) && /no la racha/.test(pA.limites) && /9,2 Wh/.test(pA.limites) && /6,0 %/.test(pA.limites) && /subtensión/.test(pA.limites),
  'y los límites van escritos donde se lee la cifra: sin viento, viento medio y no racha, y la reserva con su número', pA.limites.slice(0, 200));
ok(pA.filas[5][1] === '—' && /no se puede ver/.test(pA.limites),
  'a paso horario la fila del tránsito lleva una raya y no un cero, y se explica');
ok(X.pFino.filas[5][1] === '0,08 h' && X.pFino.clases[5][1] === 'wn' && !/no se puede ver/.test(X.pFino.limites),
  'a paso de 1 min lleva su cifra (0,08 h) y el aviso desaparece', JSON.stringify(X.pFino.filas[5]));
ok(X.pCtl.filas[0].length === 3 + X.ctlNombres.length && X.ctlNombres.every((n) => X.pCtl.filas[0].indexOf(n) >= 0),
  'con la comparativa, cada sistema de control tiene su columna', JSON.stringify(X.pCtl.filas[0]));
ok(/1 de 2/.test(X.pCtl.barrido) && /2014/.test(X.pCtl.barrido) && /no es una probabilidad de proyecto/.test(X.pCtl.barrido) && X.pCtl.thBarrido === 1,
  'y con el barrido, la frecuencia entre años se dice (1 de 2, el peor 2014) y la tabla del barrido gana su columna', X.pCtl.barrido);
ok(pA.barrido === '', 'sin barrido no se inventa frecuencia');
ok(X.ltPantalla === X.ltConLaSuya && X.ltConLaSuya !== X.ltConLaDeSerie && X.ltWh[0] !== X.ltWh[1],
  'la columna -LT se cruza en pantalla con SU batería (' + X.ltWh[0] + ' Wh): su margen es ' + X.ltPantalla + ' y no ' + X.ltConLaDeSerie,
  JSON.stringify([X.ltPantalla, X.ltConLaSuya, X.ltConLaDeSerie]));
/* — k) informe — */
ok(!X.informe.err && X.informe.largo > 5000, 'el informe se genera con el cruce dentro', X.informe.err);
ok(X.informe.filas.length === 12 && JSON.stringify(X.informe.filas) === JSON.stringify(X.informe.pantalla.map((f, i) => (i === 0 ? ['Cruce', 'Configuración evaluada', 'Sin gestión (referencia)'] : f))),
  'y sus once filas son las de la pantalla, cifra por cifra', JSON.stringify(X.informe.filas.slice(0, 4)) + ' vs ' + JSON.stringify(X.informe.pantalla.slice(0, 4)));
/* — l) barrido de punta a punta — */
const B = X.barrido, bA = B.lista.filter((x) => x.y === B.yA)[0], bB = B.lista.filter((x) => x.y === B.yA + 1)[0];
ok(B.hay && B.pedidos.join() === [B.yA, B.yA + 1].join() && bA && bB,
  'el barrido corre de punta a punta sin red, con dos años hechos a mano', JSON.stringify(B).slice(0, 300));
ok(bA && bA.hWind === 36 && bA.hWindDead === 36 && bA.epNoE === 12 && bB && bB.hWind === 0 && bB.hWindDead === 0 && bB.epNoE === 0,
  'y es el manejador de «Simular» quien rellena la cifra de cada año: 12 pulsos de 3 h con la batería agotada son 36 h; el año sin viento, 0', JSON.stringify(B.lista));
ok(/1 de 2/.test(B.frase) && new RegExp('hasta 36 h en ' + B.yA).test(B.frase),
  'la tarjeta lo resume como frecuencia: 1 de 2 años, hasta 36 h en ' + B.yA, B.frase);
ok(B.celdas.length === 2 && B.celdas.filter((c) => +c[0] === B.yA)[0][1] === '36' && /bad/.test(B.celdas.filter((c) => +c[0] === B.yA)[0][2])
  && B.celdas.filter((c) => +c[0] === B.yA + 1)[0][1] === '0' && !/bad/.test(B.celdas.filter((c) => +c[0] === B.yA + 1)[0][2]),
  'y la tabla del barrido lo lleva en su columna, en rojo el año que lo tiene', JSON.stringify(B.celdas));
ok(JSON.stringify(X.informe.barridoCeldas) === JSON.stringify([['2013', '0', ''], ['2014', '4', 'bad']]),
  'en el informe, la tabla año a año lleva la cifra de cada año: 0 en 2013 y 4 h, en rojo, en 2014', JSON.stringify(X.informe.barridoCeldas));
ok(X.informe.barridoCol && X.informe.barridoFrase && X.informe.ctlFila && X.informe.limite,
  'lleva la columna del barrido con su frase, la fila en la comparativa de controles y el límite declarado', JSON.stringify(X.informe).slice(0, 300));

await nav.close();
console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ bateria.html abre, el espejo no derrama, su poaAt es Perez, sus 19 canónicos salen del espejo, el informe no se contradice, una TCU muerta no sigue al sol, la -LT es una química, el panel es un eje propio, el mapa de dimensionado es la misma simulación, el modelo nombra la batería, el catálogo cuadra con la ficha SUNNER y el viento se cruza con la batería'));
process.exit(fallos ? 1 : 0);
