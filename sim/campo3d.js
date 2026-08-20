/* ============================================================================
   campo3d.js — LA PLANTA EN 3D, movida por la simulación.

   No es un render aparte con su propia idea de dónde está cada mesa: cada frame
   lee `anguloReal` de cada TCU —la mesa de verdad, no lo que el equipo cree que
   mide— y gira su instancia. Si el inclinómetro miente, aquí se ve la mesa
   torcida mientras el mapa Modbus publica que está clavada en su objetivo, que es
   justo el defecto que persigue el ensayo D.1.1.

   La geometría NO se dibuja aquí: sale de `seguidor.js`, que es la fuente única
   del modelo del seguidor y la comparten el gemelo 3D y Cobertura 3D. Se usa su
   `instancePlan`, así que una planta de 200 seguidores son unas pocas decenas de
   draw calls y no 200 × piezas.

   El color NO se le toca al modelo: cada seguidor lleva encima un testigo con el
   mismo criterio de salud que el SCADA (verde · ámbar · rojo · gris sin comms).
   Pintar el propio seguidor obligaría a duplicar sus materiales, y entonces el
   modelo compartido dejaría de ser compartido.
   ============================================================================ */
(function (global) {
'use strict';

var D2R = Math.PI / 180;

function Campo3D(cont, cfg) {
  cfg = cfg || {};
  this.cont = cont;
  this.alSeleccionar = cfg.alSeleccionar || function () {};
  this.THREE = global.THREE;
  if (!this.THREE) throw new Error('falta lib/three.min.js');
  if (!global.Seguidor) throw new Error('falta seguidor.js (el modelo compartido)');

  var T = this.THREE;
  this.scene = new T.Scene();
  this.camera = new T.PerspectiveCamera(46, 1, 0.5, 4000);
  this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  this.renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
  this.renderer.shadowMap.enabled = true;
  this.renderer.shadowMap.type = T.PCFSoftShadowMap;
  cont.appendChild(this.renderer.domElement);
  this.renderer.domElement.style.display = 'block';
  this.renderer.domElement.style.width = '100%';
  this.renderer.domElement.style.height = '100%';

  /* luz: el sol lo mueve la simulación, la hemisférica solo levanta las sombras */
  this.sol = new T.DirectionalLight(0xfff0dd, 2.1);
  this.sol.castShadow = true;
  this.sol.shadow.mapSize.set(2048, 2048);
  var sc = this.sol.shadow.camera;
  sc.near = 1; sc.far = 700; sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140;
  this.scene.add(this.sol);
  this.scene.add(this.sol.target);
  this.hemi = new T.HemisphereLight(0x9fc3e8, 0x2b2a24, 0.55);
  this.scene.add(this.hemi);

  /* suelo */
  var suelo = new T.Mesh(new T.PlaneGeometry(1200, 1200),
                         new T.MeshLambertMaterial({ color: 0x3d4030 }));
  suelo.rotation.x = -Math.PI / 2;
  suelo.receiveShadow = true;
  this.scene.add(suelo);
  this.grupoPlanta = new T.Group();
  this.scene.add(this.grupoPlanta);

  this.blancoOrbita = new T.Vector3(0, 2, 0);
  this.orbita = orbita(this.renderer.domElement, this.camera, this.blancoOrbita, 120, 12, 900, T);
  this.picar();
  this.redimensiona();
  var yo = this;
  this._onRes = function () { yo.redimensiona(); };
  global.addEventListener('resize', this._onRes);
}

/* ── la flota ───────────────────────────────────────────────────────────────
   Se rehace solo cuando cambia el número de equipos, no cada paso. */
Campo3D.prototype.construye = function (P) {
  var T = this.THREE, S = global.Seguidor;
  while (this.grupoPlanta.children.length) this.grupoPlanta.remove(this.grupoPlanta.children[0]);

  var tcus = P.tcus;
  this.n = tcus.length;
  this.orden = tcus;

  var D = S.DIMS;
  /* El tubo de par del modelo va a lo largo de X y bascula sobre X, así que el PASO
     ENTRE FILAS (6 m canónicos) va en Z. Varios seguidores de la misma línea se
     alinean en X, separados por su vano. */
  var pitch = 6.0;                       /* CANONICAL_PITCH_M */
  var largo = D.span || 34;              /* la fila entera, con su vano de motor */
  var porLinea = Math.max(1, Math.round(Math.sqrt(this.n * pitch / largo * 2.2)));
  var lineas = Math.ceil(this.n / porLinea);
  this.bases = [];
  for (var i = 0; i < this.n; i++) {
    var c = i % porLinea, f = Math.floor(i / porLinea);
    var x = (c - (porLinea - 1) / 2) * (largo + 6);
    var z = (f - (lineas - 1) / 2) * pitch;
    this.bases.push(new T.Matrix4().makeTranslation(x, 0, z));
  }

  /* el modelo compartido, en instancias */
  var SG = S.materials(T);
  this.plan = S.instancePlan(T, { materials: SG, detail: 'mass', west: true });
  this.piezas = [];
  var yo = this;
  /* OJO con el contrato del modelo: `mat` es una CLAVE del mapa de materiales y
     `geom` una FÁBRICA `(THREE) -> BufferGeometry`, no objetos ya construidos.
     Pasárselos tal cual a InstancedMesh revienta dentro del render, no al crearlo. */
  this.plan.forEach(function (p) {
    var geom = (typeof p.geom === 'function') ? p.geom(T) : p.geom;
    var mat = (typeof p.mat === 'string') ? (SG[p.mat] || SG.steel) : p.mat;
    if (!geom || !geom.isBufferGeometry) return;
    var im = new T.InstancedMesh(geom, mat, yo.n * p.locals.length);
    im.castShadow = !!p.cast; im.receiveShadow = true;
    im.frustumCulled = false;
    yo.grupoPlanta.add(im);
    yo.piezas.push({ im: im, locals: p.locals, spin: !!p.spin });
  });

  /* testigos de salud, uno por seguidor, sobre el extremo norte de la fila */
  var geo = new T.SphereGeometry(0.55, 12, 10);
  var mat = new T.MeshBasicMaterial({ color: 0xffffff });
  this.testigos = new T.InstancedMesh(geo, mat, this.n);
  this.testigos.frustumCulled = false;
  this.grupoPlanta.add(this.testigos);
  this._colTmp = new T.Color();

  /* aro del seleccionado */
  this.aro = new T.Mesh(new T.TorusGeometry(3.4, 0.14, 8, 40),
                        new T.MeshBasicMaterial({ color: 0x36D399 }));
  this.aro.rotation.x = -Math.PI / 2;
  this.aro.visible = false;
  this.grupoPlanta.add(this.aro);

  this._m = new T.Matrix4(); this._rx = new T.Matrix4(); this._acc = new T.Matrix4();
  this.encuadra();
};

/* ── un paso: ángulos, sol y salud ─────────────────────────────────────────── */
Campo3D.prototype.paso = function (P) {
  if (!this.piezas || !P || P.tcus.length !== this.n) { if (P) this.construye(P); }
  var T = this.THREE, tcus = P.tcus;

  for (var pi = 0; pi < this.piezas.length; pi++) {
    var pz = this.piezas[pi], k = 0;
    for (var i = 0; i < this.n; i++) {
      /* la MESA, no lo que el TCU mide: si el sensor miente, aquí se ve torcida.
         El signo es el MISMO que usa el gemelo 3D sobre este modelo
         (`rotation.x = angulo·D2R`): negarlo dejaría el campo en espejo, que es un
         error que no canta hasta que alguien compara las dos páginas a la vez. */
      var ang = tcus[i].anguloReal * D2R;
      if (pz.spin) this._rx.makeRotationX(ang);
      for (var l = 0; l < pz.locals.length; l++) {
        this._acc.copy(this.bases[i]);
        if (pz.spin) this._acc.multiply(this._rx);
        this._acc.multiply(pz.locals[l]);
        pz.im.setMatrixAt(k++, this._acc);
      }
    }
    pz.im.instanceMatrix.needsUpdate = true;
  }

  /* testigos: el mismo criterio de salud que el SCADA */
  var COL = { ok: 0x37b87c, aviso: 0xe0a52b, alarma: 0xe2574c, offline: 0x5e7388 };
  for (var j = 0; j < this.n; j++) {
    var t = tcus[j];
    this._m.copy(this.bases[j]);
    this._m.multiply(new T.Matrix4().makeTranslation(0, 3.6, 0));
    this.testigos.setMatrixAt(j, this._m);
    this._colTmp.setHex(COL[t.salud ? t.salud() : 'ok'] || COL.ok);
    this.testigos.setColorAt(j, this._colTmp);
  }
  this.testigos.instanceMatrix.needsUpdate = true;
  if (this.testigos.instanceColor) this.testigos.instanceColor.needsUpdate = true;

  /* el sol de la simulación, no uno de adorno */
  var s = tcus[0] && tcus[0].solar;
  if (s) {
    /* El seguidor bascula sobre X = eje N-S, así que la componente ESTE-OESTE del sol
       (sin az) va en Z y la NORTE-SUR (cos az) en X. Es el mismo mapeo que el gemelo
       3D sobre este modelo; cambiarlas de sitio pone el sol a lo largo del tubo y el
       seguimiento deja de tener sentido, sin que nada falle. */
    var el = Math.max((90 - s.zen) * D2R, 0.04), az = s.az * D2R, ce = Math.cos(el), d = 220;
    this.sol.position.set(Math.cos(az) * ce * d, Math.sin(el) * d, Math.sin(az) * ce * d);
    this.sol.intensity = s.dia ? 2.1 : 0.05;
    this.hemi.intensity = s.dia ? 0.55 : 0.16;
    var cielo = s.dia ? 0x87a8c4 : 0x0b1119;
    if (this.scene.background === null || this._bg !== cielo) {
      this.scene.background = new T.Color(cielo); this._bg = cielo;
    }
  }
  this.renderer.render(this.scene, this.camera);
};

Campo3D.prototype.selecciona = function (idx) {
  if (!this.aro || idx == null || !this.bases[idx]) { if (this.aro) this.aro.visible = false; return; }
  var p = new this.THREE.Vector3().setFromMatrixPosition(this.bases[idx]);
  this.aro.position.set(p.x, 0.15, p.z);
  this.aro.visible = true;
};

/* clic sobre el suelo: se elige el seguidor cuya base cae más cerca. Es más
   robusto que picar la malla instanciada, que con 'mass' tiene piezas diminutas. */
Campo3D.prototype.picar = function () {
  var yo = this, T = this.THREE, ray = new T.Raycaster(), v = new T.Vector2();
  var plano = new T.Plane(new T.Vector3(0, 1, 0), 0), pt = new T.Vector3();
  var down = null;
  this.renderer.domElement.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; });
  this.renderer.domElement.addEventListener('pointerup', function (e) {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;   /* era un giro */
    if (!yo.bases) return;
    var r = yo.renderer.domElement.getBoundingClientRect();
    v.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    v.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(v, yo.camera);
    if (!ray.ray.intersectPlane(plano, pt)) return;
    var mejor = -1, dmin = 1e9;
    for (var i = 0; i < yo.bases.length; i++) {
      var p = new T.Vector3().setFromMatrixPosition(yo.bases[i]);
      var d = Math.hypot(p.x - pt.x, p.z - pt.z);
      if (d < dmin) { dmin = d; mejor = i; }
    }
    if (mejor >= 0 && dmin < 30) { yo.selecciona(mejor); yo.alSeleccionar(mejor); }
  });
};

Campo3D.prototype.encuadra = function () {
  if (!this.bases || !this.bases.length) return;
  var T = this.THREE, min = new T.Vector3(1e9, 0, 1e9), max = new T.Vector3(-1e9, 0, -1e9);
  for (var i = 0; i < this.bases.length; i++) {
    var p = new T.Vector3().setFromMatrixPosition(this.bases[i]);
    min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x);
    min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z);
  }
  this.blancoOrbita.set((min.x + max.x) / 2, 3, (min.z + max.z) / 2);
  var r = Math.max(45, Math.hypot(max.x - min.x, max.z - min.z) * 0.62);
  this.orbita.pon(r);
};

Campo3D.prototype.redimensiona = function () {
  var w = this.cont.clientWidth || 800, h = this.cont.clientHeight || 480;
  this.renderer.setSize(w, h, false);
  this.camera.aspect = w / Math.max(1, h);
  this.camera.updateProjectionMatrix();
};

/* órbita mínima, el mismo criterio que el gemelo 3D: arrastrar gira, botón
   derecho o shift desplaza, rueda acerca. */
function orbita(dom, cam, blanco, r0, rmin, rmax, T) {
  var st = { theta: 0.62, phi: 1.14, radius: r0 }, ptr = {}, modo = null;
  function clampR(v) { return Math.max(rmin, Math.min(rmax, v)); }
  function aplica() {
    var sp = Math.sin(st.phi), cp = Math.cos(st.phi);
    cam.position.set(blanco.x + st.radius * sp * Math.sin(st.theta),
                     blanco.y + st.radius * cp,
                     blanco.z + st.radius * sp * Math.cos(st.theta));
    cam.lookAt(blanco);
  }
  function ids() { return Object.keys(ptr); }
  dom.style.touchAction = 'none';
  dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  dom.addEventListener('pointerdown', function (e) {
    ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { dom.setPointerCapture(e.pointerId); } catch (_) {}
    modo = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'giro';
  });
  dom.addEventListener('pointermove', function (e) {
    var prev = ptr[e.pointerId]; if (!prev) return;
    ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (modo === 'pan') {
      var h = dom.clientHeight || 500, sc = 2 * st.radius * Math.tan(cam.fov * Math.PI / 360) / h;
      var rt = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      var up = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      blanco.addScaledVector(rt, -(e.clientX - prev.x) * sc);
      blanco.addScaledVector(up, (e.clientY - prev.y) * sc);
      aplica();
    } else {
      st.theta -= (e.clientX - prev.x) * 0.006;
      st.phi = Math.max(0.12, Math.min(1.45, st.phi - (e.clientY - prev.y) * 0.006));
      aplica();
    }
  });
  function up(e) { delete ptr[e.pointerId]; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} if (!ids().length) modo = null; }
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', function (e) {
    e.preventDefault(); st.radius = clampR(st.radius * (1 + Math.sign(e.deltaY) * 0.1)); aplica();
  }, { passive: false });
  aplica();
  return { aplica: aplica, pon: function (r) { st.radius = clampR(r); aplica(); } };
}

if (typeof window !== 'undefined') window.Campo3D = Campo3D;
if (typeof module !== 'undefined') module.exports = Campo3D;
})(this);
