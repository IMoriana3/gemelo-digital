/* ============================================================================
 * escena.js — render del seguidor calidad GEMELO + PBR moderno, reutilizable
 * ----------------------------------------------------------------------------
 * Render del Gemelo (seguidor detail:'full', césped, sombras, sol/cielo reales)
 * elevado a calidad moderna:
 *   · IBL con RoomEnvironment (reflejos realistas en vidrio y acero)
 *   · Tone mapping ACES filmic + sRGB
 *   · Cielo físico (THREE.Sky) con el sol real (día en bucle)
 *   · Post-proceso: UnrealBloom (destellos) + SMAA (antialiasing)
 * Degrada con elegancia si algún módulo de examples/js no carga.
 *
 *   var ESC = Escena.create(THREE, mountEl, {layout, detail, autoDay, daySeconds,
 *     hour, autoOrbit});
 *   ESC.frame(now,dt)  ESC.trackers  ESC.materials  ESC.scene/camera/renderer
 * ==========================================================================*/
(function (root) {
  'use strict';
  var E = {};
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ---- física solar (espejo del gemelo) ---- */
  var GCR = 2.382 / 6.0, AXIS_MAX = 55;
  var LOC = { lat: 42.81, lon: -1.58, tz: 1, dst: true }, LAT = LOC.lat * D2R, LON = LOC.lon, dayN = 172, btOn = true;
  function declOf(N) { return 23.45 * Math.sin(2 * Math.PI * (284 + (N || 1)) / 365) * D2R; }
  function tzOffset(N) { return LOC.tz + ((LOC.dst && N >= 86 && N <= 303) ? 1 : 0); }
  function solarShift(N) { var LSTM = 15 * tzOffset(N), B = 2 * Math.PI / 365 * ((N || 1) - 81); var EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); return (4 * (LON - LSTM) + EoT) / 60; }
  function solarPos(h) {
    var DECL = declOf(dayN), hs = h + solarShift(dayN), w = (hs - 12) * 15 * D2R;
    var sinEl = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(w);
    var elv = Math.asin(clamp(sinEl, -1, 1));
    var caz = (sinEl * Math.sin(LAT) - Math.sin(DECL)) / Math.max(1e-6, (Math.cos(elv) * Math.cos(LAT)));
    var az = Math.acos(clamp(caz, -1, 1)); if (w < 0) az = -az;
    return { el: elv, az: az };
  }
  function trackAngle(h) {
    var P = solarPos(h); if (P.el <= 0.0001) return -5;
    var sx = Math.cos(P.el) * Math.sin(P.az), sz = Math.sin(P.el);
    var Rtrue = Math.atan2(sx, sz), temp = Math.min(1, (1 / GCR) * Math.cos(Rtrue));
    var Rbt = Rtrue - Math.sign(Rtrue) * Math.acos(temp), Rsel = btOn ? Rbt : Rtrue;
    return clamp(Rsel * R2D, -AXIS_MAX, AXIS_MAX);
  }

  /* ---- texturas ---- */
  var THREE;
  function grassTex() {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    x.fillStyle = '#3c6b2c'; x.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 5200; i++) { var gx = Math.random() * 256, gy = Math.random() * 256, l = 2 + Math.random() * 7, dx = (Math.random() - 0.5) * 3; x.strokeStyle = 'hsl(' + (92 + Math.random() * 34) + ',' + (40 + Math.random() * 25) + '%,' + (20 + Math.random() * 34) + '%)'; x.lineWidth = 0.8 + Math.random() * 1.1; x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + dx, gy - l); x.stroke(); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function grassBladeTex() {
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d'); x.clearRect(0, 0, 64, 64); x.lineCap = 'round';
    for (var i = 0; i < 9; i++) { var bx = 6 + Math.random() * 52, hh = 26 + Math.random() * 36, w = 1.6 + Math.random() * 2.2; x.strokeStyle = 'hsl(' + (92 + Math.random() * 30) + ',' + (55 + Math.random() * 20) + '%,' + (26 + Math.random() * 22) + '%)'; x.lineWidth = w; x.beginPath(); x.moveTo(bx, 64); x.quadraticCurveTo(bx + (Math.random() - 0.5) * 16, 64 - hh * 0.6, bx + (Math.random() - 0.5) * 24, 64 - hh); x.stroke(); }
    return new THREE.CanvasTexture(c);
  }
  function panelTex() {
    var W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    x.fillStyle = '#070b12'; x.fillRect(0, 0, W, H); var nx = 6, ny = 12, cw = W / nx, ch = H / ny, gap = 1.6;
    for (var iy = 0; iy < ny; iy++) for (var ix = 0; ix < nx; ix++) {
      var L = 8 + Math.random() * 4, g = x.createLinearGradient(ix * cw, iy * ch, ix * cw + cw, iy * ch + ch);
      g.addColorStop(0, 'hsl(216,55%,' + (L + 3).toFixed(1) + '%)'); g.addColorStop(1, 'hsl(216,55%,' + L.toFixed(1) + '%)');
      x.fillStyle = g; x.fillRect(ix * cw + gap, iy * ch + gap, cw - 2 * gap, ch - 2 * gap);
      x.strokeStyle = 'rgba(170,195,225,.35)'; x.lineWidth = 0.8;
      for (var b = 1; b <= 3; b++) { var bx = ix * cw + cw * b / 4; x.beginPath(); x.moveTo(bx, iy * ch + gap); x.lineTo(bx, iy * ch + ch - gap); x.stroke(); }
    }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }

  /* ---- órbita ---- */
  function orbit(dom, camera, target, r0, rmin, rmax) {
    var st = { theta: 0.92, phi: 0.95, radius: r0 }, ptr = {}, mode = null, lastMid = null, lastDist = 0;
    function clampR(v) { return Math.max(rmin, Math.min(rmax, v)); }
    function apply() { var sp = Math.sin(st.phi), cp = Math.cos(st.phi); camera.position.set(target.x + st.radius * sp * Math.sin(st.theta), target.y + st.radius * cp, target.z + st.radius * sp * Math.cos(st.theta)); camera.lookAt(target); }
    function ids() { return Object.keys(ptr); }
    function mid() { var k = ids(), a = ptr[k[0]], b = ptr[k[1]]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    function dist() { var k = ids(), a = ptr[k[0]], b = ptr[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    dom.style.touchAction = 'none';
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    dom.addEventListener('pointerdown', function (e) { ptr[e.pointerId] = { x: e.clientX, y: e.clientY }; try { dom.setPointerCapture(e.pointerId); } catch (_) {} var n = ids().length; if (n === 1) mode = 'rotate'; else if (n === 2) { mode = 'multi'; lastMid = mid(); lastDist = dist(); } });
    dom.addEventListener('pointermove', function (e) { var prev = ptr[e.pointerId]; if (!prev) return; ptr[e.pointerId] = { x: e.clientX, y: e.clientY }; if (mode === 'multi' && ids().length >= 2) { var m = mid(), d = dist(); if (lastDist > 0 && d > 0) st.radius = clampR(st.radius * lastDist / d); lastMid = m; lastDist = d; apply(); } else if (mode === 'rotate') { st.theta -= (e.clientX - prev.x) * 0.006; st.phi = Math.max(0.12, Math.min(1.45, st.phi - (e.clientY - prev.y) * 0.006)); apply(); E._dragged = (E._dragged || 0) + Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y); } });
    function up(e) { delete ptr[e.pointerId]; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} if (ids().length < 2) { lastMid = null; lastDist = 0; mode = ids().length === 1 ? 'rotate' : null; } }
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', function (e) { e.preventDefault(); st.radius = clampR(st.radius * (1 + Math.sign(e.deltaY) * 0.1)); apply(); }, { passive: false });
    apply();
    return { st: st, apply: apply, zoom: function (f) { st.radius = clampR(st.radius * f); apply(); } };
  }

  /* ---- TCU: CAD real (tcu.glb) con fallback modelado ---- */
  var TCU_GLB = 'https://cdn.jsdelivr.net/gh/IMoriana3/gemelo-digital@main/tcu.glb';
  // Monta el CAD real EXACTAMENTE como el Gemelo: misma orientación (_TCUMOUNT),
  // escala NATIVA (como Cobertura 3D) y recoloreado de metales + seta roja.
  var _tcuGltf = null, _tcuCbs = [], _tcuTried = false;
  function _getTCU(cb) {   // carga el glb UNA vez y reparte el clon a todos (N seguidores, 1 descarga)
    if (_tcuGltf) { cb(_tcuGltf); return; }
    _tcuCbs.push(cb);
    if (_tcuTried || typeof THREE.GLTFLoader !== 'function') return;
    _tcuTried = true;
    try { new THREE.GLTFLoader().load(TCU_GLB, function (g) { _tcuGltf = g.scene; var q = _tcuCbs; _tcuCbs = []; q.forEach(function (f) { try { f(_tcuGltf); } catch (e) {} }); }, undefined, function () { }); } catch (e) {}
  }
  function loadRealTCU(parent, fallback, antennas) {
    _getTCU(function (scene) {
      var box = new THREE.Box3().setFromObject(scene), sz = box.getSize(new THREE.Vector3());
      if (!isFinite(Math.max(sz.x, sz.y, sz.z)) || Math.max(sz.x, sz.y, sz.z) <= 0) return;
      var ctr = box.getCenter(new THREE.Vector3());
      // conector DORADO del glb (mat_14) = salida de antena
      var connNat = null; scene.traverse(function (o) { if (!o.isMesh || !o.material || !o.material.color || connNat) return; var c = o.material.color; if (c.r > 0.6 && c.g > 0.30 && c.b < 0.6 && (c.r - c.b) > 0.35 && c.g < c.r) { connNat = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); } });
      var cl = scene.clone(true); cl.position.sub(ctr);                        // escala nativa, centrado en su bbox
      cl.traverse(function (o) {
        if (!o.isMesh) return; o.castShadow = false; o.receiveShadow = true;
        var src = (o.material && o.material.isMaterial) ? o.material : null, mm = src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0xe8e4dc });
        if (mm.metalness != null) mm.metalness = Math.min(mm.metalness, 0.18); else mm.metalness = 0.15;   // los metales del glb salían negros sin reflejo
        if (mm.roughness == null || mm.roughness < 0.45) mm.roughness = 0.6;
        if (src && src.name === 'mat_1') { mm.color = new THREE.Color(0xcc1417); mm.metalness = 0.1; mm.roughness = 0.5; }   // la SETA: roja
        mm.envMapIntensity = 1.0; mm.needsUpdate = true; o.material = mm;
      });
      var TM = new THREE.Matrix4().makeRotationY(Math.PI / 2); TM.multiply(new THREE.Matrix4().makeRotationX(Math.PI)); TM.setPosition(Seguidor.DIMS.tcuX, -0.16, 0);
      var wrap = new THREE.Group(); wrap.add(cl); wrap.applyMatrix4(TM); parent.add(wrap);
      // ANTENA: coax que sale del conector dorado y CUELGA vertical (como el gemelo)
      if (connNat && antennas) {
        var cG = connNat.clone().sub(ctr).applyMatrix4(TM);
        var aM = new THREE.MeshStandardMaterial({ color: 0x101316, metalness: 0.35, roughness: 0.45 });
        var antGrp = new THREE.Group(); antGrp.position.copy(cG); parent.add(antGrp);
        var cabLen = 0.85, ferLen = 0.022, duckLen = 0.075;
        var cab = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, cabLen, 8), aM); cab.position.set(0, -cabLen / 2, 0); antGrp.add(cab);
        var fer = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, ferLen, 12), aM); fer.position.set(0, -cabLen - ferLen / 2, 0); antGrp.add(fer);
        var duck = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.005, duckLen, 12), aM); duck.castShadow = true; duck.position.set(0, -cabLen - ferLen - duckLen / 2, 0); antGrp.add(duck);
        var dtip = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), aM); dtip.position.set(0, -cabLen - ferLen - duckLen, 0); antGrp.add(dtip);
        antennas.push(antGrp);
      }
      if (fallback) fallback.visible = false;
    });
  }
  function buildTCU() {
    var g = new THREE.Group();
    var body = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.45, metalness: 0.5, envMapIntensity: 1.0 });
    var lid = new THREE.MeshStandardMaterial({ color: 0x404d5e, roughness: 0.3, metalness: 0.6, envMapIntensity: 1.15 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x12161b, roughness: 0.6, metalness: 0.35 });
    var red = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.4 });
    var b = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.22, 0.34), body); b.castShadow = true; b.receiveShadow = true; g.add(b);
    var l = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.05, 0.31), lid); l.position.y = 0.125; l.castShadow = true; g.add(l);
    var btn = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.035, 18), red); btn.position.set(-0.2, 0.155, 0); g.add(btn);
    var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.20, 8), dark); ant.position.set(0.22, 0.21, -0.1); g.add(ant);
    [-0.16, -0.08, 0, 0.08, 0.16].forEach(function (zx) { var cn = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.06, 12), dark); cn.position.set(zx, -0.13, 0.06); g.add(cn); });
    [-0.27, 0.27].forEach(function (ex) { var fl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.10), dark); fl.position.set(ex, 0, 0); fl.castShadow = true; g.add(fl); });
    return g;
  }

  /* ---- un seguidor completo (porta buildTracker del gemelo) ---- */
  function buildOne(scene, SG, xs, zc, west, detail) {
    var dampers = [], motorCables = [], antennas = [], steel = SG.steel, silver = SG.silver, dark2 = SG.jbox;
    var piersX = []; for (var px = -30; px <= 30; px += 6) piersX.push(px);
    for (var pi = 0; pi < piersX.length; pi++) {
      var pxv = piersX[pi] + xs;
      var col = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.0, 0.13), steel); col.position.set(pxv, 1.0, zc); col.castShadow = true; scene.add(col);
      var ped = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.30), silver); ped.position.set(pxv, 1.94, zc); ped.castShadow = true; scene.add(ped);
      var brg = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.18, 18), silver); brg.rotation.z = Math.PI / 2; brg.position.set(pxv, 2.0, zc); brg.castShadow = true; scene.add(brg);
    }
    var beam = Seguidor.buildBeam(THREE, { west: west, materials: SG, detail: detail || 'full', skip: { soporte: 1, bracket: 1, antena: 1, antenatip: 1, tcu: 1 } });
    var g = new THREE.Group(); g.position.set(xs, 2, zc); g.add(beam.spin); scene.add(g);
    if (west) { var tcu = buildTCU(); tcu.position.set(Seguidor.DIMS.tcuX, -0.22, 0); g.add(tcu); loadRealTCU(g, tcu, antennas); }
    var slew = new THREE.Group(); slew.position.set(xs, 2, zc); slew.add(beam.static); scene.add(slew);
    beam.dampers.forEach(function (d) {
      var pbx = d.b[0], Bp = new THREE.Vector3(xs + d.a[0], 0.40, zc + d.a[2]);
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 14), dark2); body.castShadow = true; scene.add(body);
      var rodd = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 10), silver); scene.add(rodd);
      var eT = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), steel); eT.position.set(pbx, d.b[1], d.b[2]); g.add(eT);
      dampers.push({ px: pbx + xs, zc: zc, dy0: d.b[1], dz0: d.b[2], B: Bp, body: body, rod: rodd });
    });
    if (west) {
      var _cabM = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.62, metalness: 0.15 });
      var _cnM = new THREE.MeshStandardMaterial({ color: 0x2f6fb3, roughness: 0.5, metalness: 0.45 });
      var _cb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.06), _cnM); _cb.position.set(0, 0.04, -0.60); _cb.castShadow = true; slew.add(_cb);
      slew.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.085, -0.60), new THREE.Vector3(0, 0.15, -0.50), new THREE.Vector3(0, 0.16, -0.42)]), 16, 0.008, 7, false), _cabM));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.18, 0.085, 0), new THREE.Vector3(0.42, 0.092, 0.02), new THREE.Vector3(0.72, 0.092, 0.02), new THREE.Vector3(0.98, 0.05, 0.035), new THREE.Vector3(1.18, -0.04, 0.045), new THREE.Vector3(1.235, -0.11, 0.045)]), 44, 0.008, 8, false), _cabM));
      [0.32, 0.6, 0.88].forEach(function (_bx) { var _br = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.006, 8, 16), new THREE.MeshStandardMaterial({ color: 0x1c2025, roughness: 0.8 })); _br.rotation.y = Math.PI / 2; _br.position.set(_bx, 0, 0); g.add(_br); });
      var _flex = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 8), _cabM); scene.add(_flex);
      motorCables.push({ Ax: xs, Ay: 2.16, Az: zc - 0.42, Bx: 0.18, By: 0.085, Bz: 0, xs: xs, zc: zc, mesh: _flex });
    }
    return { spin: g, slew: slew, xs: xs, zc: zc, dampers: dampers, motorCables: motorCables, antennas: antennas };
  }

  // Un SEGUIDOR real = bífila: dos vigas (motor + gemela) a zc±filaZ unidas por
  // el EJE DE TRANSMISIÓN central (estático: va sobre los ejes de giro). Un solo
  // motor/TCU (en la viga oeste) mueve ambas.
  function buildBifila(scene, SG, xs, zc, detail) {
    var filaZ = 3.0;
    var A = buildOne(scene, SG, xs, zc - filaZ, true, detail);    // viga del MOTOR + TCU
    var B = buildOne(scene, SG, xs, zc + filaZ, false, detail);   // viga GEMELA
    var et = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2 * filaZ, 14), SG.steel);
    et.rotation.x = Math.PI / 2; et.position.set(xs, 2, zc); et.castShadow = true; scene.add(et);
    return { spin: A.spin, slew: A.slew, spinGroups: [A.spin, B.spin], xs: xs, zc: zc, dampers: A.dampers.concat(B.dampers), motorCables: A.motorCables.concat(B.motorCables), antennas: A.antennas, ang: 0 };
  }

  // Actualiza basculación + amortiguadores + cable de motor de cada seguidor (cada T usa su T.ang en grados)
  function updateTrackers(trackers) {
    var up = new THREE.Vector3(0, 1, 0);
    for (var t = 0; t < trackers.length; t++) {
      var T = trackers[t], ar = (T.ang || 0) * D2R, _c = Math.cos(ar), _sn = Math.sin(ar);
      var gs = T.spinGroups || [T.spin]; for (var gi = 0; gi < gs.length; gi++) gs[gi].rotation.x = ar;
      var di; for (di = 0; di < T.dampers.length; di++) { var Dp = T.dampers[di]; var _T = new THREE.Vector3(Dp.px, 2 + Dp.dy0 * _c - Dp.dz0 * _sn, Dp.zc + Dp.dy0 * _sn + Dp.dz0 * _c); var _dir = _T.clone().sub(Dp.B), _len = _dir.length(), _mid = Dp.B.clone().lerp(_T, 0.5); var _q = new THREE.Quaternion().setFromUnitVectors(up, _dir.clone().normalize()); Dp.body.position.copy(_mid); Dp.body.quaternion.copy(_q); Dp.body.scale.y = _len * 0.62; Dp.rod.position.copy(_mid); Dp.rod.quaternion.copy(_q); Dp.rod.scale.y = _len; }
      var mi; for (mi = 0; mi < T.motorCables.length; mi++) { var M = T.motorCables[mi]; var _Bw = new THREE.Vector3(M.xs + M.Bx, 2 + M.By * _c - M.Bz * _sn, M.zc + M.By * _sn + M.Bz * _c); var _Aw = new THREE.Vector3(M.Ax, M.Ay, M.Az), _dd = _Bw.clone().sub(_Aw), _ll = _dd.length() || 1e-4; M.mesh.position.copy(_Aw).lerp(_Bw, 0.5); M.mesh.quaternion.setFromUnitVectors(up, _dd.normalize()); M.mesh.scale.y = _ll; }
      var an; if (T.antennas) for (an = 0; an < T.antennas.length; an++) T.antennas[an].rotation.x = -ar;   // la antena cuelga SIEMPRE vertical
    }
  }

  E.create = function (THREE_, mount, opts) {
    THREE = THREE_; opts = opts || {};
    var layout = opts.layout || 'single', detail = opts.detail || 'full';
    if (opts.loc) { LOC = opts.loc; LAT = LOC.lat * D2R; LON = LOC.lon; }
    dayN = opts.dayN || 172; if (opts.btOn === false) btOn = false;
    var ESC = { autoDay: opts.autoDay !== false, daySeconds: opts.daySeconds || 80, autoOrbit: !!opts.autoOrbit, hour: opts.hour != null ? opts.hour : 11, _ang: 0, trackers: [] };

    var sc = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(46, 1, 0.1, 20000);
    var rnd = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    rnd.setPixelRatio(Math.min(devicePixelRatio, 2));
    if (THREE.sRGBEncoding) rnd.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) { rnd.toneMapping = THREE.ACESFilmicToneMapping; rnd.toneMappingExposure = 1.0; }
    if ('physicallyCorrectLights' in rnd) rnd.physicallyCorrectLights = true;
    rnd.shadowMap.enabled = true; rnd.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(rnd.domElement);

    // IBL (reflejos realistas)
    try { if (THREE.RoomEnvironment && THREE.PMREMGenerator) { var pm = new THREE.PMREMGenerator(rnd); sc.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; } } catch (e) {}

    // cielo físico
    var sky = null, skyU = null;
    try { if (THREE.Sky) { sky = new THREE.Sky(); sky.scale.setScalar(12000); sc.add(sky); skyU = sky.material.uniforms; skyU.turbidity.value = 5; skyU.rayleigh.value = 1.8; skyU.mieCoefficient.value = 0.006; skyU.mieDirectionalG.value = 0.82; } } catch (e) {}
    if (!sky) sc.background = new THREE.Color(0x7aa0c4);

    sc.add(new THREE.AmbientLight(0xbcd0e6, 0.20));
    sc.add(new THREE.HemisphereLight(0xbcd6f5, 0x4a5236, 0.35));
    var sun = new THREE.DirectionalLight(0xfff4e2, 2.6); sc.add(sun); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    var hw = layout === 'field' ? 75 : 42, shc = sun.shadow.camera; shc.left = -hw; shc.right = hw; shc.top = hw; shc.bottom = -hw; shc.near = 1; shc.far = 400; shc.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sc.add(sun.target);

    // suelo + césped
    var gtex = grassTex(); gtex.repeat.set(90, 90);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: gtex, color: 0xbed0a8, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);
    (function () {
      var p1 = new THREE.PlaneGeometry(0.5, 0.42); p1.translate(0, 0.21, 0); var p2 = p1.clone(); p2.rotateY(Math.PI / 2);
      var pos = new Float32Array(p1.attributes.position.count * 3 + p2.attributes.position.count * 3);
      pos.set(p1.attributes.position.array, 0); pos.set(p2.attributes.position.array, p1.attributes.position.array.length);
      var uvA = new Float32Array(p1.attributes.uv.count * 2 + p2.attributes.uv.count * 2);
      uvA.set(p1.attributes.uv.array, 0); uvA.set(p2.attributes.uv.array, p1.attributes.uv.array.length);
      var idxOff = p1.attributes.position.count, i1 = p1.index.array, i2 = p2.index.array, idx = [], a;
      for (a = 0; a < i1.length; a++) idx.push(i1[a]); for (a = 0; a < i2.length; a++) idx.push(i2[a] + idxOff);
      var tuft = new THREE.BufferGeometry(); tuft.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tuft.setAttribute('uv', new THREE.BufferAttribute(uvA, 2)); tuft.setIndex(idx); tuft.computeVertexNormals();
      var gm = new THREE.MeshStandardMaterial({ map: grassBladeTex(), transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
      var N = 4200, inst = new THREE.InstancedMesh(tuft, gm, N), dm = new THREE.Object3D();
      for (var i = 0; i < N; i++) { dm.position.set((Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 90); dm.rotation.set(0, Math.random() * Math.PI, 0); var gs = 0.7 + Math.random() * 0.8; dm.scale.set(gs, gs + Math.random() * 0.5, gs); dm.updateMatrix(); inst.setMatrixAt(i, dm.matrix); if (inst.setColorAt) inst.setColorAt(i, new THREE.Color().setHSL(0.26 + Math.random() * 0.06, 0.55, 0.32 + Math.random() * 0.12)); }
      inst.castShadow = true; sc.add(inst);
    })();

    // materiales del seguidor con PBR (reflejos)
    var SG = Seguidor.materials(THREE); var ptex = panelTex();
    SG.glass.map = ptex; SG.glass.roughness = 0.10; SG.glass.metalness = 0.0; SG.glass.envMapIntensity = 1.7; SG.glass.emissive = new THREE.Color(0x101a2a); SG.glass.emissiveIntensity = 0.12; SG.glass.needsUpdate = true;
    SG.frame.metalness = 0.85; SG.frame.roughness = 0.32; SG.frame.envMapIntensity = 1.1;
    SG.steel.metalness = 0.9; SG.steel.roughness = 0.42; SG.steel.envMapIntensity = 1.0;
    SG.silver.metalness = 0.92; SG.silver.roughness = 0.28; SG.silver.envMapIntensity = 1.1;
    ['blue', 'motor', 'correa', 'tcu', 'jbox', 'cable'].forEach(function (k) { if (SG[k]) { SG[k].envMapIntensity = 0.9; } });
    ESC.materials = SG; ESC.panelTex = function () { return ptex; };

    var TR = [];
    if (layout === 'field') TR = [{ z: -3, xs: 0, w: true }, { z: 3, xs: 0, w: false }, { z: 9, xs: 6, w: true }, { z: 15, xs: 6, w: false }, { z: -9, xs: 6, w: true }, { z: -15, xs: 6, w: false }];
    else if (layout === 'single') TR = [{ z: 0, xs: 0, w: true }];
    for (var ti = 0; ti < TR.length; ti++) ESC.trackers.push(buildOne(sc, SG, TR[ti].xs, TR[ti].z, TR[ti].w, detail));

    var target = new THREE.Vector3(0, 2.4, 0);
    var ob = orbit(rnd.domElement, cam, target, layout === 'field' ? 64 : 26, layout === 'field' ? 18 : 9, 240);

    // post-proceso (bloom + SMAA), con degradado elegante
    var composer = null, bloom = null;
    try {
      if (THREE.EffectComposer && THREE.RenderPass) {
        composer = new THREE.EffectComposer(rnd);
        composer.addPass(new THREE.RenderPass(sc, cam));
        if (THREE.UnrealBloomPass) { bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 0.92); composer.addPass(bloom); }
        if (THREE.SMAAPass) { composer.addPass(new THREE.SMAAPass(256, 256)); }
      }
    } catch (e) { composer = null; }

    ESC.scene = sc; ESC.camera = cam; ESC.renderer = rnd; ESC.sun = sun; ESC.orbit = ob; ESC.target = target;
    ESC.angleDeg = function () { return ESC._ang; };
    ESC.setHour = function (h) { ESC.hour = h; };

    ESC.frame = function (now, dt) {
      if (ESC.autoDay) { ESC.hour += dt * (24 / ESC.daySeconds); if (ESC.hour >= 24) ESC.hour -= 24; if (ESC.hour < 0) ESC.hour += 24; }
      var ang = trackAngle(ESC.hour); ESC._ang = ang;
      for (var t = 0; t < ESC.trackers.length; t++) ESC.trackers[t].ang = ang;
      updateTrackers(ESC.trackers);
      // sol + cielo físico
      var P = solarPos(ESC.hour), el = P.el, ce = Math.cos(Math.max(el, -0.05));
      var dir = new THREE.Vector3(Math.cos(P.az) * ce, Math.sin(el), Math.sin(P.az) * ce);
      if (skyU) skyU.sunPosition.value.copy(dir);
      sun.position.copy(dir.clone().multiplyScalar(140)); sun.target.position.set(0, 2, 0); sun.target.updateMatrixWorld();
      var day = Math.max(0, Math.sin(el)); sun.intensity = 0.15 + day * 3.1; sun.color.setHex(el > 0 && el < 0.25 ? 0xffcaa0 : 0xfff4e2);
      rnd.toneMappingExposure = 0.42 + 0.7 * Math.min(1, day * 1.35);
      if (!sky) { var k = clamp(day * 1.6, 0, 1); sc.background.setHSL(0.58, 0.4, 0.18 + 0.45 * k); }
      if (ESC.autoOrbit && !ESC._dragged) { ob.st.theta += dt * 0.1; ob.apply(); }
      ESC._dragged = 0;
      if (composer) composer.render(); else rnd.render(sc, cam);
    };
    ESC.resize = function () { var w = mount.clientWidth || innerWidth, h = mount.clientHeight || innerHeight; if (w < 2 || h < 2) return; rnd.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); if (composer) composer.setSize(w, h); };
    ESC.resize();
    return ESC;
  };

  /* ====================================================================
   * MODO PLANTA: campo de N seguidores con InstancedMesh (Seguidor.instancePlan),
   * misma escena/materiales/cielo/post que create(). Un InstancedMesh por tipo de
   * pieza. Tubo a lo largo de Z (Ry -90°); basculación = Rx(ángulo). Mismo render.
   *   var ESC = Escena.createPlant(THREE, mount, {positions:[{x,z}], dayN, hour, autoDay});
   *   ESC.tiltDeg / ESC.override[i]   ESC.hour   ESC.frame(now,dt)
   *   ESC.hitboxes   ESC.onTap=function(i){}   ESC.markerPos(i)->Vector3
   * ==================================================================== */
  E.createPlant = function (THREE_, mount, opts) {
    THREE = THREE_; opts = opts || {};
    if (opts.loc) { LOC = opts.loc; LAT = LOC.lat * D2R; LON = LOC.lon; }
    dayN = opts.dayN || 172;
    var positions = opts.positions || [], N = positions.length;
    var ESC = { trackers: N, tiltDeg: 0, override: {}, hour: opts.hour != null ? opts.hour : 12, autoDay: !!opts.autoDay, daySeconds: opts.daySeconds || 120, autoOrbit: !!opts.autoOrbit, onTap: null, hitboxes: [] };

    var sc = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(48, 1, 1, 9000);
    var rnd = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    rnd.setPixelRatio(Math.min(devicePixelRatio, 2));
    if (THREE.sRGBEncoding) rnd.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) { rnd.toneMapping = THREE.ACESFilmicToneMapping; rnd.toneMappingExposure = 1.0; }
    if ('physicallyCorrectLights' in rnd) rnd.physicallyCorrectLights = true;
    rnd.shadowMap.enabled = true; rnd.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(rnd.domElement);
    try { if (THREE.RoomEnvironment && THREE.PMREMGenerator) { var pm = new THREE.PMREMGenerator(rnd); sc.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; } } catch (e) {}
    var sky = null, skyU = null;
    try { if (THREE.Sky) { sky = new THREE.Sky(); sky.scale.setScalar(12000); sc.add(sky); skyU = sky.material.uniforms; skyU.turbidity.value = 5; skyU.rayleigh.value = 1.8; skyU.mieCoefficient.value = 0.006; skyU.mieDirectionalG.value = 0.82; } } catch (e) {}
    if (!sky) sc.background = new THREE.Color(0x7aa0c4);
    sc.add(new THREE.AmbientLight(0xbcd0e6, 0.20));
    sc.add(new THREE.HemisphereLight(0xbcd6f5, 0x4a5236, 0.35));
    var sun = new THREE.DirectionalLight(0xfff4e2, 2.6); sc.add(sun); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    var bx = 1; positions.forEach(function (p) { bx = Math.max(bx, Math.abs(p.x), Math.abs(p.z)); });
    var hw = Math.min(360, bx * 1.05) + 50, shc = sun.shadow.camera; shc.left = -hw; shc.right = hw; shc.top = hw; shc.bottom = -hw; shc.near = 1; shc.far = 3000; shc.updateProjectionMatrix(); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; sc.add(sun.target);
    var gw = Math.max(240, bx * 2.6), gtex = grassTex(); gtex.repeat.set(Math.max(40, gw / 6), Math.max(40, gw / 6));
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gw), new THREE.MeshStandardMaterial({ map: gtex, color: 0xbed0a8, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);

    var SG = Seguidor.materials(THREE), ptex = panelTex();
    SG.glass.map = ptex; SG.glass.roughness = 0.10; SG.glass.metalness = 0.0; SG.glass.envMapIntensity = 1.7; SG.glass.emissive = new THREE.Color(0x101a2a); SG.glass.emissiveIntensity = 0.12; SG.glass.needsUpdate = true;
    SG.frame.metalness = 0.85; SG.frame.roughness = 0.32; SG.steel.metalness = 0.9; SG.steel.roughness = 0.42; SG.silver.metalness = 0.92; SG.silver.roughness = 0.28;
    ['blue', 'motor', 'correa', 'tcu', 'jbox', 'cable'].forEach(function (k) { if (SG[k]) SG[k].envMapIntensity = 0.9; });
    ESC.materials = SG;

    var composer = null;
    try { if (THREE.EffectComposer && THREE.RenderPass) { composer = new THREE.EffectComposer(rnd); composer.addPass(new THREE.RenderPass(sc, cam)); if (THREE.UnrealBloomPass) composer.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.55, 0.92)); if (THREE.SMAAPass) composer.addPass(new THREE.SMAAPass(256, 256)); } } catch (e) { composer = null; }

    // ---- campo: DETALLADO (buildOne, calidad gemelo) o instanciado (escala) ----
    ESC.trackers = [];
    var groups = [], rebuildSpin = function () { };
    if (opts.detailed) {
      for (var pdi = 0; pdi < N; pdi++) { ESC.trackers.push(buildBifila(sc, SG, positions[pdi].x, positions[pdi].z, 'full')); }
    } else {
      var KEEP = { tube: 1, tubecap: 1, mesa: 1, correa: 1, cable: 1, jbox: 1, corona: 1, reductora: 1, cuello: 1, motor: 1, tapa: 1 };
      var plan = Seguidor.instancePlan(THREE, { detail: 'mass', size: 'largo' }).filter(function (p) { return KEEP[p.key]; });
      var Ry = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
      plan.forEach(function (pt) {
        var L = pt.locals.length, mesh = new THREE.InstancedMesh(pt.geom(THREE), SG[pt.mat], N * L);
        mesh.castShadow = !!pt.cast; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        sc.add(mesh); groups.push({ mesh: mesh, spin: pt.spin, locals: pt.locals, L: L });
      });
      var postGeo = new THREE.BoxGeometry(0.14, 2.0, 0.14), post = new THREE.InstancedMesh(postGeo, SG.steel, N * 2), pdm = new THREE.Object3D();
      post.castShadow = true; sc.add(post);
      for (var pti = 0; pti < N; pti++) { for (var pk = 0; pk < 2; pk++) { pdm.position.set(positions[pti].x, 1.0, positions[pti].z + (pk ? 18 : -18)); pdm.updateMatrix(); post.setMatrixAt(pti * 2 + pk, pdm.matrix); } }
      post.instanceMatrix.needsUpdate = true;
      var tmpA = new THREE.Matrix4(), tmpB = new THREE.Matrix4(), tmpM = new THREE.Matrix4();
      var fillGroup = function (rec, useAngle) {
        var L = rec.L, RyRx = tmpA.copy(Ry); if (rec.spin) RyRx.multiply(tmpB.makeRotationX((useAngle || 0) * D2R));
        var Ml = []; for (var l = 0; l < L; l++) Ml[l] = new THREE.Matrix4().copy(RyRx).multiply(rec.locals[l]);
        for (var t = 0; t < N; t++) {
          var ov = ESC.override[t];
          for (var l2 = 0; l2 < L; l2++) {
            if (rec.spin && ov != null) { tmpM.copy(Ry).multiply(tmpB.makeRotationX(ov * D2R)).multiply(rec.locals[l2]); }
            else { tmpM.copy(Ml[l2]); }
            tmpM.elements[12] += positions[t].x; tmpM.elements[13] += 2; tmpM.elements[14] += positions[t].z;
            rec.mesh.setMatrixAt(t * L + l2, tmpM);
          }
        }
        rec.mesh.instanceMatrix.needsUpdate = true;
      };
      rebuildSpin = function () { for (var i = 0; i < groups.length; i++) if (groups[i].spin) fillGroup(groups[i], ESC.tiltDeg); };
      var buildStatic = function () { for (var i = 0; i < groups.length; i++) if (!groups[i].spin) fillGroup(groups[i], 0); };
      buildStatic(); rebuildSpin();
    }

    // hitboxes por seguidor (para tap)
    var hbGeo = opts.detailed ? new THREE.BoxGeometry(64, 3, 9) : new THREE.BoxGeometry(5, 3, 64), hbMat = new THREE.MeshBasicMaterial({ visible: false });
    for (var hi = 0; hi < N; hi++) { var hb = new THREE.Mesh(hbGeo, hbMat); hb.position.set(positions[hi].x, 2, positions[hi].z); hb.userData.idx = hi; sc.add(hb); ESC.hitboxes.push(hb); }
    ESC.markerPos = function (i) { return new THREE.Vector3(positions[i].x, 4.5, positions[i].z); };

    // ---- cámara: órbita + paneo + zoom + tap ----
    var view = { theta: 0.85, phi: 0.66, radius: Math.max(120, bx * 1.3), tx: 0, tz: 0 };
    var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function applyCam() { var sp = Math.sin(view.phi), cp = Math.cos(view.phi); cam.position.set(view.tx + view.radius * sp * Math.sin(view.theta), view.radius * cp, view.tz + view.radius * sp * Math.cos(view.theta)); cam.lookAt(view.tx, 0, view.tz); }
    (function (dom) {
      var ptrs = {}, down = null, pinchD = 0, mode = null, lastMid = null;
      dom.style.touchAction = 'none';
      function npt() { return Object.keys(ptrs).length; }
      function pdist() { var k = Object.keys(ptrs); if (k.length < 2) return 0; var a = ptrs[k[0]], b = ptrs[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
      function pmid() { var k = Object.keys(ptrs); var a = ptrs[k[0]], b = ptrs[k[1]]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      function panBy(dx, dy) { var s = view.radius * 0.0016, a = view.theta; view.tx -= (dx * Math.cos(a) - dy * Math.sin(a)) * s; view.tz -= (dx * Math.sin(a) + dy * Math.cos(a)) * s; applyCam(); }
      dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      dom.addEventListener('pointerdown', function (e) { ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; try { dom.setPointerCapture(e.pointerId); } catch (_) {} if (npt() === 1) { down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rot'; } else if (npt() === 2) { down = null; mode = 'multi'; pinchD = pdist(); lastMid = pmid(); } });
      dom.addEventListener('pointermove', function (e) { var prev = ptrs[e.pointerId]; if (!prev) return; var dx = e.clientX - prev.x, dy = e.clientY - prev.y; ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; if (mode === 'multi' && npt() >= 2) { var d = pdist(); if (pinchD > 0 && d > 0) view.radius = clamp(view.radius * pinchD / d, 40, 1400); pinchD = d; var m = pmid(); if (lastMid) panBy(m.x - lastMid.x, m.y - lastMid.y); lastMid = m; applyCam(); return; } if (down && (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 9)) down.moved = true; if (mode === 'pan') panBy(dx, dy); else { view.theta -= dx * 0.005; view.phi = clamp(view.phi - dy * 0.005, 0.18, 1.4); applyCam(); } });
      function endp(e) { var single = npt() === 1; if (down && !down.moved && single && (performance.now() - down.t) < 450) tapAt(down.x, down.y); delete ptrs[e.pointerId]; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} if (npt() === 0) { down = null; mode = null; pinchD = 0; lastMid = null; } }
      dom.addEventListener('pointerup', endp); dom.addEventListener('pointercancel', endp);
      dom.addEventListener('wheel', function (e) { e.preventDefault(); view.radius = clamp(view.radius * (1 + Math.sign(e.deltaY) * 0.1), 40, 1400); applyCam(); }, { passive: false });
    })(rnd.domElement);
    function tapAt(cx, cy) { if (!ESC.onTap) return; var r = rnd.domElement.getBoundingClientRect(); ndc.x = ((cx - r.left) / r.width) * 2 - 1; ndc.y = -((cy - r.top) / r.height) * 2 + 1; ray.setFromCamera(ndc, cam); var h = ray.intersectObjects(ESC.hitboxes, false); if (h.length) ESC.onTap(h[0].object.userData.idx); }
    applyCam();

    ESC.scene = sc; ESC.camera = cam; ESC.renderer = rnd; ESC.sun = sun; ESC.view = view; ESC.applyCam = applyCam;
    ESC.rebuildSpin = rebuildSpin;
    var lastTilt = null, lastOv = '';
    ESC.frame = function (now, dt) {
      if (ESC.autoDay) { ESC.hour += dt * (24 / ESC.daySeconds); if (ESC.hour >= 24) ESC.hour -= 24; ESC.tiltDeg = trackAngle(ESC.hour); }
      if (opts.detailed) {
        for (var ti = 0; ti < ESC.trackers.length; ti++) ESC.trackers[ti].ang = (ESC.override[ti] != null ? ESC.override[ti] : ESC.tiltDeg);
        updateTrackers(ESC.trackers);
      } else {
        var ovKey = ESC.tiltDeg.toFixed(2) + '|' + Object.keys(ESC.override).join(',');
        if (ovKey !== lastOv) { rebuildSpin(); lastOv = ovKey; }
      }
      var P = solarPos(ESC.hour), el = P.el, ce = Math.cos(Math.max(el, -0.05));
      var dir = new THREE.Vector3(Math.cos(P.az) * ce, Math.sin(el), Math.sin(P.az) * ce);
      if (skyU) skyU.sunPosition.value.copy(dir);
      sun.position.copy(dir.clone().multiplyScalar(300)); sun.target.position.set(0, 2, 0); sun.target.updateMatrixWorld();
      var day = Math.max(0, Math.sin(el)); sun.intensity = 0.15 + day * 3.1; sun.color.setHex(el > 0 && el < 0.25 ? 0xffcaa0 : 0xfff4e2);
      rnd.toneMappingExposure = 0.42 + 0.7 * Math.min(1, day * 1.35);
      if (!sky) sc.background.setHSL(0.58, 0.4, 0.18 + 0.45 * clamp(day * 1.6, 0, 1));
      if (ESC.autoOrbit) { view.theta += dt * 0.05; applyCam(); }
      if (composer) composer.render(); else rnd.render(sc, cam);
    };
    ESC.resize = function () { var w = mount.clientWidth || innerWidth, h = mount.clientHeight || innerHeight; if (w < 2 || h < 2) return; rnd.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); if (composer) composer.setSize(w, h); };
    ESC.resize();
    return ESC;
  };

  root.Escena = E;
})(typeof window !== 'undefined' ? window : this);
