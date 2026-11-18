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
  const fila = (k, prof, hZero, hRes, inact, years) => ({ c: { k, n: k, prof }, S: { hZero, hBajoReserva: hRes, inactivePct: inact, cyc: { years }, prodRelPct: 99 } });
  const C = [fila('none', null, 64, 80, 0.7306, 14.9), fila('std', null, 3, 9, 4.7260, 15.7), fila('winter', null, 6, 11, 4.0982, 15.2),
    fila('cons', null, 0, 0, 5.7648, 15.7), fila('lt', lt, 0, 0, 1.0, 15.7)];
  const e = eligeMejor(C);
  R.mejor = e.mejor.c.k; R.minRes = e.minRes; R.descartados = e.descartados.map((x) => x.c.k);
  /* y el caso que SEPARA los dos criterios: ninguna llega a cero, pero «std» —la de
     mejor disponibilidad— baja de la reserva. Con el criterio viejo ganaba ella. */
  const e2 = eligeMejor([fila('std', null, 0, 4, 3.0, 15.7), fila('cons', null, 0, 0, 5.0, 15.7)]);
  R.mejorPorReserva = e2.mejor.c.k; R.descartadosPorReserva = e2.descartados.map((x) => x.c.k);
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
ok(inf.mejor === 'cons' && inf.minRes === 0 && inf.descartados.join(',') === 'none,std,winter',
  'el «más favorable» descarta a los que bajan de la reserva, ignora la columna -LT y elige «cons» (el único con 0 h)',
  'mejor ' + inf.mejor + ' · minRes ' + inf.minRes + ' · descartados ' + inf.descartados.join(','));
ok(inf.mejorPorReserva === 'cons' && inf.descartadosPorReserva.join(',') === 'std',
  'y descarta por la RESERVA, no por el cero: con 0 h agotada las dos, cae la de mejor disponibilidad porque baja de lo que cuesta llegar a seguridad',
  'mejor ' + inf.mejorPorReserva + ' · descartados ' + inf.descartadosPorReserva.join(','));
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

/* ── 10) LA RESERVA PARA LLEGAR A SEGURIDAD Y EL FINAL DE VIDA (2026-11-18) ──
   Las dos vienen del informe de Track N Co para Casalmaggiore, que en esto nos ganaba. */
const res = await pg.evaluate(async () => {
  const loc = { n: 'Banco', lat: 45.57, lon: 8.63 };
  const seis = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  const R = {};
  /* a) la reserva, contra la cuenta a mano: 2 × ∫ de −55° a +55° de (K0 + K1·|θ|) */
  R.reserva = reservaWh('factiun');
  R.aMano = 2 * ((DEFENSE_POS + AXIS_MAX) * K0 + K1 * (AXIS_MAX * AXIS_MAX + DEFENSE_POS * DEFENSE_POS) / 2);
  /* b) el final de vida cambia la capacidad y nada más */
  const o = { motorModel: 'factiun', winter: false, strategy: true, socTgt: 80, socCrit: 30, fcDays: 5, tMin: 0, poaMin: 0, mountTilt: null };
  const meteo = synthMeteo(loc, 30, 340, 85);
  const nueva = simulate(meteo, seis, loc, 0.8, o), vieja = simulate(meteo, seis, loc, 0.8, Object.assign({}, o, { soh: SOH_FIN_VIDA }));
  R.cap = { nueva: nueva.capWh, vieja: vieja.capWh };
  R.margen = { nueva: summarize(nueva).margenMin, vieja: summarize(vieja).margenMin };
  /* c) diez días a oscuras y luego veinte de verano, con el SOC crítico al 5 %: por debajo
        de la reserva (16 Wh sobre 123), así que lo único que protege es el modo seguridad */
  const verano = synthMeteo(loc, 30, 170, 10);
  const oscuro = verano.map((m, i) => (i < 240 ? Object.assign({}, m, { ghi: 0, dhi: 0, poa: null }) : m));
  const oS = Object.assign({}, o, { socCrit: 5, soh: SOH_FIN_VIDA });
  const est = simulate(oscuro, seis, loc, 0.6, oS);
  const sin = simulate(oscuro, seis, loc, 0.6, Object.assign({}, oS, { strategy: false, socCrit: 0 }));
  R.entra = est.filter((r) => r.seg).length;
  R.sigueBajo = est.filter((r) => !r.parked && !r.stow && r.eLib < -1e-9).length;
  R.segFueraDeDefensa = est.filter((r) => r.seg && !r.stow && Math.abs(r.pos - DEFENSE_POS) > 0.01).length;
  const salidas = []; for (let i = 1; i < est.length; i++) if (est[i - 1].seg && !est[i].seg) salidas.push(est[i - 1].eLib);
  R.salidas = salidas.length; R.eDia = est.eDia; R.salidaPronto = salidas.filter((e) => e < est.eDia - 1e-9).length;
  R.varado = sin.filter((r) => r.eLib < 0 && !r.stow && Math.abs(r.pos - DEFENSE_POS) > 1).length;
  /* d) el panel lleva el final de vida a TODAS las columnas, la de referencia incluida */
  const idx = PROFILES.map((p, i) => [p.id, i]);
  $('prof').value = String(idx.filter((x) => x[0] === 'SP_45W_6Ah')[0][1]); $('prof').onchange();
  $('src').value = 'synth'; if ($('src').onchange) $('src').onchange();
  $('panel').value = '45'; $('panel').onchange();
  const corre = async (aged) => {
    $('aged').checked = aged; window.LAST = null; $('run').click();
    for (let i = 0; i < 200 && !window.LAST; i++) await new Promise((r) => setTimeout(r, 50));
    return window.LAST ? { mng: LAST.mng.capWh, ref: LAST.ref.capWh } : null;
  };
  R.conAged = await corre(true); R.sinAged = await corre(false);
  $('aged').checked = true; window.LAST = null; $('run').click();
  for (let i = 0; i < 200 && !window.LAST; i++) await new Promise((r) => setTimeout(r, 50));
  /* e) el informe: con todo bien salvo UNA hora bajo la reserva, el veredicto cae por ella */
  let doc = null; const abre = window.open;
  window.open = () => ({ document: { write: (d) => { doc = d; }, close: () => {} } });
  buildReport(); R.informe = doc;
  const tocado = LAST.mng.map((r) => Object.assign({}, r)); tocado.capWh = LAST.mng.capWh; tocado.eDia = LAST.mng.eDia;
  const k = Math.floor(tocado.length / 2); tocado[k].eLib = -0.5;
  const limpio = summarize(LAST.mng);
  R.limpio = { per: limpio.periodosRes, inact: limpio.inactivePct, lost: limpio.prodLostPct, socMin: limpio.socMin };
  /* y entrar en modo seguridad cuenta aunque al aparcar a tiempo no se llegue a cruzar */
  const enSeg = LAST.mng.map((r) => Object.assign({}, r)); enSeg[k].seg = true;
  R.segSinCruzar = { eLib: enSeg[k].eLib, per: summarize(enSeg).periodosRes };
  LAST.mng = tocado; doc = null; buildReport(); R.informeTocado = doc;
  window.open = abre;
  return R;
});
ok(Math.abs(res.reserva - res.aMano) < 1e-9 && Math.abs(res.reserva - 16.18) < 0.01,
  'la reserva es la peor maniobra a seguridad —110°, de −55° a la defensa en +55°— ×2 por viento: ' + res.reserva.toFixed(2) + ' Wh, igual que la cuenta a mano',
  res.reserva + ' contra ' + res.aMano);
ok(Math.abs(res.cap.vieja - 0.8 * 153.6) < 1e-9 && res.cap.nueva === 153.6 && res.margen.vieja < res.margen.nueva,
  'al final de vida la batería simula con el 80 % (' + res.cap.vieja.toFixed(2) + ' Wh) y el margen sobre la reserva baja (' +
  res.margen.nueva.toFixed(1) + ' → ' + res.margen.vieja.toFixed(1) + ' Wh)', JSON.stringify(res.cap) + ' ' + JSON.stringify(res.margen));
ok(res.entra > 0, 'el banco llega a meter a la estrategia en modo seguridad (' + res.entra + ' h): las comprobaciones que siguen no están vacías', String(res.entra));
ok(res.sigueBajo === 0,
  'y una estrategia NUNCA sigue al sol por debajo de la reserva: el modo seguridad es predictivo, decide antes de gastar la hora', res.sigueBajo + ' h siguiendo bajo la reserva');
ok(res.segFueraDeDefensa === 0, 'en modo seguridad el seguidor está en defensa (+55°), no donde le pilló', res.segFueraDeDefensa + ' h fuera');
ok(res.salidas > 0 && res.salidaPronto === 0,
  'y sólo sale con la reserva MÁS un día de invierno (' + res.eDia.toFixed(1) + ' Wh por encima): ' + res.salidas + ' salida(s), ninguna antes',
  'salidas ' + res.salidas + ' · prematuras ' + res.salidaPronto);
ok(res.varado > 0,
  'sin gestión, en la misma serie, el seguidor se queda sin reserva LEJOS de la defensa (' + res.varado + ' h): el riesgo que la reserva cierra', String(res.varado));
ok(res.conAged && res.sinAged && Math.abs(res.conAged.mng - 122.88) < 1e-9 && Math.abs(res.conAged.ref - 122.88) < 1e-9 &&
   res.sinAged.mng === 153.6 && res.sinAged.ref === 153.6,
  'el interruptor del panel LLEGA a la simulación y a la columna de referencia: 122,88 Wh marcado, 153,6 sin marcar',
  JSON.stringify({ con: res.conAged, sin: res.sinAged }));
ok(res.segSinCruzar.eLib > 0 && res.segSinCruzar.per === 1,
  'ENTRAR en modo seguridad ya cuenta como periodo sin reserva, aunque la batería no llegue a cruzarla: como en Track N Co',
  JSON.stringify(res.segSinCruzar));
ok(res.informe && res.informe.includes('Margen sobre la reserva') && res.informe.includes('Capacidad evaluada') &&
   res.informe.includes('final de vida') && res.informe.includes('Veces bajo la reserva'),
  'el informe imprime la reserva, el margen sobre ella y la capacidad evaluada al final de vida');
ok(res.limpio.per === 0 && res.limpio.inact < 1 && res.limpio.lost < 0.1 && res.limpio.socMin > 0.05 &&
   res.informe.includes('<b>cumple</b>') && res.informeTocado && res.informeTocado.includes('<b>presenta riesgo</b>') &&
   res.informeTocado.includes('Baja 1 vez') && res.informeTocado.includes('no puede ponerse a salvo'),
  'y el veredicto CAE por la reserva: la misma corrida que cumple, con una sola hora sin reserva, pasa a «presenta riesgo» y dice por qué',
  JSON.stringify(res.limpio));

/* ── 11) TREINTA AÑOS SEGUIDOS (hito 2, 2026-11-18) ──
   Lo segundo que Track N Co hacía mejor: la serie entera de un tirón, sin reiniciar la
   batería cada enero, en inviernos de julio a junio, y con el periodo que gobierna. */
const seg = await pg.evaluate(async () => {
  const loc = { n: 'Banco', lat: 45.57, lon: 8.63 };
  const seis = PROFILES.filter((p) => p.id === 'SP_45W_6Ah')[0];
  const o = { motorModel: 'factiun', soh: SOH_FIN_VIDA, winter: false, strategy: true, socTgt: 80, socCrit: 30, fcDays: 5, tMin: 0, poaMin: 0, mountTilt: null };
  const bis = (y) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
  /* un año sintético FECHADO en `y`, con días a oscuras opcionales: [d0, d1) o una lista de ellos */
  const ano = (y, oscuro) => { const tramosOsc = !oscuro ? [] : Array.isArray(oscuro[0]) ? oscuro : [oscuro];
    return synthMeteo(loc, bis(y) ? 366 : 365, 1, 40).map((m, i) => {
      const t = new Date(Date.UTC(y, 0, 1) + i * 36e5), d = Math.floor(i / 24);
      const r = Object.assign({}, m, { t });
      return tramosOsc.some((o) => d >= o[0] && d < o[1]) ? Object.assign(r, { ghi: 0, dhi: 0, poa: null }) : r;
    }); };
  const R = {};
  /* a) un hueco parte la serie en tramos; una serie corta también */
  const T = tramosContinuos([ano(2001), { error: 'HTTP 429', intentos: 4 }, ano(2003), ano(2004), ano(2005).slice(0, 500), ano(2006)],
    [2001, 2002, 2003, 2004, 2005, 2006]);
  R.tramos = T.map((t) => t.years.join('+') + ':' + t.meteo.length);
  /* b) julio a junio */
  R.inv = [inviernoDe(new Date(Date.UTC(1997, 5, 30, 23))), inviernoDe(new Date(Date.UTC(1997, 6, 1, 0))), etiquetaInvierno(1999)];
  /* c) el estado PASA de un año al siguiente: 2001 acaba con 20 días a oscuras */
  const dos = tramosContinuos([ano(2001, [345, 365]), ano(2002)], [2001, 2002]);
  const rows = simulaSeguido(dos, seis, loc, o);
  const k = rows.findIndex((r) => r.t.getUTCFullYear() === 2002);
  R.cruce = { finAno: rows[k - 1].soc, eneroSiguiente: rows[k].soc, arranque: !!rows[k].arranque, primero: !!rows[0].arranque,
    objetivo: socEstacionario(o), capWh: rows.capWh };
  /* d) los inviernos cubren la serie entera, contiguos, y sólo el del medio es completo */
  const W = porInviernos(rows);
  R.inviernos = W.map((w) => w.label + (w.parcial ? '*' : ''));
  R.contiguos = W.every((w, i) => i === 0 || w.i0 === W[i - 1].i1) && W[0].i0 === 0 && W[W.length - 1].i1 === rows.length;
  /* e) el periodo que gobierna: diez días a oscuras a mitad de enero de 2002 */
  const gTr = tramosContinuos([ano(2001), ano(2002, [10, 20])], [2001, 2002]);
  const gRows = simulaSeguido(gTr, seis, loc, o), G = periodoQueGobierna(gRows, o), CR = cuentaReserva(gRows, 1);
  const lleno = o.socTgt / 100 - 0.05;
  R.gob = { t: G.t.toISOString().slice(0, 10), margen: G.margenMin, global: CR.margenMin, n: G.dias.length,
    antes: G.i0 > 0 ? gRows[G.i0 - 1].soc : null, despues: gRows[G.i1 - 1].soc, lleno, cortadoFin: G.cortadoFin, enMinimo: G.horasEnMinimo,
    /* el final de la meseta, calculado AQUÍ y no leído de la función que se prueba */
    diasTrasMeseta: (() => { let e = 0; gRows.forEach((r, i) => { if (r.eLib <= CR.margenMin + 1e-9) e = i; });
      const dE = Math.floor(+gRows[e].t / 864e5); return G.dias.filter((d) => d.d > dE).length; })(),
    subeAlFinal: G.dias[G.dias.length - 1].eFin > G.eMin + 1,
    finTrasMeseta: Math.floor(+gRows[G.i1 - 1].t / 864e5) - Math.floor(+gRows[G.iMin + G.horasEnMinimo - 1].t / 864e5),
    contiene: G.dias.some((d) => d.t.toISOString().slice(0, 10) === G.t.toISOString().slice(0, 10)),
    sumaChg: +G.dias.reduce((a, d) => a + d.chg, 0).toFixed(6), sumaFilas: +gRows.slice(G.i0, G.i1).reduce((a, r) => a + r.chg, 0).toFixed(6) };
  /* f) el invierno que gobierna: más veces sin reserva y, a igualdad, menos margen */
  R.peor = peorInvierno([{ label: 'a', periodosRes: 0, margenMin: 3 }, { label: 'b', periodosRes: 1, margenMin: 40 },
    { label: 'c', periodosRes: 1, margenMin: 9 }, { label: 'd', periodosRes: 0, margenMin: 1 }]).label;
  /* g) el «más favorable» mira la reserva de los 30 años, no sólo la del invierno que se enseña */
  const col = (k, h, h30, inact) => ({ c: { k, n: k }, S: { hZero: 0, hBajoReserva: h, inactivePct: inact, cyc: { years: 15 }, prodRelPct: 99 }, S30: { hBajoReserva: h30 } });
  const e30 = eligeMejor([col('std', 0, 5, 1.0), col('cons', 0, 0, 3.0)]);
  R.mejor30 = e30.mejor.c.k + ' / ' + e30.descartados.map((x) => x.c.k).join(',');
  /* h) de punta a punta, por la página: cinco años, y luego con uno que no baja */
  const yEnd = new Date().getFullYear() - 1;
  const fetchReal = window.fetchYearDeclarado;
  const corre = async (falla) => {
    /* una muerte en el invierno de yEnd−3 y DOS en el de yEnd−1: el que más veces falla es el
       posterior, pero el primer mínimo de la serie cae en el anterior. Es lo de Casalmaggiore. */
    window.fetchYearDeclarado = (l, y) => Promise.resolve(y === falla ? { error: 'HTTP 429', intentos: 4 }
      : ano(y, y === yEnd - 3 ? [5, 16] : y === yEnd - 1 ? [[5, 16], [36, 47]] : null));
    const idx = PROFILES.map((p, i) => [p.id, i]);
    $('prof').value = String(idx.filter((x) => x[0] === 'SP_45W_6Ah')[0][1]); $('prof').onchange();
    $('src').value = 'archive'; if ($('src').onchange) $('src').onchange();
    $('year').value = 'worst'; $('year').onchange(); $('sweepFrom').value = String(yEnd - 4);
    $('cmp').checked = true; $('aged').checked = true;
    window.LAST = null; $('run').click();
    for (let i = 0; i < 600 && !(window.LAST && LAST.sweep); i++) await new Promise((r) => setTimeout(r, 50));
    if (!window.LAST || !LAST.sweep) return null;
    let doc = null; const abre = window.open;
    window.open = () => ({ document: { write: (d) => { doc = d; }, close: () => {} } });
    buildReport(); window.open = abre;
    const sw = LAST.sweep, peor = sw.inviernos.filter((w) => w.label === sw.worst)[0];
    return { anos: sw.anos, n: sw.inviernos.length, parciales: sw.inviernos.filter((w) => w.parcial).length,
      tramos: sw.tramos.length, caidos: sw.caidos.length, worst: sw.worst,
      recorte: LAST.mng.length === peor.i1 - peor.i0 && LAST.mng.capWh === 122.88 && LAST.ref.length === LAST.mng.length,
      meteoAlineada: LAST.meteo.length === LAST.mng.length && +LAST.meteo[0].t === +LAST.mng[0].t,
      s30: (LAST.controls || []).every((x) => x.S30 && typeof x.S30.hBajoReserva === 'number'),
      dias: sw.gobierna.dias.length,
      gobDentro: inviernoDe(sw.gobierna.t) === peor.inv, peorEsPosterior: peor.inv === yEnd - 2,
      primerMinimoAntes: inviernoDe(sw.total.margenMinT) < peor.inv, doc };
  };
  const ok5 = await corre(null), conHueco = await corre(yEnd - 3);
  window.fetchYearDeclarado = fetchReal;
  R.e2e = ok5 && Object.assign({}, ok5, { doc: undefined,
    informe: ['años seguidos', 'Periodo que gobierna', 'Figura 5', '<svg', 'julio a junio', 'sin reiniciar la batería'].filter((x) => !ok5.doc.includes(x)) });
  R.hueco = conHueco && { tramos: conHueco.tramos, caidos: conHueco.caidos, dice: conHueco.doc.includes('Faltan años en la fuente') };
  R.gobAno = ok5 && ok5.worst;
  return R;
});
ok(seg.tramos.join(' | ') === '2001:8760 | 2003+2004:17544 | 2006:8760',
  'un año que no baja, o que baja corto, PARTE la serie en tramos: no se pega por encima del hueco', seg.tramos.join(' | '));
ok(seg.inv.join(',') === '1996,1997,1999/00', 'los inviernos van de julio a junio: el 30 de junio es del anterior y el 1 de julio del siguiente', seg.inv.join(','));
ok(seg.cruce.primero && !seg.cruce.arranque && Math.abs(seg.cruce.eneroSiguiente - seg.cruce.finAno) < 0.02 && seg.cruce.eneroSiguiente < seg.cruce.objetivo - 0.1,
  'el estado PASA de un año al siguiente: tras un diciembre a oscuras, el 1 de enero arranca con ' + (seg.cruce.eneroSiguiente * 100).toFixed(0) +
  ' % y no con el ' + (seg.cruce.objetivo * 100).toFixed(0) + ' % del objetivo', JSON.stringify(seg.cruce));
ok(seg.inviernos.join(',') === '2000/01*,2001/02,2002/03*' && seg.contiguos,
  'y los inviernos cubren la serie entera, contiguos, con el primero y el último marcados parciales', seg.inviernos.join(','));
ok(seg.gob.enMinimo > 24, 'el banco llega a dejar la batería plana en su mínimo más de un día (' + seg.gob.enMinimo + ' h): la meseta que cortaba la tabla', String(seg.gob.enMinimo));
ok(seg.gob.diasTrasMeseta >= 1 && seg.gob.subeAlFinal,
  'y la tabla ENSEÑA la recuperación: ' + seg.gob.diasTrasMeseta + ' día(s) completos después de la meseta, acabando por encima del mínimo',
  JSON.stringify({ tras: seg.gob.diasTrasMeseta, sube: seg.gob.subeAlFinal }));
ok(seg.gob.contiene && seg.gob.t >= '2002-01-11' && seg.gob.t <= '2002-01-21' && Math.abs(seg.gob.margen - seg.gob.global) < 1e-9,
  'el periodo que gobierna cae en los diez días a oscuras (' + seg.gob.t + ') y su mínimo es el de toda la serie', JSON.stringify(seg.gob));
ok(seg.gob.antes >= seg.gob.lleno && seg.gob.sumaChg === seg.gob.sumaFilas &&
   (seg.gob.despues >= seg.gob.lleno ? !seg.gob.cortadoFin : seg.gob.cortadoFin && seg.gob.finTrasMeseta === 5),
  'y va de la última vez que la batería estuvo en su objetivo a la primera que vuelve —o, si no vuelve, 5 días después de la meseta del mínimo, y lo DECLARA—, ' +
  'con la tabla diaria sumando lo mismo que las horas (' + seg.gob.n + ' días)',
  JSON.stringify(seg.gob));
ok(seg.peor === 'c', 'gobierna el invierno con más veces sin reserva y, a igualdad, el de menor margen', seg.peor);
ok(seg.mejor30 === 'cons / std',
  'el «más favorable» mira la reserva en TODOS los inviernos: una columna limpia en el que se enseña pero que falla en otro no sale recomendada', seg.mejor30);
ok(seg.e2e && seg.e2e.n === 6 && seg.e2e.parciales === 2 && seg.e2e.tramos === 1 && seg.e2e.caidos === 0 && seg.e2e.anos[1] - seg.e2e.anos[0] === 4,
  'por la página: cinco años seguidos son seis inviernos, dos de ellos parciales, en un solo tramo', JSON.stringify(seg.e2e));
ok(seg.e2e && seg.e2e.recorte && seg.e2e.meteoAlineada && seg.e2e.s30 && seg.e2e.dias > 0,
  'el detalle es el invierno que gobierna RECORTADO de la serie seguida, con su meteo alineada, y cada columna trae su reserva de los 30 años',
  JSON.stringify(seg.e2e));
ok(seg.e2e && seg.e2e.peorEsPosterior && seg.e2e.primerMinimoAntes,
  'el banco reproduce lo de Casalmaggiore: gobierna el invierno con dos muertes, pero el primer mínimo de la serie cae en uno anterior',
  JSON.stringify(seg.e2e && { worst: seg.e2e.worst, posterior: seg.e2e.peorEsPosterior, antes: seg.e2e.primerMinimoAntes }));
ok(seg.e2e && seg.e2e.gobDentro,
  'y el periodo que gobierna cae DENTRO del invierno que gobierna, no en otro que llegó antes al mismo mínimo', JSON.stringify(seg.e2e && { worst: seg.e2e.worst, dentro: seg.e2e.gobDentro }));
ok(seg.e2e && seg.e2e.informe.length === 0, 'y el informe lo cuenta: años seguidos, inviernos de julio a junio, la figura de márgenes y el periodo que gobierna',
  seg.e2e ? 'falta: ' + seg.e2e.informe.join(', ') : 'sin corrida');
ok(seg.hueco && seg.hueco.tramos === 2 && seg.hueco.caidos === 1 && seg.hueco.dice,
  'con un año que no baja, la página parte la serie en dos tramos y el informe lo DICE', JSON.stringify(seg.hueco));

await nav.close();
console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ bateria.html abre, el espejo no derrama, su poaAt es Perez, sus 19 canónicos salen del espejo, el informe no se contradice, una TCU muerta no sigue al sol, la -LT es una química, el panel es un eje propio, el mapa de dimensionado es la misma simulación, el modelo nombra la batería, el catálogo cuadra con la ficha SUNNER ninguna estrategia sigue al sol sin reserva para ponerse a salvo y los treinta años corren seguidos'));
process.exit(fallos ? 1 : 0);
