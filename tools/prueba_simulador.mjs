#!/usr/bin/env node
/* ============================================================================
   prueba_simulador.mjs — LO QUE NO SE VE EN UNA CAPTURA.

   Antes se llamaba `prueba_campo3d` porque nació del 3D, pero lo que fija ya no es
   solo eso: cubre lo que solo se nota USANDO la interfaz —cuántas veces se pinta, si
   un mando escribe el registro que dice su etiqueta, si el reproductor cuenta lo que
   está haciendo—. Todo eso se rompe sin que ninguna captura lo delate.

   ── de dónde viene ──

   El campo se puso lento y raro y nadie se enteró hasta que se miró: no había forma
   de comprobarlo sin abrirlo. Y lo que fallaba no era el coste —30 draw calls y 71k
   triángulos no ahogan a nadie— sino la CADENCIA: el único `render()` colgaba del
   repintado de la interfaz, estrangulado a 0,22 s, así que el 3D iba a 4,5 fps fijos
   y arrastrar la cámara no pintaba nada hasta el siguiente tick.

   Eso no se ve en una captura de pantalla. Se ve contando renders, que es lo que hace
   esto. Y de paso fija las cuatro cosas que hacían que se viera «raro»: paneles
   blancos sin células, el suelo cortado contra el cielo, la niebla comiéndose la
   planta y el campo abierto con medio cuadro fuera.

       node tools/prueba_simulador.mjs          # necesita playwright(-core) y Chromium

   No mide fps ni pretende hacerlo: un banco headless corre sobre render por software,
   donde la misma escena cuesta cien veces más que en una GPU. Un umbral de fps aquí
   diría más del contenedor que del código. Lo que se comprueba es lo que NO depende
   de la máquina: cuántas veces se pinta, cuándo, y qué hay en la escena.
   ============================================================================ */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const RAIZ = path.dirname(new URL('.', import.meta.url).pathname);
const PAG = pathToFileURL(path.join(RAIZ, 'simulador.html')).href;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try { ({ chromium } = await import('playwright-core')); }
  catch {
    console.error('falta playwright:  npm i -D playwright-core   (y un Chromium instalado)');
    process.exit(2);
  }
}

const EXE = process.env.CHROME_BIN || process.env.PLAYWRIGHT_CHROMIUM;
const nav = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
const pg = await nav.newPage({ viewport: { width: 1400, height: 900 } });
const rotos = [];
pg.on('pageerror', (e) => rotos.push(String(e.message)));

let fallos = 0;
function ok(c, m) {
  console.log((c ? '  ✓ ' : '  ✗ ') + m);
  if (!c) fallos++;
}

await pg.goto(PAG);
await pg.waitForTimeout(1200);
await pg.evaluate(() => {
  const b = [...document.querySelectorAll('button,[data-vista],.tab')]
    .find((x) => /campo|3d/i.test(x.textContent || ''));
  if (b) b.click();
});
await pg.waitForTimeout(1800);

const abre = await pg.evaluate(() => !!window.CAMPO);
ok(abre, 'la pestaña de campo 3D abre y monta el motor');
if (!abre) { console.log(rotos.join('\n')); await nav.close(); process.exit(1); }

const r = await pg.evaluate(async () => {
  const o = {}, C = window.CAMPO;

  /* contar renders es la medida: no cuánto tarda, sino cuántas veces se pinta */
  let R = 0;
  const orig = C.renderer.render.bind(C.renderer);
  C.renderer.render = (a, b) => { R++; return orig(a, b); };
  const cuenta = (seg, cada) => new Promise((ok2) => {
    R = 0; let f = 0; const t0 = performance.now();
    (function w() {
      f++; if (cada) cada(f);
      if (performance.now() - t0 < seg * 1000) requestAnimationFrame(w);
      else ok2({ render: R, frames: f, seg });
    })();
  });

  o.reposo = await cuenta(1.5);

  const cv = C.renderer.domElement, rc = cv.getBoundingClientRect();
  let px = rc.left + rc.width / 2, py = rc.top + rc.height / 2;
  const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
    pointerId: 1, clientX: x, clientY: y, bubbles: true, button: 0
  }));
  o.giro = await cuenta(1.2, () => { px += 2; ev('pointermove', px, py); }, ev('pointerdown', px, py));
  ev('pointerup', px, py);

  /* el campo entero dentro del cuadro, al abrir */
  const T = window.THREE, e = C._ext, v = new T.Vector3();
  C.camera.updateMatrixWorld();
  let dentro = 0, esq = 0;
  for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
    esq++;
    v.set(sx * e.x / 2, 0, sz * e.z / 2).project(C.camera);
    if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) dentro++;
  }
  o.encuadre = { dentro, esq };

  /* materiales, niebla y suelo */
  let conMapa = 0, mallas = 0;
  C.grupoPlanta.traverse((x) => {
    if (!x.isInstancedMesh) return;
    mallas++;
    if (x.material && x.material.map) conMapa++;
  });
  o.mallas = mallas;
  o.panelesConCelulas = conMapa;
  o.diag = Math.hypot(e.x, e.z);
  o.niebla = { near: C.scene.fog.near, far: C.scene.fog.far };
  o.suelo = C.suelo.geometry.parameters.width;
  o.autoSombras = C.renderer.shadowMap.autoUpdate;

  /* Lo que de verdad decide si la sombra sale en sierra no es el tamaño del recuadro
     sino el TEXEL PROYECTADO EN EL SUELO, que con sol rasante se estira por 1/sen(elev).
     Se mide a lo largo del día, acercado, que es cuando se ve. */
  o.texelSuelo = [7, 10.5, 13.5, 19].map((h) => {
    P.t.hora = h;
    for (let i = 0; i < 80; i++) P.paso(20);
    C.orbita.pon(46); C.actualiza(P);
    const s = C.sol.shadow.camera, n = C.sol.shadow.mapSize.x;
    const el = Math.max(0.05, (90 - P.tcus[0].solar.zen) * Math.PI / 180);
    return { h, elev: +(el * 180 / Math.PI).toFixed(0),
             cm: +((s.top - s.bottom) / n / Math.sin(el) * 100).toFixed(1) };
  });
  C.encuadra();

  /* BIFILA: dos vigas por equipo, y la electrónica en UNA sola. Si esto se rompe, el
     campo vuelve a enseñar la mitad de la estructura y el doble de TCU. */
  const S = window.Seguidor;
  const clavesDe = (opts) => S.instancePlan(T, opts).map((p) => p.key);
  const soloOeste = /tcu|motor|secc|antena/;
  o.viga = {
    oeste: clavesDe({ detail: 'mass', west: true }).length,
    gemela: clavesDe({ detail: 'mass', west: false }).length,
    gemelaConElectronica: clavesDe({ detail: 'mass', west: false }).filter((k) => soloOeste.test(k)),
    sinOpcion: clavesDe({ detail: 'mass' }).length
  };
  o.dz = [...new Set(C.piezas.map((p) => (p.mT ? +p.mT.elements[14].toFixed(2) : 0)))].sort((a, b) => a - b);
  o.eje = !!S.ejeTransGeom;

  /* Nada enterrado ni flotando: el eje del tubo a la altura del poste y el poste
     tocando el suelo. Estaba todo 2 m mas abajo, con 1,10 m de poste bajo tierra. */
  const caja = new T.Box3(), mm = new T.Matrix4();
  C.grupoPlanta.children.forEach((m) => {
    if (!m.isInstancedMesh) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, mm); caja.union(m.geometry.boundingBox.clone().applyMatrix4(mm)); }
  });
  o.alturas = { min: +caja.min.y.toFixed(2), max: +caja.max.y.toFixed(2), postH: S.DIMS.postH };

  /* el recuadro de sombras sigue a la camara: al acercarse, mas texels por metro */
  const cmTexel = () => {
    const sc = C.sol.shadow.camera;
    return +((sc.right - sc.left) / C.sol.shadow.mapSize.x * 100).toFixed(1);
  };
  C.orbita.pon(1e5); o.sombraLejos = cmTexel();
  C.orbita.pon(40);  o.sombraCerca = cmTexel();
  C.encuadra();

  /* los mandos de la NCU tienen que pasar por P.escribe(), no tocar el estado a mano */
  const vistas = [];
  const orig2 = P.escribe.bind(P);
  P.escribe = (d, i, dir, v) => { vistas.push(d + ':' + dir); return orig2(d, i, dir, v); };
  const pulsa = (id) => { vistas.length = 0; document.getElementById(id).click(); return vistas.slice(); };
  document.getElementById('fzSp').value = '1';
  document.getElementById('fzGrupo').value = '0';
  o.mandos = {
    forzar: pulsa('btnFzOn'),
    auto: pulsa('btnAuto'),
    manual: pulsa('btnManual'),
    off: pulsa('btnOff').length,
    seta: pulsa('btnSeta')
  };
  P.escribe = orig2;

  /* ── el reproductor de escenarios ──
     Costaba de usar por dos motivos, y los dos son comprobables: el badge decia
     «reproduciendo» con la simulacion parada, y la velocidad estaba en un deslizador
     del otro panel. */
  const $$ = (x) => document.getElementById(x);
  /* el reloj lo han movido las pruebas de sombras hasta el atardecer; se devuelve a la
     mañana o los eventos del guion ya habrian pasado y no habria nada que contar */
  P.t.hora = 9;
  const lista = $$('escLista');
  lista.selectedIndex = [...lista.options].findIndex((o) => /temporal/i.test(o.textContent));
  lista.dispatchEvent(new Event('change', { bubbles: true }));
  o.repro = { parado: $$('escEstado').textContent, falta: $$('escFalta').textContent };

  $$('escVel').value = '900';
  $$('escVel').dispatchEvent(new Event('change', { bubbles: true }));
  o.repro.velDesdeElSelector = $$('vel').value;
  $$('vel').value = '137';
  $$('vel').dispatchEvent(new Event('input', { bubbles: true }));
  o.repro.velSuelta = $$('escVel').value;
  o.repro.opciones = [...$$('escVel').options].length;

  $$('escVel').value = '900';
  $$('escVel').dispatchEvent(new Event('change', { bubbles: true }));
  $$('escPlay').click();
  o.repro.corriendo = $$('escEstado').textContent;
  const h0 = P.t.hora, hEv = ESC.eventos[ESC.i].h;
  $$('escSalta').click();
  /* el salto deja el reloj un minuto ANTES a proposito, para verlo llegar; ese minuto lo
     consume el bucle, asi que aqui se le dan los mismos pasos que daria el */
  const hSalto = P.t.hora;
  for (let i = 0; i < 3; i++) { P.paso(60); ESC.paso(P, P.t.hora); }
  o.repro.salto = { de: +h0.toFixed(2), hasta: +hSalto.toFixed(2), evento: hEv,
                    antesDe: +((hEv - hSalto) * 60).toFixed(1),
                    iTras: ESC.i, viento: +(P.meteo.viento * 3.6).toFixed(0) };
  $$('escPausa').click();
  o.repro.enPausa = $$('escEstado').textContent;
  o.repro.botonPausa = $$('escPausa').textContent;

  /* UNA SOLA vista: el guion arriba, el campo en medio y los registros abajo. Si vuelve
     a haber una pestana de escenarios aparte, se sigue un guion sin ver la planta. */
  o.vista = {
    pestanas: [...document.querySelectorAll('.tab')].map((t) => t.textContent.trim()),
    barraEnCampo: $$('escBarra').closest('#vcampo') !== null,
    guionEnCampo: $$('escGuion').closest('#vcampo') !== null,
    registrosEnCampo: !!$$('mb3d') && $$('mb3d').closest('#vcampo') !== null,
    regs: document.querySelectorAll('#mb3dCuerpo tbody tr').length,
    fuente: $$('mb3dFuente').textContent
  };

  /* EL GUION SE EDITA donde esta: hora, valor, quitar y anadir. */
  const filas = () => [...document.querySelectorAll('#escGuion .ev')];
  const ed = {};
  ed.filas = filas().length;
  const inHora = document.querySelector('#escGuion .hora');
  inHora.value = '11:15'; inHora.dispatchEvent(new Event('change', { bubbles: true }));
  const inVal = document.querySelector('#escGuion [data-c=v]');
  inVal.value = '95'; inVal.dispatchEvent(new Event('change', { bubbles: true }));
  ed.trasEditar = ESC.eventos.map((e) => `${e.h.toFixed(2)}:${e.v}`);
  ed.esMio = !!ESC._mio;
  [...document.querySelectorAll('#escGuion .quita')].pop().click();
  ed.trasQuitar = ESC.eventos.length;
  document.querySelector('#escAdd [data-add=av]').click();
  ed.trasAnadir = ESC.eventos.length;
  ed.tipos = [...new Set(ESC.eventos.map((e) => e.t))].sort();
  ed.ordenado = ESC.eventos.every((e, k, a) => k === 0 || a[k - 1].h <= e.h);
  o.editor = ed;

  /* Rehacer la planta no puede dejar geometrías tiradas en la GPU. Se PINTA después de
     cada reconstrucción: `info.memory` cuenta lo subido a la tarjeta, y sin un render
     por medio las mallas nuevas aún no están subidas — se leería un cero engañoso. */
  C.dibuja();
  const antes = C.renderer.info.memory.geometries;
  for (let i = 0; i < 4; i++) { C.construye(P); C.actualiza(P); C.dibuja(); }
  o.geom = { antes, despues: C.renderer.info.memory.geometries };

  /* el selector rehace el campo */
  const s = document.getElementById('filas');
  s.value = 'monofila'; s.dispatchEvent(new Event('change', { bubbles: true }));
  o.mono = { bifila: C.bifila, dz: [...new Set(C.piezas.map((p) => (p.mT ? 1 : 0)))] };
  s.value = 'bifila'; s.dispatchEvent(new Event('change', { bubbles: true }));
  o.vuelta = C.bifila;
  return o;
});

console.log('');
ok(r.reposo.render <= 2,
   `en reposo NO se pinta: ${r.reposo.render} renders en ${r.reposo.frames} frames`);
ok(r.giro.render >= r.giro.frames * 0.8,
   `girando se pinta en cada frame: ${r.giro.render} renders / ${r.giro.frames} frames`);
ok(r.encuadre.dentro === r.encuadre.esq,
   `al abrir cabe el campo entero: ${r.encuadre.dentro}/${r.encuadre.esq} esquinas en cuadro`);
ok(r.panelesConCelulas >= 1,
   `el módulo lleva sus células, no vidrio blanco liso (${r.panelesConCelulas} de ${r.mallas} mallas con textura)`);
ok(r.niebla.near > r.diag,
   `la niebla empieza PASADO el campo: ${r.niebla.near.toFixed(0)} m > ${r.diag.toFixed(0)} m de campo`);
ok(r.suelo > r.niebla.far,
   `el suelo llega más lejos que la niebla, así no se ve dónde acaba (${r.suelo.toFixed(0)} > ${r.niebla.far.toFixed(0)} m)`);
ok(r.autoSombras === false,
   'el mapa de sombras no se rehace en cada frame (solo cuando la escena se mueve)');
ok(r.geom.despues <= r.geom.antes + 2,
   `rehacer la planta no deja geometría en la GPU: ${r.geom.antes} → ${r.geom.despues} tras 4 reconstrucciones`);

console.log('');
ok(r.dz.length === 2 && r.dz[0] === -3 && r.dz[1] === 3,
   `el seguidor es BIFILA: dos vigas a ${r.dz.join(' y ')} m del centro`);
ok(r.viga.gemela < r.viga.oeste,
   `la gemela lleva menos piezas que la del motor (${r.viga.gemela} vs ${r.viga.oeste})`);
ok(r.viga.gemelaConElectronica.length === 0,
   'la gemela NO lleva TCU, motor, seccionador ni antena' +
   (r.viga.gemelaConElectronica.length ? ': ' + r.viga.gemelaConElectronica.join(', ') : ''));
ok(r.viga.sinOpcion === r.viga.oeste,
   `sin la opción west, instancePlan devuelve lo de siempre (${r.viga.sinOpcion})`);
ok(r.mono.bifila === false && r.mono.dz.join() === '0' && r.vuelta === true,
   'el selector monofila/bífila rehace el campo y vuelve');
ok(r.eje, 'el modelo trae el eje de transmisión, que es lo que mueve la viga gemela');
ok(r.alturas.min >= -0.01 && r.alturas.max > r.alturas.postH,
   `nada enterrado ni flotando: de ${r.alturas.min} a ${r.alturas.max} m, con el eje del tubo a ${r.alturas.postH} m`);
ok(r.sombraCerca < r.sombraLejos / 2,
   `el mapa de sombras se afina al acercarse: ${r.sombraLejos} → ${r.sombraCerca} cm por texel`);
const peor = r.texelSuelo.reduce((a, b) => (b.cm > a.cm ? b : a));
ok(peor.cm < 12,
   'el texel proyectado en el suelo se queda fino A CUALQUIER HORA — lo que quita la sierra: ' +
   r.texelSuelo.map((t) => `${t.elev}° ${t.cm}cm`).join(' · '));

console.log('');
ok(r.mandos.forzar.join() === 'ncu:40001',
   `forzar SP1 escribe el registro, no toca el estado: ${r.mandos.forzar.join(' ') || '(nada)'}`);
ok(r.mandos.auto.join() === 'ncu:40070' && r.mandos.manual.join() === 'ncu:40071',
   `AUTO y MANUAL escriben 40070/40071: ${r.mandos.auto.concat(r.mandos.manual).join(' ') || '(nada)'}`);
ok(r.mandos.off > 1,
   `OFF va equipo por equipo, porque la NCU no tiene ese registro: ${r.mandos.off} escrituras`);
ok(r.mandos.seta.length === 0,
   'la SETA no escribe nada: es una entrada de hardware, no un mando');

console.log('');
const R = r.repro;
ok(R.parado === 'en pausa',
   `el estado dice la verdad con la simulación parada: «${R.parado}» (decía «reproduciendo»)`);
ok(/faltan/.test(R.falta) && /parada/.test(R.falta),
   'y dice cuánto falta para el próximo evento, y que hay que darle a ▶');
ok(R.velDesdeElSelector === '900',
   `el selector de velocidad del reproductor mueve el de verdad (${R.velDesdeElSelector})`);
ok(R.velSuelta === '137' && R.opciones === 7,
   `una velocidad fuera de la lista sale como opción, no se disimula (×${R.velSuelta})`);
ok(R.corriendo === 'reproduciendo' && R.enPausa === 'en pausa' && R.botonPausa === '▶ Seguir',
   `reproduciendo → ${R.enPausa} con el botón del propio reproductor`);
ok(R.salto.antesDe > 0 && R.salto.antesDe <= 2,
   `⏩ deja el reloj justo antes del evento, para verlo llegar: ${R.salto.de} → ${R.salto.hasta} h (${R.salto.antesDe} min antes de las ${R.salto.evento}:00)`);
ok(R.salto.iTras > 0 && R.salto.viento === 45,
   `y el evento entra al seguir: viento ${R.salto.viento} km/h, ${R.salto.iTras} evento(s) hechos`);
ok(r.vista.barraEnCampo && r.vista.guionEnCampo && r.vista.registrosEnCampo,
   'guion, campo y registros en la MISMA vista: se sigue un escenario viendo moverse la planta');
ok(!r.vista.pestanas.some((t) => /^escenarios$/i.test(t)),
   `y no hay pestaña de escenarios aparte: ${r.vista.pestanas.join(' · ')}`);
ok(r.vista.regs >= 6,
   `los registros del equipo salen bajo el campo (${r.vista.regs} · ${r.vista.fuente})`);

console.log('');
const E = r.editor;
ok(E.filas >= 4, `el guion se pinta fila a fila, editable (${E.filas} eventos)`);
ok(E.trasEditar[0] === '11.25:95' && E.ordenado,
   `cambiar hora y valor se aplica y REORDENA: ${E.trasEditar.join(' · ')}`);
ok(E.esMio, 'tocar un ejemplo de la casa hace una copia: el D.1.1 sigue siendo el D.1.1');
ok(E.trasQuitar === E.filas - 1 && E.trasAnadir === E.filas,
   `quitar y añadir eventos: ${E.filas} → ${E.trasQuitar} → ${E.trasAnadir}`);
ok(E.tipos.includes('av'), `y el añadido es del tipo pedido (${E.tipos.join(', ')})`);

ok(rotos.length === 0, 'sin errores de JavaScript' + (rotos.length ? ': ' + rotos[0] : ''));

await nav.close();
console.log('\n' + (fallos ? `✗ ${fallos} FALLOS` : '✓ el simulador se pinta cuando toca, manda lo que dice y se ve como debe'));
process.exit(fallos ? 1 : 0);
