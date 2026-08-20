#!/usr/bin/env node
/* ============================================================================
   prueba_campo3d.mjs — QUE EL 3D NO VUELVA A IR TRABADO.

   El campo se puso lento y raro y nadie se enteró hasta que se miró: no había forma
   de comprobarlo sin abrirlo. Y lo que fallaba no era el coste —30 draw calls y 71k
   triángulos no ahogan a nadie— sino la CADENCIA: el único `render()` colgaba del
   repintado de la interfaz, estrangulado a 0,22 s, así que el 3D iba a 4,5 fps fijos
   y arrastrar la cámara no pintaba nada hasta el siguiente tick.

   Eso no se ve en una captura de pantalla. Se ve contando renders, que es lo que hace
   esto. Y de paso fija las cuatro cosas que hacían que se viera «raro»: paneles
   blancos sin células, el suelo cortado contra el cielo, la niebla comiéndose la
   planta y el campo abierto con medio cuadro fuera.

       node tools/prueba_campo3d.mjs            # necesita playwright(-core) y Chromium

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
  const sc = C.sol.shadow.camera;
  o.sombraCubre = Math.min(sc.right, sc.top) * 2;
  o.autoSombras = C.renderer.shadowMap.autoUpdate;

  /* Rehacer la planta no puede dejar geometrías tiradas en la GPU. Se PINTA después de
     cada reconstrucción: `info.memory` cuenta lo subido a la tarjeta, y sin un render
     por medio las mallas nuevas aún no están subidas — se leería un cero engañoso. */
  C.dibuja();
  const antes = C.renderer.info.memory.geometries;
  for (let i = 0; i < 4; i++) { C.construye(P); C.actualiza(P); C.dibuja(); }
  o.geom = { antes, despues: C.renderer.info.memory.geometries };
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
ok(r.sombraCubre >= r.diag,
   `las sombras cubren el campo entero, no solo el centro (${r.sombraCubre.toFixed(0)} m ≥ ${r.diag.toFixed(0)} m)`);
ok(r.autoSombras === false,
   'el mapa de sombras no se rehace en cada frame (solo cuando la escena se mueve)');
ok(r.geom.despues <= r.geom.antes + 2,
   `rehacer la planta no deja geometría en la GPU: ${r.geom.antes} → ${r.geom.despues} tras 4 reconstrucciones`);
ok(rotos.length === 0, 'sin errores de JavaScript' + (rotos.length ? ': ' + rotos[0] : ''));

await nav.close();
console.log('\n' + (fallos ? `✗ ${fallos} FALLOS` : '✓ el campo 3D se pinta cuando toca y se ve como debe'));
process.exit(fallos ? 1 : 0);
