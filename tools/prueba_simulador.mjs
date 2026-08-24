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

/* La configuración de la planta tiene que estar puesta AL ABRIR, sin tocar el selector:
   la primera opción ya viene seleccionada y su `change` no se dispara nunca. */
const arranque = await pg.evaluate(() => {
  const L = PLANTAS[+document.getElementById('loc').value];
  return { planta: L.n, esReal: !L.lab, tcuCasilla: +document.getElementById('nTcu').value,
           tcuLayout: L.tcu || null, hsuCasilla: +document.getElementById('nHsu').value,
           enMotor: P.tcus.length };
});
ok(!arranque.esReal || arranque.tcuCasilla === arranque.tcuLayout,
   `al ABRIR ya está configurada la planta seleccionada: ${arranque.planta} → ` +
   `${arranque.tcuCasilla} TCU en la casilla (layout: ${arranque.tcuLayout})`);

/* A PARTIR DE AQUÍ, UNA ESCENA DE REFERENCIA. Las medidas de cadencia y de sombra se
   hacen sobre una planta pequeña y siempre la misma: si se miden sobre la que toque
   estar seleccionada, el día que la lista cambie de orden los números cambian solos.
   Con Ayora (754 uds) el render por software tarda tanto que en 1,5 s no caben ni cuatro
   frames y contar renders deja de significar nada. */
await pg.evaluate(() => {
  const s = document.getElementById('loc');
  const i = [...s.options].findIndex((o) => /Fayón/.test(o.textContent));
  if (i >= 0) { s.selectedIndex = i; s.dispatchEvent(new Event('change', { bubbles: true })); }
});
await pg.waitForTimeout(2500);

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
  /* Cabe el campo entero: se miden LOS SEGUIDORES con su largo, que es lo que el
     encuadre garantiza. Antes se medían las esquinas de la caja `_ext`, que lleva
     márgenes que no tienen por qué caber -- y con el encuadre ceñido a la planta,
     fallaba diciendo que faltaban esquinas cuando no falta ninguna. */
  const T = window.THREE, v = new T.Vector3();
  const semi = (window.Seguidor.DIMS.span || 34) / 2;
  C.camera.updateMatrixWorld();
  let dentro = 0, esq = 0;
  C.pos.forEach((q, i) => {
    const rr = C.rots ? C.rots[i] : 0;
    const cx = Math.cos(rr) * semi, cz = Math.sin(rr) * semi;
    [[-cx, -cz, 0], [cx, cz, 5]].forEach(([dx, dz, dy]) => {
      esq++;
      v.set(q.x + dx, dy, q.z + dz).project(C.camera);
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) dentro++;
    });
  });
  o.encuadre = { dentro, esq };
  /* y que además LLENE el cuadro: con la caja envolvente en vez de los seguidores, Ayora
     salía ocupando el 37 % del ancho y por debajo del centro */
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
  C.pos.forEach((q) => {
    v.set(q.x, 2, q.z).project(C.camera);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  });
  o.encuadre.ocupaX = Math.round((x1 - x0) / 2 * 100);
  o.encuadre.ocupaY = Math.round((y1 - y0) / 2 * 100);
  o.encuadre.centro = [+((x0 + x1) / 2).toFixed(2), +((y0 + y1) / 2).toFixed(2)];

  /* materiales, niebla y suelo */
  let conMapa = 0, mallas = 0;
  C.grupoPlanta.traverse((x) => {
    if (!x.isInstancedMesh) return;
    mallas++;
    if (x.material && x.material.map) conMapa++;
  });
  o.mallas = mallas;
  o.panelesConCelulas = conMapa;
  o.diag = Math.hypot(C._ext.x, C._ext.z);
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

  /* LA VIGA DEL MOTOR VA AL OESTE, que en este marco es +Z: lo dice el layout. Se
     reconoce porque lleva casi todas las piezas -- la gemela solo tiene el slew twin. */
  const porDz = {};
  C.piezas.forEach((p) => { const dz = p.mT ? +p.mT.elements[14].toFixed(1) : 0;
                            porDz[dz] = (porDz[dz] || 0) + 1; });
  const lados = Object.entries(porDz).sort((a, b) => b[1] - a[1]);
  o.oeste = { conMasPiezas: +lados[0][0], reparto: porDz };

  /* y el TESTIGO de salud va SOBRE EL MOTOR: centro del tubo, viga oeste. */
  const m0 = new T.Matrix4();
  C.testigos.getMatrixAt(0, m0);
  const pt = new T.Vector3().setFromMatrixPosition(m0);
  const pb = new T.Vector3().setFromMatrixPosition(C.bases[0]);
  o.testigo = [+(pt.x - pb.x).toFixed(1), +(pt.y - pb.y).toFixed(1), +(pt.z - pb.z).toFixed(1)];

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
    off: pulsa('btnOff').length
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

  $$('t3dVel').value = '900';
  $$('t3dVel').dispatchEvent(new Event('change', { bubbles: true }));
  o.repro.velDesdeElSelector = $$('vel').value;
  $$('vel').value = '137';
  $$('vel').dispatchEvent(new Event('input', { bubbles: true }));
  o.repro.velSuelta = $$('t3dVel').value;
  o.repro.opciones = [...$$('t3dVel').options].length;

  $$('t3dVel').value = '900';
  $$('t3dVel').dispatchEvent(new Event('change', { bubbles: true }));
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
                    iTras: ESC.i,
                    /* el evento fija lo PEDIDO; el viento va llegando con su rampa */
                    pedido: +(P.meteo.vientoObj * 3.6).toFixed(0),
                    viento: +(P.meteo.viento * 3.6).toFixed(0) };
  $$('t3dPlay').click();
  o.repro.enPausa = $$('escEstado').textContent;
  o.repro.botonPausa = $$('t3dPlay').textContent;

  /* LA VELETA apunta ADONDE SOPLA, no de donde viene. Se comprueba en las cuatro
     cardinales porque el signo de ese giro es facil de poner al reves -- y estuvo al
     reves. Norte es -X y este -Z en el marco del modelo. */
  const sopla = (grados) => {
    P.meteo.dirViento = grados; P.meteo.viento = 15; C.actualiza(P);
    const v = new T.Vector3(1, 0, 0).applyQuaternion(C.flechaViento.quaternion);
    const ejes = [['S', v.x], ['N', -v.x], ['O', v.z], ['E', -v.z]];
    ejes.sort((a, b) => b[1] - a[1]);
    return ejes[0][0];
  };
  o.veleta = { delN: sopla(0), delE: sopla(90), delS: sopla(180), delO: sopla(270) };

  /* EL HUD: los tres numeros que la escena no puede decir sola. */
  P.meteo.dirViento = 200; P.meteo.viento = 12; P.t.hora = 10.5;
  for (let i = 0; i < 120; i++) P.paso(20);
  pintaTodo();
  /* el HUD se lee CON SOL: a las 19:00 del 21 de diciembre pone «noche», y entonces no
     hay altura ni azimut que comprobar */
  P.t.dia = 172; P.t.hora = 12; P.paso(0.001); pintaTodo();
  o.hud = { txt: $$('hud3d').innerText.replace(/\s+/g, ' '), solVisible: C.solMesh.visible,
            dia: P.tcus[0].solar.dia };

  /* LA BANDERA TIENE DOS ESTADOS y el HUD tiene que distinguirlos: con el viento aun
     por encima del umbral no hay espera que contar (la histeresis se rearma en cada
     paso), y en cuanto amaina empiezan los 30 min de cuenta atras. */
  const celda = (k) => ([...document.querySelectorAll('#hud3d .ro')]
    .map((d) => d.innerText.replace(/\s+/g, ' ')).find((x) => x.toLowerCase().includes(k)) || '');
  o.bandera = { soplando: celda('bandera') };
  P.meteo.viento = 2; P.paso(10); pintaTodo();            /* amaina de golpe */
  o.bandera.amainado = celda('bandera');
  /* y se deja como estaba: los bloques de abajo dan por bueno el viento de antes */
  P.meteo.viento = 12;
  for (let i = 0; i < 20; i++) P.paso(20);
  P.t.hora = 12; P.paso(0.001); pintaTodo();

  /* ELEGIR PLANTA CONFIGURA LA PLANTA. Antes el emplazamiento solo movia la latitud:
     elegias El Burgo y seguias con 24 seguidores porque era lo que habia en la casilla. */
  const loc = $$('loc');
  const vaA = (n) => {
    const i = [...loc.options].findIndex((o) => o.textContent.includes(n));
    if (i < 0) return null;
    loc.selectedIndex = i; loc.dispatchEvent(new Event('change', { bubbles: true }));
    return { tcu: +$$('nTcu').value, hsu: +$$('nHsu').value, rep: +$$('nRep').value,
             filas: $$('filas').value, grupos: +$$('nGrup').value,
             lat: +P.loc.lat.toFixed(2), tz: P.loc.tz,
             campoN: C.n, plano: !!C.plano, reducido: !!C.detalleReducido,
             enRejilla: !C.plano };
  };
  o.plantas = { burgo: vaA('El Burgo'), tunez: vaA('Túnez'), gorraiz: vaA('Gorraiz') };
  /* las posiciones son las del layout, no una rejilla: en una rejilla todas las filas
     estan a la misma distancia y en un plano de verdad no */
  vaA('El Burgo');
  /* que NO es una rejilla se ve en la silueta: en una rejilla todas las columnas tienen
     los mismos seguidores; en un plano de verdad, no. Y las posiciones tienen que ser
     LAS DEL LAYOUT, no unas parecidas. */
  const porCol = {};
  C.pos.forEach((p) => { const k = p.z.toFixed(0); porCol[k] = (porCol[k] || 0) + 1; });
  o.plantas.columnas = [...new Set(Object.values(porCol))].length;
  const lay = PLANTAS_REALES.find((x) => x.k === 'elburgo');
  const mnN = Math.min(...lay.pos.map((q) => q[0])), mxN = Math.max(...lay.pos.map((q) => q[0]));
  const cN = (mnN + mxN) / 2;
  o.plantas.casaConLayout = Math.abs(-(lay.pos[0][0] - cN) - C.pos[0].x) < 0.2;

  /* LOS REGISTROS COMPUESTOS se leen. `battery_soh_and_soc` salia como 25157 -el crudo en
     decimal- porque la tabla no tenia columna de bits, y el mapa ademas declara soh y soc
     SOLAPADOS ([0,7] y [0,15]) tal como los lista el documento. */
  P.t.hora = 11; P.paso(0.001); pintaTodo();
  o.regs = {};
  [...document.querySelectorAll('#mb3dCuerpo tbody tr')].forEach((tr) => {
    const c = [...tr.querySelectorAll('td')].map((x) => x.textContent.trim());
    o.regs[c[0]] = { val: c[3], bits: (c[4] || '').slice(0, 40) };
  });

  /* EL DESLIZADOR DE TIEMPO, como en las demas paginas de la casa. Mover el reloj a
     mano no basta: sin un paso del motor el campo se queda con el angulo de antes. */
  /* condiciones limpias: las pruebas de antes dejaron viento de temporal y un forzado
     de posicion segura puestos, y con eso el objetivo se queda clavado en el sector de
     abanderamiento a cualquier hora -- no es la hora lo que fallaria, seria la prueba */
  P.meteo.viento = 0; P.meteo.rachas = 0; P.meteo.nieve = 0;
  for (let sp = 1; sp <= 7; sp++) P.escribe('ncu', 0, 40000 + sp, [0]);
  P.escribe('ncu', 0, 40070, [(1 << P.cfg.grupos) - 1]);
  P.t.dia = 172;
  for (let i = 0; i < 60; i++) P.paso(30);

  const desliza = (min, suelta) => {
    const r = $$('t3dHora');
    r.value = String(min);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    if (suelta) r.dispatchEvent(new Event('change', { bubbles: true }));
    return { h: +P.t.hora.toFixed(2), lbl: $$('t3dLbl').textContent,
             obj: +P.tcus[0].objetivo.toFixed(1), real: +P.tcus[0].anguloReal.toFixed(1) };
  };
  o.tiempo = { mañana: desliza(420, true), mediodia: desliza(780, true), tarde: desliza(1140, true) };

  /* ARRASTRAR COLOCA, no simula el camino. A 0,17 °/s cruzar los 110° son once minutos:
     si el deslizador simulara el transitorio, el campo iría siempre persiguiendo un
     objetivo que ya cambió. Se comprueba que basta con el evento `input` -- o sea
     mientras se arrastra, sin soltar-- y que la mesa queda EN su objetivo. */
  const arrastra = (min) => {
    const rr = $$('t3dHora');
    rr.value = String(min);
    rr.dispatchEvent(new Event('input', { bubbles: true }));   /* sin `change` */
    const t = P.tcus[0];
    return { h: +P.t.hora.toFixed(1), obj: +t.objetivo.toFixed(1),
             desv: +Math.abs(t.anguloReal - t.objetivo).toFixed(2) };
  };
  o.arrastre = [420, 660, 900, 1140].map(arrastra);

  /* dos excepciones, que son el motivo de que exista este simulador */
  const t2 = P.tcus[1];
  t2.setaLocal = true;
  for (let k = 0; k < 40; k++) P.paso(5);
  const antesSeta = t2.anguloReal;
  arrastra(660); arrastra(1020);
  o.setaQuieta = { motor: t2.motorHabilitado, movio: +Math.abs(t2.anguloReal - antesSeta).toFixed(2) };
  t2.setaLocal = false; t2.limpiaAlarmas();

  const t1 = P.tcus[0];
  t1.sensor.desajuste = 3;
  arrastra(600); arrastra(780);
  o.incMiente = +Math.abs(t1.angulo - t1.anguloReal).toFixed(2);
  t1.sensor.desajuste = 0;

  /* Y SE DEJA COMO SE ENCONTRÓ. Estas comprobaciones mueven el reloj y enclavan un
     equipo; las de más abajo daban por bueno el estado anterior y fallaban por eso —lo
     que rompía era la prueba, no el simulador. */
  P.tcus.forEach((t) => { t.setaLocal = false; t.cableSetaCortado = false; });
  for (let k = 0; k < 10; k++) P.paso(5);
  P.tcus.forEach((t) => t.limpiaAlarmas());
  for (let k = 0; k < 10; k++) P.paso(5);
  desliza(1140, true);                     /* el reloj donde lo dejó el bloque anterior */
  o.tiempo.panel = +$$('hora').value;
  $$('t3dDia').value = '355'; $$('t3dDia').dispatchEvent(new Event('input', { bubbles: true }));
  o.tiempo.dia = { n: P.t.dia, lbl: $$('t3dDiaLbl').textContent };
  $$('t3dDia').value = '172'; $$('t3dDia').dispatchEvent(new Event('input', { bubbles: true }));
  o.tiempo.tarjetas = [...document.querySelectorAll('#hud3d .ro')].length;

  /* EL RELOJ nunca puede dar las 09:60. Se redondeaba a minutos por separado, y 9,995 h
     son 59,7 min -> 60. Se barre el dia entero. */
  o.reloj = { malos: [], ejemplos: {} };
  for (let k = 0; k < 4000; k++) {
    const h = k * 24 / 4000, txt = hhmm(h);
    const [hh, mm] = txt.split(':').map(Number);
    if (mm > 59 || hh > 23) o.reloj.malos.push(h.toFixed(4) + '→' + txt);
  }
  ['9.995', '23.999', '0', '13.5'].forEach((x) => { o.reloj.ejemplos[x] = hhmm(+x); });

  /* y la NCU no tiene seta ni pulsador de parada: 30100.13 se publica a 0 y no hay
     ningun mando en la interfaz que lo pulse */
  P.tcus[0].setaLocal = true;
  for (let k = 0; k < 40; k++) P.paso(5);
  o.seta = {
    bitNcu: (P.regsNCU()[30100] >> 13) & 1,
    bitTcu: (P.regsTCU(P.tcus[0])[30002] >> 4) & 1,
    suyo: !!P.tcus[0].alarmaMotorEnclavada,
    otrosEnclavados: P.seguidores().filter((x) => x.alarmaMotorEnclavada && x !== P.tcus[0]).length,
    hayBoton: !!document.getElementById('btnSeta'),
    tiposAv: Escenario.TIPOS.av.ks.map((x) => x.k)
  };
  P.tcus[0].setaLocal = false;
  P.tcus.forEach((x) => x.limpiaAlarmas());
  for (let k = 0; k < 40; k++) P.paso(5);

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
/* El encuadre encaja con margen 0,93, pero el lienzo puede cambiar de alto DESPUÉS —al
   aparecer el aviso de detalle reducido, por ejemplo— y entonces el aspect ya no es el
   del encaje. Se admite que asome un extremo; lo que no se admite es que falte medio
   campo, que es de donde venimos. */
ok(r.encuadre.dentro >= r.encuadre.esq * 0.97,
   `al abrir cabe el campo: ${r.encuadre.dentro}/${r.encuadre.esq} extremos de mesa en cuadro`);
ok(r.encuadre.ocupaX > 55 && r.encuadre.ocupaY > 50 &&
   Math.abs(r.encuadre.centro[0]) < 0.25 && Math.abs(r.encuadre.centro[1]) < 0.25,
   `y lo LLENA, más o menos centrado: ocupa ${r.encuadre.ocupaX}% × ${r.encuadre.ocupaY}% · centro ${r.encuadre.centro}`);
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
ok(r.oeste.conMasPiezas > 0,
   `la viga del MOTOR va al oeste (+Z), como dice el layout: ${JSON.stringify(r.oeste.reparto)}`);
ok(r.testigo[0] === 0 && r.testigo[1] > 0 && r.testigo[2] === r.oeste.conMasPiezas,
   `y el testigo de salud va SOBRE EL MOTOR, no en una punta: ${r.testigo.join(', ')} desde el eje de unidad`);
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

console.log('');
const R = r.repro;
ok(R.parado === 'en pausa',
   `el estado dice la verdad con la simulación parada: «${R.parado}» (decía «reproduciendo»)`);
ok(/faltan/.test(R.falta) && /parada/.test(R.falta),
   'y dice cuánto falta para el próximo evento, y que hay que darle a ▶');
ok(R.velDesdeElSelector === '900',
   `el selector de velocidad de la barra mueve el de verdad (${R.velDesdeElSelector})`);
ok(R.velSuelta === '137' && R.opciones === 7,
   `una velocidad fuera de la lista sale como opción, no se disimula (×${R.velSuelta})`);
ok(R.corriendo === 'reproduciendo' && R.enPausa === 'en pausa' && R.botonPausa === '▶',
   `reproduciendo → ${R.enPausa} con el botón de la barra de tiempo`);
ok(R.salto.antesDe > 0 && R.salto.antesDe <= 2,
   `⏩ deja el reloj justo antes del evento, para verlo llegar: ${R.salto.de} → ${R.salto.hasta} h (${R.salto.antesDe} min antes de las ${R.salto.evento}:00)`);
ok(R.salto.iTras > 0 && R.salto.pedido === 45 && R.salto.viento > 5 && R.salto.viento < 45,
   `y el evento entra al seguir: pide 45 km/h y el viento va por ${R.salto.viento} — ` +
   `con rampa, que es como sube el viento de verdad`);
ok(r.vista.barraEnCampo && r.vista.guionEnCampo && r.vista.registrosEnCampo,
   'guion, campo y registros en la MISMA vista: se sigue un escenario viendo moverse la planta');
ok(!r.vista.pestanas.some((t) => /^escenarios$/i.test(t)),
   `y no hay pestaña de escenarios aparte: ${r.vista.pestanas.join(' · ')}`);
ok(r.vista.regs >= 6,
   `los registros del equipo salen bajo el campo (${r.vista.regs} · ${r.vista.fuente})`);

console.log('');
const PL = r.plantas;
ok(PL.burgo && PL.burgo.tcu === 215 && PL.burgo.hsu === 4 && PL.burgo.rep === 4,
   `elegir El Burgo configura sus equipos: ${PL.burgo.tcu} TCU · ${PL.burgo.hsu} HSU · ${PL.burgo.rep} repetidores`);
ok(PL.burgo.plano && PL.burgo.campoN === 215,
   `y el campo usa su plano, no una rejilla (${PL.burgo.campoN} seguidores colocados)`);
ok(PL.columnas > 3 && PL.casaConLayout,
   `y son LAS del layout, con su silueta: ${PL.columnas} tamaños de columna distintos (una rejilla tiene 1)`);
ok(PL.tunez && PL.tunez.tz === 1 && PL.gorraiz && PL.gorraiz.enRejilla,
   `el huso lo fija el layout (Túnez UTC+${PL.tunez.tz}) y los sitios de laboratorio van con rejilla`);

console.log('');
const TT = r.tiempo;
ok(TT.mañana.lbl === '07:00' && TT.mediodia.lbl === '13:00' && TT.tarde.lbl === '19:00',
   `el deslizador mueve el reloj: ${TT.mañana.lbl} · ${TT.mediodia.lbl} · ${TT.tarde.lbl}`);
ok(TT.mañana.obj < 0 && TT.tarde.obj > 0 &&
   new Set([TT.mañana.obj, TT.mediodia.obj, TT.tarde.obj]).size === 3,
   `y la planta SE COLOCA a esa hora — al este por la mañana, al oeste por la tarde: ` +
   `${TT.mañana.obj}° · ${TT.mediodia.obj}° · ${TT.tarde.obj}°`);
ok(Math.abs(TT.tarde.real - TT.tarde.obj) < 1,
   `al soltar, la mesa ha llegado a su objetivo (${TT.tarde.real}° vs ${TT.tarde.obj}°)`);
ok(r.arrastre.every((a) => a.desv < 1.5) &&
   new Set(r.arrastre.map((a) => a.obj)).size === r.arrastre.length,
   'y MIENTRAS SE ARRASTRA las mesas ya están en su sitio, sin esperar a soltar: ' +
   r.arrastre.map((a) => `${a.h}h→${a.obj}°`).join(' · '));
ok(r.setaQuieta.motor === false && r.setaQuieta.movio < 0.5,
   `el equipo con la seta pulsada NO se coloca: se movió ${r.setaQuieta.movio}° saltando seis horas`);
ok(r.incMiente > 2,
   `y el inclinómetro descalibrado sigue mintiendo ${r.incMiente}°, no se le copia el ángulo`);
ok(TT.panel === 19, `y mueve el mismo reloj del panel, no un segundo (${TT.panel})`);
ok(TT.dia.n === 355 && /dic/.test(TT.dia.lbl), `el deslizador de día también (${TT.dia.lbl})`);
ok(TT.tarjetas >= 8, `el HUD va en tarjetas bajo el campo, como overcast (${TT.tarjetas})`);

ok(/SoC \d+ % · SoH \d+ %/.test(r.regs['30096'].val),
   `30096 se lee por bytes, no como un entero de 16 bits: «${r.regs['30096'].val}»`);
ok(r.regs['30001'].bits.length > 5 && r.regs['30006'].bits.length > 5 && !r.regs['30001'].val,
   `los registros de estado enseñan sus bits y se callan el número desnudo (${r.regs['30001'].bits}…)`);
ok(r.regs['30113'].val.length > 3 && !/^[\d.,\s−-]+$/.test(r.regs['30113'].val),
   `y el que tiene lectura propia la conserva, no un número: 30113 = «${r.regs['30113'].val}»`);

ok(r.reloj.malos.length === 0,
   `el reloj nunca da las 09:60 (4.000 horas del día · ${JSON.stringify(r.reloj.ejemplos)})`);

const SE = r.seta;
ok(SE.bitTcu === 1 && SE.bitNcu === 0,
   'la seta es del TCU (30002.4) y la NCU no la ve: 30100.13 sigue a 0, sin nada cableado');
ok(SE.suyo && SE.otrosEnclavados === 0,
   `y enclava SU equipo y solo ese: ${SE.otrosEnclavados} equipos más afectados`);
ok(!SE.hayBoton && !SE.tiposAv.includes('setancu'),
   `no queda ningún mando de parada de la NCU: era hardware que no existe (${SE.tiposAv.join(', ')})`);

const V = r.veleta;
ok(V.delN === 'S' && V.delE === 'O' && V.delS === 'N' && V.delO === 'E',
   `la veleta apunta ADONDE SOPLA: del N→${V.delN} · del E→${V.delE} · del S→${V.delS} · del O→${V.delO}`);
ok(['viento', 'rachas', 'altura', 'azimut', 'objetivo solar', 'objetivo', 'real', 'mide el tcu', 'flota']
     .every((k) => r.hud.txt.toLowerCase().includes(k)),
   'el HUD trae viento y rumbo, sol, y las CUATRO posiciones: solar / objetivo / real / medido' +
   (r.hud.dia ? '' : ' [OJO: leído de noche]'));
const BA = r.bandera;
ok(/⚠/.test(BA.soplando) && /km\/h/.test(BA.soplando),
   `con el viento por encima del umbral la bandera avisa, no cuenta: «${BA.soplando}»`);
ok(/suelta en \d+:\d\d/.test(BA.amainado),
   `y en cuanto amaina arranca la cuenta atrás: «${BA.amainado}»`);

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
