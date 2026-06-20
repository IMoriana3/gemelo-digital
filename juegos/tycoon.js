/* ============================================================================
 * Solar Tycoon — Operador de Planta  (juego interno Factiun)
 * ----------------------------------------------------------------------------
 * Mini-juego 3D: gestiona una planta de seguidores solares durante un día
 * acelerado y maximiza la producción. Reutiliza la FUENTE ÚNICA del seguidor
 * (../seguidor.js) y la física solar real del Gemelo Digital (solarPos /
 * trackAngle con backtracking Anderson-Mikofski).
 *
 * Pensado para 3 usos: formación (consejos), team building (ranking por
 * equipos) y ferias/stand (pantalla táctil, partidas cortas).
 *
 * Sin dependencias de build: Three.js r128 (CDN) + seguidor.js.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ===================== utilidades ===================== */
  var el = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function fmt(n, d) { return n.toFixed(d == null ? 0 : d).replace('.', ','); }
  function fmtEur(n) {
    var s = Math.round(n).toString();
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
  }
  function clockOf(h) {
    var hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  /* ===================== física solar (espejo del Gemelo) ===================== */
  /* Mismas fórmulas que index.html del gemelo-digital, autocontenidas aquí. */
  var AXIS_MAX = 55, CHORD = 2.382, PITCH = 6.0, GCR = CHORD / PITCH;
  // Emplazamiento por defecto: El Burgo (Zaragoza). Buen recurso solar.
  var LOC = { n: 'El Burgo · Zaragoza', lat: 41.576, lon: -0.798, tz: 1, dst: true };
  var LAT = LOC.lat * D2R, LON = LOC.lon;
  var dayN = 172;        // 21-jun por defecto (día largo, vistoso)
  var btOn = true;       // backtracking activado

  function declOf(N) { return 23.45 * Math.sin(2 * Math.PI * (284 + (N || 1)) / 365) * D2R; }
  function tzOffset(N) { return LOC.tz + ((LOC.dst && N >= 86 && N <= 303) ? 1 : 0); }
  function solarShift(N) {
    var LSTM = 15 * tzOffset(N), B = 2 * Math.PI / 365 * ((N || 1) - 81);
    var EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    return (4 * (LON - LSTM) + EoT) / 60;
  }
  function solarPos(h) {
    var DECL = declOf(dayN), hs = h + solarShift(dayN);
    var w = (hs - 12) * 15 * D2R;
    var sinEl = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(w);
    var elv = Math.asin(clamp(sinEl, -1, 1));
    var caz = (sinEl * Math.sin(LAT) - Math.sin(DECL)) / Math.max(1e-6, (Math.cos(elv) * Math.cos(LAT)));
    var az = Math.acos(clamp(caz, -1, 1)); if (w < 0) az = -az;
    return { el: elv, az: az };
  }
  function trackAngle(h) {
    var P = solarPos(h);
    if (P.el <= 0.0001) return { R: -5, bt: false, el: P.el, cosAOI: 0 };
    var sx = Math.cos(P.el) * Math.sin(P.az), sz = Math.sin(P.el);
    var Rtrue = Math.atan2(sx, sz);
    var axesD = 1 / GCR, temp = Math.min(1, axesD * Math.cos(Rtrue));
    var Rbt = Rtrue - Math.sign(Rtrue) * Math.acos(temp);
    var Rsel = btOn ? Rbt : Rtrue;
    var bt = btOn && Math.abs(Rbt) < Math.abs(Rtrue) - 1e-3;
    var Rdeg = clamp(Rsel * R2D, -AXIS_MAX, AXIS_MAX);
    var Rr = Rdeg * D2R, cosAOI = Math.max(0, sx * Math.sin(Rr) + sz * Math.cos(Rr));
    return { R: Rdeg, bt: bt, el: P.el, cosAOI: cosAOI };
  }

  /* ===================== parámetros de juego ===================== */
  var NUM = 9;                 // nº de seguidores en la planta
  var PNOM = 45;              // kWp por seguidor (2 alas · 28 mód · ~0,8 kWp bifacial)
  var PRICE = 0.12;           // €/kWh
  var H0 = 5.0, H1 = 21.0;     // ventana horaria simulada (amanecer..anochecer verano)

  // Dificultades: duración del día (s) + ritmo de averías + nº de vendavales + nubes
  var DIFFS = {
    facil:  { lbl: 'Fácil · feria',     dur: 120, failMean: 16, winds: 1, maxCloud: 0.35, repair: 80,  windPen: 250, caja0: 600 },
    normal: { lbl: 'Normal · equipo',   dur: 100, failMean: 10, winds: 2, maxCloud: 0.55, repair: 90,  windPen: 350, caja0: 500 },
    dificil:{ lbl: 'Difícil · reto',    dur: 90,  failMean: 6.5, winds: 3, maxCloud: 0.7,  repair: 110, windPen: 500, caja0: 450 }
  };

  /* ===================== estado del juego ===================== */
  var G = null;   // objeto de partida (se crea en startGame)
  function newGameState(diffKey, team) {
    var d = DIFFS[diffKey];
    return {
      diffKey: diffKey, diff: d, team: team || 'Equipo',
      running: false, t: 0, h: H0,
      caja: d.caja0, ingresos: 0, costes: 0,
      realKWh: 0, idealKWh: 0, kW: 0,
      cloud: 0, cloudTarget: 0, cloudTimer: 0,
      failTimer: d.failMean * (0.5 + Math.random()),
      windQueue: [], windState: 'idle', windTimer: 0, safety: false, safetyAuto: false,
      tipsShown: {}, finished: false
    };
  }

  /* ===================== Three.js: escena ===================== */
  var THREE = window.THREE;
  var renderer, scene, camera, sun, sunSprite, sky;
  var trackers = [], hitboxes = [];
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  var SKY_NIGHT = new THREE.Color(0x0a1422), SKY_DUSK = new THREE.Color(0x8a5236),
      SKY_DAY = new THREE.Color(0x4f78a6), SKY_OVC = new THREE.Color(0x8a929b);
  var view = { theta: 0.95, phi: 0.82, radius: 95, target: new THREE.Vector3(0, 2, 0) };

  function panelTex() {
    var W = 96, H = 192, c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); x.fillStyle = '#0a1019'; x.fillRect(0, 0, W, H);
    var nx = 6, ny = 12, cw = W / nx, ch = H / ny, gap = 1.3;
    for (var iy = 0; iy < ny; iy++) for (var ix = 0; ix < nx; ix++) {
      var L = 7.5 + Math.random() * 3.5;
      x.fillStyle = 'hsl(214,48%,' + L.toFixed(1) + '%)';
      x.fillRect(ix * cw + gap, iy * ch + gap, cw - 2 * gap, ch - 2 * gap);
    }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  function grassTex() {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    x.fillStyle = '#3c6b2c'; x.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 4200; i++) {
      var gx = Math.random() * 256, gy = Math.random() * 256, l = 2 + Math.random() * 7, dx = (Math.random() - 0.5) * 3;
      x.strokeStyle = 'hsl(' + (92 + Math.random() * 34) + ',' + (40 + Math.random() * 25) + '%,' + (20 + Math.random() * 34) + '%)';
      x.lineWidth = 0.8 + Math.random() * 1.1; x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + dx, gy - l); x.stroke();
    }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function glowTex() {
    var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  function warnTex() {
    var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128);
    x.fillStyle = '#e2574c'; x.beginPath(); x.moveTo(64, 14); x.lineTo(116, 110); x.lineTo(12, 110); x.closePath(); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 6; x.stroke();
    x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('!', 64, 74);
    return new THREE.CanvasTexture(c);
  }
  var GLOW = null, WARN = null;
  function sprite(map, color, size) {
    var m = new THREE.SpriteMaterial({ map: map, color: color, transparent: true, depthWrite: false });
    var sp = new THREE.Sprite(m); sp.scale.set(size, size, 1); return sp;
  }

  function buildScene(canvasWrap) {
    scene = new THREE.Scene();
    scene.background = SKY_DAY.clone();
    scene.fog = new THREE.Fog(0x9fb3c4, 160, 460);
    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 900);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasWrap.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x4a5e72, 0.75));
    var hemi = new THREE.HemisphereLight(0xbfd4ea, 0x47502f, 0.45); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff2d8, 1.0); scene.add(sun); scene.add(sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    var shc = sun.shadow.camera; shc.left = -70; shc.right = 70; shc.top = 70; shc.bottom = -70; shc.near = 1; shc.far = 520; shc.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;

    GLOW = glowTex(); WARN = warnTex();
    sunSprite = sprite(GLOW, 0xffe6a0, 26); scene.add(sunSprite);

    // suelo
    var gtex = grassTex(); gtex.repeat.set(60, 60);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700),
      new THREE.MeshStandardMaterial({ map: gtex, color: 0xc2d0b2, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    buildPlant();
    bindCamera(renderer.domElement);
    applyCam();
  }

  function buildPlant() {
    var dims = Seguidor.DIMS, tubeLen = dims.span;       // 'largo'
    var SG = Seguidor.materials(THREE);
    var ptex = panelTex();
    SG.glass.map = ptex; SG.glass.emissiveMap = ptex; SG.glass.emissive = new THREE.Color(0x2b333d); SG.glass.emissiveIntensity = 0.28; SG.glass.needsUpdate = true;
    var steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ac, roughness: 0.45, metalness: 0.65 });

    for (var i = 0; i < NUM; i++) {
      var z = (i - (NUM - 1) / 2) * PITCH;
      var beam = Seguidor.buildBeam(THREE, {
        west: true, materials: SG, detail: 'mass', size: 'largo',
        skip: { soporte: 1, bracket: 1, antena: 1, antenatip: 1 }
      });
      var g = new THREE.Group(); g.position.set(0, 2, z); g.add(beam.spin); scene.add(g);
      var slew = new THREE.Group(); slew.position.set(0, 2, z); slew.add(beam.static); scene.add(slew);

      // postes simples a lo largo del tubo
      for (var px = -tubeLen / 2 + 3; px <= tubeLen / 2 - 3; px += 9) {
        var col = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.0, 0.14), steel);
        col.position.set(px, 1.0, z); col.castShadow = true; scene.add(col);
      }

      // hitbox invisible (clic/tap fácil sobre todo el seguidor)
      var hb = new THREE.Mesh(new THREE.BoxGeometry(tubeLen, 3.2, 3.4),
        new THREE.MeshBasicMaterial({ visible: false }));
      hb.position.set(0, 2, z); hb.userData.idx = i; scene.add(hb); hitboxes.push(hb);

      trackers.push({ g: g, z: z, failed: false, marker: null, angle: 0, target: 0, failAngle: 0 });
    }
  }

  /* ===================== posición del sol en el mundo ===================== */
  function sunWorldDir(h) {
    var P = solarPos(h);
    var cx = Math.cos(P.el) * Math.cos(P.az);   // +X = Sur
    var cz = Math.cos(P.el) * Math.sin(P.az);   // +Z = Oeste
    var cy = Math.sin(P.el);                     // +Y = arriba
    return new THREE.Vector3(cx, cy, cz);
  }

  /* ===================== cámara (órbita + tap) ===================== */
  function applyCam() {
    var sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    camera.position.set(
      view.target.x + view.radius * sp * Math.sin(view.theta),
      view.target.y + view.radius * cp,
      view.target.z + view.radius * sp * Math.cos(view.theta));
    camera.lookAt(view.target);
  }
  function bindCamera(dom) {
    var ptrs = {}, down = null, pinchD = 0;
    dom.style.touchAction = 'none';
    function npt() { return Object.keys(ptrs).length; }
    function pdist() { var k = Object.keys(ptrs); if (k.length < 2) return 0; var a = ptrs[k[0]], b = ptrs[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    dom.addEventListener('pointerdown', function (e) {
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { dom.setPointerCapture(e.pointerId); } catch (_) {}
      if (npt() === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      else { down = null; pinchD = pdist(); }
    });
    dom.addEventListener('pointermove', function (e) {
      var prev = ptrs[e.pointerId]; if (!prev) return;
      var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (npt() >= 2) { var d = pdist(); if (pinchD > 0 && d > 0) view.radius = clamp(view.radius * pinchD / d, 30, 240); pinchD = d; applyCam(); return; }
      if (down && (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 9)) down.moved = true;
      view.theta -= dx * 0.005; view.phi = clamp(view.phi - dy * 0.005, 0.15, 1.45); applyCam();
    });
    function endp(e) {
      var single = npt() === 1;
      if (down && !down.moved && single && (performance.now() - down.t) < 450) handleTap(down.x, down.y);
      delete ptrs[e.pointerId]; try { dom.releasePointerCapture(e.pointerId); } catch (_) {}
      down = null; pinchD = 0;
    }
    dom.addEventListener('pointerup', endp);
    dom.addEventListener('pointercancel', endp);
    dom.addEventListener('wheel', function (e) { e.preventDefault(); view.radius = clamp(view.radius * (1 + Math.sign(e.deltaY) * 0.1), 30, 240); applyCam(); }, { passive: false });
  }
  function handleTap(cx, cy) {
    if (!G || !G.running) return;
    var r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((cx - r.left) / r.width) * 2 - 1;
    ndc.y = -((cy - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    var hit = ray.intersectObjects(hitboxes, false);
    if (hit.length) onTrackerTap(hit[0].object.userData.idx);
  }
  function onTrackerTap(idx) {
    var t = trackers[idx];
    if (t.failed) {
      if (G.caja < G.diff.repair) { toast('Sin presupuesto para reparar (' + fmtEur(G.diff.repair) + ')', 'warn'); return; }
      G.caja -= G.diff.repair; G.costes += G.diff.repair;
      t.failed = false; if (t.marker) { scene.remove(t.marker); t.marker = null; }
      toast('🔧 Seguidor ' + (idx + 1) + ' reparado · −' + fmtEur(G.diff.repair), 'ok');
      tip('reparar', 'Cada minuto de avería = energía perdida. Repararlo rápido sale rentable.');
    } else {
      var kw = trackerKW(idx);
      toast('Seguidor ' + (idx + 1) + ' · ' + fmt(kw, 1) + ' kW · OK', 'info', 1400);
    }
  }

  /* ===================== producción ===================== */
  var _trk = { cosAOI: 0, el: 0 }, _irr = 0, _skyT = 1;
  function trackerKW(idx) {
    var t = trackers[idx];
    if (t.failed) return 0;
    var factor = G.safety ? 0.05 : 1;
    return PNOM * _irr * _skyT * _trk.cosAOI * factor;
  }

  /* ===================== eventos ===================== */
  function spawnFailure() {
    var healthy = [];
    for (var i = 0; i < trackers.length; i++) if (!trackers[i].failed) healthy.push(i);
    if (!healthy.length) return;
    var idx = healthy[(Math.random() * healthy.length) | 0];
    var t = trackers[idx];
    t.failed = true;
    t.failAngle = (Math.random() * 2 - 1) * 40 * D2R;   // se queda "torcido"
    var m = sprite(WARN, 0xffffff, 7); m.position.set(0, 6.5, t.z); m.userData.pulse = Math.random() * 6.28;
    scene.add(m); t.marker = m;
    toast('⚠ Avería en el seguidor ' + (idx + 1) + ' — ¡tócalo para reparar!', 'warn');
    tip('averia', 'Un seguidor averiado deja de producir. Tócalo para enviar un técnico.');
  }

  function scheduleWinds() {
    G.windQueue = [];
    var n = G.diff.winds;
    for (var i = 0; i < n; i++) {
      var frac = 0.22 + (i + Math.random() * 0.6) * (0.66 / n);
      G.windQueue.push({ at: clamp(frac, 0.15, 0.92), done: false });
    }
  }
  var WARN_S = 6, GUST_S = 7;
  function updateWind(dt, frac) {
    if (G.windState === 'idle') {
      for (var i = 0; i < G.windQueue.length; i++) {
        var w = G.windQueue[i];
        if (!w.done && frac >= w.at) {
          w.done = true; G.windState = 'warning'; G.windTimer = WARN_S;
          windBanner(true, '💨 ¡VIENTO FUERTE en camino! Pon la planta en SEGURIDAD');
          tip('viento', 'Con rachas >60 km/h hay que llevar los seguidores a posición de seguridad (planos) para no dañar la estructura.');
          break;
        }
      }
    } else if (G.windState === 'warning') {
      G.windTimer -= dt;
      if (G.windTimer <= 0) {
        G.windState = 'gust'; G.windTimer = GUST_S;
        if (!G.safety) {
          // daños: penalización + averías
          G.caja -= G.diff.windPen; G.costes += G.diff.windPen;
          spawnFailure(); if (Math.random() < 0.6) spawnFailure();
          windBanner(true, '🌪️ ¡DAÑOS POR VIENTO! −' + fmtEur(G.diff.windPen), 'bad');
          toast('No diste a Seguridad a tiempo: daños por viento', 'warn');
        } else {
          G.safetyAuto = true;
          windBanner(true, '🛡️ Planta protegida — racha en curso', 'ok');
        }
      }
    } else if (G.windState === 'gust') {
      G.windTimer -= dt;
      if (G.windTimer <= 0) {
        G.windState = 'idle'; windBanner(false);
        if (G.safetyAuto) { G.safety = false; G.safetyAuto = false; syncSafetyBtn(); toast('Viento amainó — planta reanudada', 'ok'); }
      }
    }
  }

  /* ===================== bucle ===================== */
  var lastNow = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0; lastNow = now;
    if (G && G.running) step(dt);
    // sol/cielo aunque esté pausado, para que se vea bonito
    renderer.render(scene, camera);
  }

  function step(dt) {
    G.t += dt;
    var frac = clamp(G.t / G.diff.dur, 0, 1);
    G.h = H0 + (H1 - H0) * frac;
    var dH = (H1 - H0) * dt / G.diff.dur;   // horas simuladas avanzadas

    // --- sol + cielo ---
    var dir = sunWorldDir(G.h);
    _trk = trackAngle(G.h);
    _irr = Math.max(0, Math.sin(Math.max(0, _trk.el)));
    sun.position.copy(dir.clone().multiplyScalar(240));
    sun.target.position.set(0, 0, 0);
    var dayl = clamp(Math.sin(Math.max(0, _trk.el)) * 1.4, 0, 1);
    sun.intensity = 0.15 + dayl * 0.95;
    sunSprite.position.copy(dir.clone().multiplyScalar(260)); sunSprite.position.y = Math.max(6, sunSprite.position.y);
    sunSprite.material.opacity = clamp(_trk.el > -0.05 ? 1 : 0, 0, 1);

    // --- nubes (paseo aleatorio suave) ---
    G.cloudTimer -= dt;
    if (G.cloudTimer <= 0) { G.cloudTimer = 2.5 + Math.random() * 4; G.cloudTarget = Math.random() * G.diff.maxCloud; }
    G.cloud += (G.cloudTarget - G.cloud) * Math.min(1, dt * 0.5);
    _skyT = clamp(1 - G.cloud * 0.8, 0.15, 1);
    if (G.cloud > 0.45) tip('nubes', 'Las nubes reducen la irradiancia: la producción baja aunque los seguidores apunten bien.');

    // color de cielo según elevación + nubes
    var c = new THREE.Color();
    if (_trk.el <= 0) c.copy(SKY_NIGHT);
    else { var k = clamp(Math.sin(_trk.el) * 1.6, 0, 1); c.copy(SKY_DUSK).lerp(SKY_DAY, k); }
    c.lerp(SKY_OVC, (1 - _skyT) * 0.7);
    scene.background.copy(c); if (scene.fog) scene.fog.color.copy(c);

    // --- ángulos de los seguidores ---
    var baseR = _trk.R * D2R;
    for (var i = 0; i < trackers.length; i++) {
      var t = trackers[i];
      t.target = t.failed ? t.failAngle : (G.safety ? 0 : baseR);
      t.angle += (t.target - t.angle) * Math.min(1, dt * 3.5);
      t.g.rotation.x = t.angle;
      if (t.marker) { t.marker.userData.pulse += dt * 5; t.marker.scale.setScalar(6.5 + Math.sin(t.marker.userData.pulse) * 1.2); }
    }

    // --- producción + economía ---
    var realKW = 0;
    for (var j = 0; j < trackers.length; j++) realKW += trackerKW(j);
    var idealKW = PNOM * _irr * _skyT * _trk.cosAOI * NUM;
    G.kW = realKW;
    G.realKWh += realKW * dH;
    G.idealKWh += idealKW * dH;
    var ingr = realKW * dH * PRICE;
    G.caja += ingr; G.ingresos += ingr;

    // --- averías ---
    G.failTimer -= dt;
    if (G.failTimer <= 0) { G.failTimer = G.diff.failMean * (0.6 + Math.random() * 0.9); spawnFailure(); }

    // --- viento ---
    updateWind(dt, frac);

    // --- consejo amanecer/backtracking ---
    if (_trk.bt && G.h < 9) tip('bt', 'Al amanecer/atardecer el backtracking inclina los seguidores para que no se den sombra entre filas.');

    updateHUD(frac);
    if (frac >= 1) finishGame();
  }

  /* ===================== HUD ===================== */
  function updateHUD(frac) {
    el('hClock').textContent = clockOf(G.h);
    el('hPow').textContent = fmt(G.kW, 0) + ' kW';
    var e = G.realKWh;
    el('hErg').textContent = e >= 1000 ? fmt(e / 1000, 2) + ' MWh' : fmt(e, 0) + ' kWh';
    el('hCash').textContent = fmtEur(G.caja);
    var rend = G.idealKWh > 0 ? clamp(G.realKWh / G.idealKWh * 100, 0, 100) : 100;
    el('hPerf').textContent = fmt(rend, 0) + '%';
    var nf = 0; for (var i = 0; i < trackers.length; i++) if (trackers[i].failed) nf++;
    var hf = el('hFail'); hf.textContent = nf + ' / ' + NUM;
    hf.style.color = nf ? 'var(--danger)' : 'var(--tx)';
    el('dayBar').style.width = (frac * 100).toFixed(1) + '%';
  }

  /* ===================== toasts + consejos + banners ===================== */
  var toastTimer = null;
  function toast(msg, kind, ms) {
    var t = el('toast'); t.textContent = msg;
    t.className = 'toast show ' + (kind || 'info');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, ms || 2600);
  }
  function tip(key, msg) {
    if (!G || G.tipsShown[key]) return; G.tipsShown[key] = true;
    var b = el('tip'); el('tipTxt').textContent = msg; b.classList.add('show');
    setTimeout(function () { b.classList.remove('show'); }, 6500);
  }
  function windBanner(show, msg, kind) {
    var b = el('windBanner');
    if (!show) { b.classList.remove('show'); return; }
    el('windTxt').textContent = msg; b.className = 'wind-banner show ' + (kind || 'alert');
  }
  function syncSafetyBtn() {
    var btn = el('btnSafety');
    btn.classList.toggle('on', G.safety);
    btn.textContent = G.safety ? '🛡️ Seguridad: ON' : '🛡️ Poner en seguridad';
  }

  /* ===================== ranking (localStorage) ===================== */
  var RKEY = 'solarTycoonRanking_v1';
  function loadRank() { try { return JSON.parse(localStorage.getItem(RKEY)) || []; } catch (_) { return []; } }
  function saveRank(arr) { try { localStorage.setItem(RKEY, JSON.stringify(arr.slice(0, 12))); } catch (_) {} }
  function addScore(rec) {
    var arr = loadRank(); arr.push(rec); arr.sort(function (a, b) { return b.score - a.score; });
    saveRank(arr); return arr;
  }
  function rankTable(arr, highlight) {
    if (!arr.length) return '<div class="muted">Aún no hay puntuaciones. ¡Sé el primero!</div>';
    var h = '<table class="rank"><tr><th>#</th><th>Equipo</th><th>Producción</th><th>Puntos</th></tr>';
    for (var i = 0; i < Math.min(arr.length, 8); i++) {
      var r = arr[i], me = (highlight && r === highlight) ? ' class="me"' : '';
      h += '<tr' + me + '><td>' + (i + 1) + '</td><td>' + escapeHtml(r.team) + '</td><td>' +
        (r.kwh >= 1000 ? fmt(r.kwh / 1000, 2) + ' MWh' : fmt(r.kwh, 0) + ' kWh') +
        '</td><td><b>' + fmt(r.score, 0) + '</b></td></tr>';
    }
    return h + '</table>';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }

  /* ===================== flujo de partida ===================== */
  function startGame(diffKey, team) {
    G = newGameState(diffKey, team);
    // reset escena
    for (var i = 0; i < trackers.length; i++) { var t = trackers[i]; t.failed = false; if (t.marker) { scene.remove(t.marker); t.marker = null; } }
    scheduleWinds(); syncSafetyBtn(); windBanner(false);
    el('start').classList.remove('show'); el('end').classList.remove('show');
    el('hud').classList.add('show'); el('actions').classList.add('show');
    G.running = true;
    toast('¡A producir, ' + team + '! El día va de ' + clockOf(H0) + ' a ' + clockOf(H1), 'info', 3200);
  }
  function finishGame() {
    if (G.finished) return; G.finished = true; G.running = false;
    el('hud').classList.remove('show'); el('actions').classList.remove('show');
    var rend = G.idealKWh > 0 ? clamp(G.realKWh / G.idealKWh * 100, 0, 100) : 100;
    var score = Math.max(0, Math.round(G.caja));
    var rec = { team: G.team, score: score, kwh: G.realKWh, perf: Math.round(rend), diff: G.diffKey, date: Date.now() };
    var arr = addScore(rec);
    var pos = arr.indexOf(rec) + 1;
    el('endStats').innerHTML =
      '<div class="big">' + fmtEur(score) + '</div><div class="muted">puntuación (caja final)</div>' +
      '<div class="grid2">' +
        kpi('Energía', G.realKWh >= 1000 ? fmt(G.realKWh / 1000, 2) + ' MWh' : fmt(G.realKWh, 0) + ' kWh') +
        kpi('Rendimiento', fmt(rend, 0) + '%') +
        kpi('Ingresos', fmtEur(G.ingresos)) +
        kpi('Costes O&M', fmtEur(G.costes)) +
      '</div>' +
      '<div class="pos">Puesto <b>#' + pos + '</b> · ' + DIFFS[G.diffKey].lbl + '</div>';
    el('endRank').innerHTML = rankTable(arr, rec);
    el('end').classList.add('show');
  }
  function kpi(l, v) { return '<div class="kpi"><div class="kl">' + l + '</div><div class="kv">' + v + '</div></div>'; }

  /* ===================== arranque ===================== */
  function init() {
    buildScene(el('cv'));
    requestAnimationFrame(loop);
    onResize(); window.addEventListener('resize', onResize);

    // ranking en la portada
    el('startRank').innerHTML = rankTable(loadRank());

    // selección de dificultad
    var picked = 'normal';
    Array.prototype.forEach.call(document.querySelectorAll('.diff'), function (b) {
      b.onclick = function () {
        picked = b.getAttribute('data-d');
        Array.prototype.forEach.call(document.querySelectorAll('.diff'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      };
    });
    el('btnPlay').onclick = function () {
      var team = (el('team').value || '').trim() || 'Equipo';
      startGame(picked, team);
    };
    el('btnAgain').onclick = function () { el('end').classList.remove('show'); el('start').classList.add('show'); el('startRank').innerHTML = rankTable(loadRank()); };
    el('btnSafety').onclick = function () {
      if (!G || !G.running) return;
      G.safety = !G.safety; G.safetyAuto = false; syncSafetyBtn();
    };
    el('btnPause').onclick = function () {
      if (!G) return; G.running = !G.running;
      el('btnPause').textContent = G.running ? '⏸' : '▶';
      if (!G.running) toast('Pausa', 'info', 1200);
    };
    el('tipClose').onclick = function () { el('tip').classList.remove('show'); };
  }
  function onResize() {
    var w = el('cv').clientWidth || window.innerWidth, h = el('cv').clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
