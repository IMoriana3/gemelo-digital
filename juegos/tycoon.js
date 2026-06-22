/* ============================================================================
 * Solar Tycoon — Operador de Planta  ·  v0.3 (simulador de temporada)
 * ----------------------------------------------------------------------------
 * Gestiona una PLANTA REAL (layout del SCADA: El Burgo / Páramo) a lo largo de
 * una temporada de varios días. Integra:
 *   · Planta real a escala (InstancedMesh, seguidores que bascula con el sol,
 *     coloreados por estado tipo SCADA: ok/warn/alarm).
 *   · Gestión en tiempo real: cuadrillas con desplazamiento, stock de repuestos,
 *     mantenimiento preventivo (desgaste), cola de averías.
 *   · Mercado + clima: precio €/MWh variable (curva de pato), previsión meteo,
 *     contrato de producción con bonus/penalización.
 *   · Campaña + economía: días encadenados, tienda entre días, progreso
 *     persistente (localStorage), ranking de temporada.
 *
 * Física solar real reutilizada del Gemelo (solarPos/trackAngle + backtracking).
 * No usa build: Three.js r128 (CDN) + ../seguidor.js (cotas) + ../plantas.js.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ===================== utilidades ===================== */
  var el = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function fmt(n, d) { return n.toFixed(d == null ? 0 : d).replace('.', ','); }
  function fmtE(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €'; }
  function fmtMWh(k) { return k >= 1000 ? fmt(k / 1000, 1) + ' MWh' : fmt(k, 0) + ' kWh'; }
  function clockOf(h) { var hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }

  /* ===================== física solar (espejo del Gemelo) ===================== */
  var AXIS_MAX = 55, CHORD = 2.382, PITCH = 6.0, GCR = CHORD / PITCH;
  var PLANT_LOC = { burgo: { lat: 41.576, lon: -0.798 }, paramo: { lat: 41.99, lon: -5.5 } };
  var LAT = 41.576 * D2R, LON = -0.798, dayN = 172, btOn = true;
  function declOf(N) { return 23.45 * Math.sin(2 * Math.PI * (284 + (N || 1)) / 365) * D2R; }
  function solarShift(N) {
    var LSTM = 15 * (1 + ((N >= 86 && N <= 303) ? 1 : 0)), B = 2 * Math.PI / 365 * ((N || 1) - 81);
    var EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    return (4 * (LON - LSTM) + EoT) / 60;
  }
  function solarPos(h) {
    var DECL = declOf(dayN), hs = h + solarShift(dayN), w = (hs - 12) * 15 * D2R;
    var sinEl = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(w);
    var elv = Math.asin(clamp(sinEl, -1, 1));
    var caz = (sinEl * Math.sin(LAT) - Math.sin(DECL)) / Math.max(1e-6, (Math.cos(elv) * Math.cos(LAT)));
    var az = Math.acos(clamp(caz, -1, 1)); if (w < 0) az = -az;
    return { el: elv, az: az };
  }
  function trackAngle(h) {
    var P = solarPos(h);
    if (P.el <= 0.0001) return { R: -5, el: P.el, cosAOI: 0, bt: false };
    var sx = Math.cos(P.el) * Math.sin(P.az), sz = Math.sin(P.el);
    var Rtrue = Math.atan2(sx, sz), temp = Math.min(1, (1 / GCR) * Math.cos(Rtrue));
    var Rbt = Rtrue - Math.sign(Rtrue) * Math.acos(temp);
    var Rsel = btOn ? Rbt : Rtrue, bt = btOn && Math.abs(Rbt) < Math.abs(Rtrue) - 1e-3;
    var Rdeg = clamp(Rsel * R2D, -AXIS_MAX, AXIS_MAX), Rr = Rdeg * D2R;
    return { R: Rdeg, el: P.el, cosAOI: Math.max(0, sx * Math.sin(Rr) + sz * Math.cos(Rr)), bt: bt };
  }

  /* ===================== catálogo de averías / repuestos ===================== */
  var FAULTS = {
    modulo:  { label: 'Módulo / string', icon: '▦', sev: 'warn', spare: 90,  prod: 0.5,  tracks: true,  repairT: 4, w: 26, sym: 'Módulo o string dañado: produce bastante menos.' },
    eje:     { label: 'Eje bloqueado',   icon: '⛔', sev: 'alarm', spare: 240, prod: 0.0,  tracks: false, repairT: 7, w: 15, sym: 'No gira: se queda clavado y pierde el sol.' },
    motor:   { label: 'Sobrecorriente motor', icon: '⚡', sev: 'warn', spare: 180, prod: 0.6, tracks: true, repairT: 5, w: 16, escalate: 'eje', escT: 16, sym: 'El motor fuerza. Si tarda, bloquea el eje (más caro).' },
    amort:   { label: 'Amortiguador',    icon: '✖', sev: 'warn', spare: 120, prod: 1.0,  tracks: true,  repairT: 5, w: 15, windRisk: true, sym: 'Sin amortiguación: con viento, daño estructural.' },
    tcu:     { label: 'TCU / comms',     icon: '📡', sev: 'alarm', spare: 300, prod: 0.12, tracks: false, repairT: 8, w: 11, sym: 'Unidad de control caída: sin telemetría ni seguimiento.' },
    bateria: { label: 'Batería',         icon: '🔋', sev: 'warn', spare: 110, prod: 0.35, tracks: false, repairT: 4, w: 12, selfHeal: true, sym: 'Sin energía para mover el seguidor. Se recupera con sol.' }
  };
  var FKEYS = Object.keys(FAULTS);
  function pickFault(weather) {
    // sesga según clima: viento->motor/amort, nublado/nieve->batería
    var wsum = 0, ws = {};
    FKEYS.forEach(function (k) {
      var x = FAULTS[k].w;
      if (weather === 'ventoso' && (k === 'motor' || k === 'amort')) x *= 2.2;
      if ((weather === 'nuboso' || weather === 'nieve') && k === 'bateria') x *= 2.4;
      ws[k] = x; wsum += x;
    });
    var r = Math.random() * wsum;
    for (var i = 0; i < FKEYS.length; i++) { r -= ws[FKEYS[i]]; if (r <= 0) return FKEYS[i]; }
    return FKEYS[0];
  }

  /* ===================== clima / mercado / dificultad ===================== */
  var WEATHER = {
    despejado: { label: 'Despejado', icon: '☀️', cloud: 0.10, winds: 0, soil: 0.02 },
    nuboso:    { label: 'Nuboso',    icon: '⛅', cloud: 0.50, winds: 1, soil: 0.03 },
    cubierto:  { label: 'Cubierto',  icon: '☁️', cloud: 0.78, winds: 1, soil: 0.04 },
    ventoso:   { label: 'Ventoso',   icon: '💨', cloud: 0.30, winds: 3, soil: 0.05 },
    nieve:     { label: 'Nieve',     icon: '❄️', cloud: 0.65, winds: 1, soil: 0.16 }
  };
  var WKEYS = Object.keys(WEATHER);
  function priceAt(h) {
    var base = 48;
    var morn = 16 * Math.exp(-Math.pow((h - 8.5) / 1.7, 2));
    var dip = -24 * Math.exp(-Math.pow((h - 14) / 2.6, 2));
    var eve = 78 * Math.exp(-Math.pow((h - 20.5) / 1.9, 2));
    return Math.max(10, base + morn + dip + eve);
  }
  var DAY_DUR = 135, H0 = 5, H1 = 21, SEASON_DAYS = 5;
  var PNOM_T = 40;                 // kWp por seguidor
  var CREW_SPEED = 55;            // m/s sim
  var SHOP = {
    crew:  { name: 'Contratar cuadrilla', icon: '👷', desc: 'Otra cuadrilla para reparar en paralelo.', base: 4500 },
    spares:{ name: 'Pack de repuestos', icon: '📦', desc: '+2 de cada componente al almacén.', base: 1400 },
    rel:   { name: 'Mejora de fiabilidad', icon: '🛡️', desc: '−18% probabilidad de avería (acumulable).', base: 2600, max: 4 },
    batt:  { name: 'Baterías mejores', icon: '🔋', desc: 'Menos fallos de batería y mejor con poca luz.', base: 2200, max: 3 },
    ins:   { name: 'Seguro de viento', icon: '🌪️', desc: '−30% penalización por daños de viento.', base: 1900, max: 3 },
    clean: { name: 'Servicio de limpieza', icon: '🧽', desc: '−40% pérdidas por suciedad/nieve.', base: 1600, max: 3 }
  };

  /* ===================== estado de campaña (persistente) ===================== */
  var CKEY = 'solarTycoonCampaign_v2', RKEY = 'solarTycoonSeasonRank_v2';
  var C = null;   // campaña
  function newCampaign(team, plantKey) {
    var weather = [];
    for (var d = 0; d < SEASON_DAYS; d++) {
      // un día de viento garantizado a media temporada, resto variado
      weather.push(d === 2 ? 'ventoso' : WKEYS[(Math.random() * WKEYS.length) | 0]);
    }
    return {
      team: team || 'Equipo', plant: plantKey || 'burgo', day: 1, days: SEASON_DAYS,
      caja: 9000,
      crews: 1, spares: { modulo: 3, eje: 1, motor: 2, amort: 2, tcu: 1, bateria: 3 },
      rel: 0, batt: 0, ins: 0, clean: 0,
      weather: weather, totalKWh: 0, totalRev: 0, totalPen: 0, contractsMet: 0
    };
  }
  function saveCamp() { try { localStorage.setItem(CKEY, JSON.stringify(C)); } catch (_) {} }
  function loadCamp() { try { return JSON.parse(localStorage.getItem(CKEY)); } catch (_) { return null; } }
  function loadRank() { try { return JSON.parse(localStorage.getItem(RKEY)) || []; } catch (_) { return []; } }
  function addRank(rec) { var a = loadRank(); a.push(rec); a.sort(function (x, y) { return y.score - x.score; }); a = a.slice(0, 12); try { localStorage.setItem(RKEY, JSON.stringify(a)); } catch (_) {} return a; }

  /* ===================== runtime del día ===================== */
  var DAY = null, trackers = [], crews = [];

  /* ===================== Three.js ===================== */
  var THREE = window.THREE;
  var renderer, scene, camera, sun, sunSprite, field, ground, HERO = [];
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  var dummy, COL = {}, GLOW = null, _faultTex = {};
  var SKY_NIGHT = new THREE.Color(0x0a1422), SKY_DUSK = new THREE.Color(0x8a5236), SKY_DAY = new THREE.Color(0x6f93b8), SKY_OVC = new THREE.Color(0x8a929b);
  var view = { theta: 0.85, phi: 0.7, radius: 600, tx: 0, tz: 0 };
  var _sx = 0, _sz = 0, _irr = 0, _skyT = 1, _trk = { R: 0, cosAOI: 0, el: 0, bt: false }, _soil = 0;

  function glowTex() {
    var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  function faultTexFor(key) {
    if (_faultTex[key]) return _faultTex[key];
    var f = FAULTS[key], col = f.sev === 'alarm' ? '#e2574c' : '#e0a52b';
    var c = document.createElement('canvas'); c.width = c.height = 96; var x = c.getContext('2d');
    x.fillStyle = col; x.beginPath(); x.arc(48, 48, 40, 0, 6.2832); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 6; x.stroke();
    x.fillStyle = '#fff'; x.font = '46px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(f.icon, 48, 54);
    return (_faultTex[key] = new THREE.CanvasTexture(c));
  }
  function sprite(map, color, size) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: map, color: color, transparent: true, depthWrite: false }));
    s.scale.set(size, size, 1); return s;
  }

  function buildScene(wrap) {
    scene = new THREE.Scene(); scene.background = SKY_DAY.clone();
    scene.fog = new THREE.Fog(0x9fb3c4, 700, 2200);
    camera = new THREE.PerspectiveCamera(48, 1, 1, 6000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);
    dummy = new THREE.Object3D();

    scene.add(new THREE.AmbientLight(0x4a5e72, 0.8));
    scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x47502f, 0.5));
    sun = new THREE.DirectionalLight(0xfff2d8, 1.0); scene.add(sun); scene.add(sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    GLOW = glowTex(); sunSprite = sprite(GLOW, 0xffe6a0, 90); scene.add(sunSprite);

    COL.ok = new THREE.Color(0x37b87c); COL.warn = new THREE.Color(0xe0a52b);
    COL.alarm = new THREE.Color(0xe2574c); COL.work = new THREE.Color(0x3aa0ff);
    COL.safe = new THREE.Color(0x8aa0b4);

    bindCamera(renderer.domElement);
  }

  function grassTex() {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    x.fillStyle = '#3c6b2c'; x.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 5000; i++) { var gx = Math.random() * 256, gy = Math.random() * 256, l = 2 + Math.random() * 7, dx = (Math.random() - 0.5) * 3; x.strokeStyle = 'hsl(' + (92 + Math.random() * 34) + ',' + (40 + Math.random() * 25) + '%,' + (20 + Math.random() * 34) + '%)'; x.lineWidth = 0.8 + Math.random() * 1.1; x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + dx, gy - l); x.stroke(); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function panelTexT() {
    var W = 96, H = 192, c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    x.fillStyle = '#0a1019'; x.fillRect(0, 0, W, H); var nx = 6, ny = 12, cw = W / nx, ch = H / ny, g = 1.3;
    for (var iy = 0; iy < ny; iy++) for (var ix = 0; ix < nx; ix++) { x.fillStyle = 'hsl(214,48%,' + (7.5 + Math.random() * 3.5).toFixed(1) + '%)'; x.fillRect(ix * cw + g, iy * ch + g, cw - 2 * g, ch - 2 * g); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  // fila de seguidores con render DETALLADO (gemelo) en primer plano, para el "wow"
  function buildHero(P) {
    for (var h = 0; h < HERO.length; h++) HERO[h].objs.forEach(function (o) { scene.remove(o); });
    HERO = [];
    if (typeof Seguidor === 'undefined') return;
    var SGh = Seguidor.materials(THREE), pt = panelTexT();
    SGh.glass.map = pt; SGh.glass.emissiveMap = pt; SGh.glass.emissive = new THREE.Color(0x2b333d); SGh.glass.emissiveIntensity = 0.3; SGh.glass.needsUpdate = true;
    var steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ac, roughness: 0.45, metalness: 0.65 });
    var heroZ = P.h / 2 + 48, xs = [-58, 0, 58];
    for (var k = 0; k < xs.length; k++) {
      var beam = Seguidor.buildBeam(THREE, { west: true, materials: SGh, detail: 'full', skip: { soporte: 1, bracket: 1, antena: 1, antenatip: 1 } });
      var wrap = new THREE.Group(); wrap.position.set(xs[k], 2, heroZ); wrap.rotation.y = -Math.PI / 2; wrap.add(beam.spin); scene.add(wrap);
      var slewG = new THREE.Group(); slewG.position.set(xs[k], 2, heroZ); slewG.rotation.y = -Math.PI / 2; slewG.add(beam.static); scene.add(slewG);
      var objs = [wrap, slewG];
      for (var px = -28; px <= 28; px += 9) { var col = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2, 0.13), steel); col.position.set(xs[k], 1, heroZ + px); col.castShadow = true; scene.add(col); objs.push(col); }
      HERO.push({ spin: beam.spin, objs: objs });
    }
  }

  function loadPlant(key) {
    var P = (window.PLANTAS && window.PLANTAS[key]) || window.PLANTAS.burgo;
    var loc = PLANT_LOC[key] || PLANT_LOC.burgo; LAT = loc.lat * D2R; LON = loc.lon;
    // limpiar campo previo (marcadores, malla, suelo)
    for (var q = 0; q < trackers.length; q++) if (trackers[q].marker) scene.remove(trackers[q].marker);
    if (field) { scene.remove(field); field.geometry.dispose(); field = null; }
    if (ground) { scene.remove(ground); ground = null; }
    trackers = [];
    var N = P.trackers.length;
    // suelo
    var gw = Math.max(P.w, P.h) * 1.4;
    var gtex = grassTex(); gtex.repeat.set(Math.max(40, gw / 6), Math.max(40, gw / 6));
    ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gw), new THREE.MeshStandardMaterial({ map: gtex, color: 0xc2d0b2, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = true; scene.add(ground);
    // sombra del sol cubre el campo
    var shc = sun.shadow.camera; var hw = Math.max(P.w, P.h) * 0.62;
    shc.left = -hw; shc.right = hw; shc.top = hw; shc.bottom = -hw; shc.near = 1; shc.far = 3000; shc.updateProjectionMatrix(); sun.shadow.bias = -0.0008;
    // mesa: caja larga N-S (eje Z), cuerda E-O (eje X)
    var geo = new THREE.BoxGeometry(4.4, 0.18, 52);
    var mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1, vertexColors: false });
    field = new THREE.InstancedMesh(geo, mat, N);
    field.castShadow = true; field.receiveShadow = true;
    field.frustumCulled = false;
    field.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(field);
    for (var i = 0; i < N; i++) {
      var t = P.trackers[i];
      trackers.push({
        i: i, wx: t.x, wz: t.y, ncu: t.ncu, name: t.name,
        angle: 0, fault: null, faultT: 0, healT: 0, wear: 0.05 + Math.random() * 0.1,
        assigned: -1, frozen: 0, marker: null
      });
      field.setColorAt(i, COL.ok);
    }
    field.instanceColor.needsUpdate = true;
    buildHero(P);
    // encuadre de cámara
    view.radius = Math.max(P.w, P.h) * 0.95; view.tx = 0; view.tz = 0; view.theta = 0.85; view.phi = 0.72;
    applyCam();
  }

  function sunWorldDir(h) { var P = solarPos(h); return new THREE.Vector3(Math.cos(P.el) * Math.sin(P.az), Math.sin(P.el), -Math.cos(P.el) * Math.cos(P.az)); }

  /* ===================== cámara: órbita + pan + zoom + tap ===================== */
  function applyCam() {
    var sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    camera.position.set(view.tx + view.radius * sp * Math.sin(view.theta), view.radius * cp, view.tz + view.radius * sp * Math.cos(view.theta));
    camera.lookAt(view.tx, 0, view.tz);
  }
  function bindCamera(dom) {
    var ptrs = {}, down = null, pinchD = 0, mode = null;
    dom.style.touchAction = 'none';
    function npt() { return Object.keys(ptrs).length; }
    function pdist() { var k = Object.keys(ptrs); if (k.length < 2) return 0; var a = ptrs[k[0]], b = ptrs[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    function pmid() { var k = Object.keys(ptrs); var a = ptrs[k[0]], b = ptrs[k[1]]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    var lastMid = null;
    function panBy(dx, dy) {
      var s = view.radius * 0.0016;
      var ang = view.theta;
      view.tx -= (dx * Math.cos(ang) - dy * Math.sin(ang)) * s;
      view.tz -= (dx * Math.sin(ang) + dy * Math.cos(ang)) * s;
      applyCam();
    }
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    dom.addEventListener('pointerdown', function (e) {
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { dom.setPointerCapture(e.pointerId); } catch (_) {}
      if (npt() === 1) { down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rot'; }
      else if (npt() === 2) { down = null; mode = 'multi'; pinchD = pdist(); lastMid = pmid(); }
    });
    dom.addEventListener('pointermove', function (e) {
      var prev = ptrs[e.pointerId]; if (!prev) return;
      var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (mode === 'multi' && npt() >= 2) {
        var d = pdist(); if (pinchD > 0 && d > 0) view.radius = clamp(view.radius * pinchD / d, 80, 1600); pinchD = d;
        var m = pmid(); if (lastMid) panBy(m.x - lastMid.x, m.y - lastMid.y); lastMid = m; applyCam(); return;
      }
      if (down && (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 9)) down.moved = true;
      if (mode === 'pan') panBy(dx, dy);
      else { view.theta -= dx * 0.005; view.phi = clamp(view.phi - dy * 0.005, 0.18, 1.4); applyCam(); }
    });
    function endp(e) {
      var single = npt() === 1;
      if (down && !down.moved && single && (performance.now() - down.t) < 450) handleTap(down.x, down.y);
      delete ptrs[e.pointerId]; try { dom.releasePointerCapture(e.pointerId); } catch (_) {}
      if (npt() === 0) { down = null; mode = null; pinchD = 0; lastMid = null; }
    }
    dom.addEventListener('pointerup', endp); dom.addEventListener('pointercancel', endp);
    dom.addEventListener('wheel', function (e) { e.preventDefault(); view.radius = clamp(view.radius * (1 + Math.sign(e.deltaY) * 0.1), 80, 1600); applyCam(); }, { passive: false });
  }
  function handleTap(cx, cy) {
    if (!DAY || !DAY.running || !field) return;
    var r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((cx - r.left) / r.width) * 2 - 1; ndc.y = -((cy - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    var hit = ray.intersectObject(field, false);
    if (hit.length && hit[0].instanceId != null) openTracker(hit[0].instanceId);
  }

  /* ===================== producción ===================== */
  function trackerKW(t) {
    var pf = t.fault ? FAULTS[t.fault].prod : 1; if (pf <= 0) return 0;
    var sf = DAY.safety ? 0.05 : 1;
    var cosAOI = Math.max(0, _sx * Math.sin(t.angle) + _sz * Math.cos(t.angle));
    return PNOM_T * _irr * _skyT * (1 - _soil) * cosAOI * pf * sf;
  }
  function health(t) {
    if (t.assigned >= 0) return 'work';
    if (!t.fault) return DAY.safety ? 'safe' : 'ok';
    return FAULTS[t.fault].sev === 'alarm' ? 'alarm' : 'warn';
  }

  /* ===================== averías ===================== */
  function setFault(t, key, silent) {
    if (t.fault) return; var f = FAULTS[key];
    t.fault = key; t.faultT = 0; t.healT = 0; if (!f.tracks) t.frozen = t.angle;
    if (!t.marker) { t.marker = sprite(faultTexFor(key), 0xffffff, 24); t.marker.userData.p = Math.random() * 6.28; scene.add(t.marker); }
    else t.marker.material.map = faultTexFor(key);
    t.marker.visible = true;
    if (!silent) toast((f.sev === 'alarm' ? '⛔' : '⚠') + ' ' + t.name + ': ' + f.label, 'warn');
    refreshFaultList();
  }
  function clearFaultObj(t) {
    t.fault = null; t.faultT = 0; t.healT = 0;
    if (t.marker) { t.marker.visible = false; }
    refreshFaultList();
  }
  function spawnFault() {
    var pool = []; for (var i = 0; i < trackers.length; i++) { var t = trackers[i]; if (!t.fault && t.assigned < 0) pool.push(t); }
    if (!pool.length) return;
    // probabilidad ponderada por desgaste
    var tot = 0, k; for (k = 0; k < pool.length; k++) tot += (0.2 + pool[k].wear);
    var r = Math.random() * tot, sel = pool[0];
    for (k = 0; k < pool.length; k++) { r -= (0.2 + pool[k].wear); if (r <= 0) { sel = pool[k]; break; } }
    setFault(sel, pickFault(DAY.weather.key));
    sel.wear = 0.05;
  }

  /* ===================== cuadrillas ===================== */
  function initCrews() {
    for (var q = 0; q < crews.length; q++) if (crews[q].spr) scene.remove(crews[q].spr);
    crews = [];
    for (var i = 0; i < C.crews; i++) crews.push({ id: i, state: 'idle', x: 0, z: 0, tx: 0, tz: 0, timer: 0, target: -1, mode: null, spr: crewSprite(i) });
    refreshCrews();
  }
  function crewSprite(i) {
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    x.fillStyle = '#3aa0ff'; x.beginPath(); x.arc(32, 32, 26, 0, 6.28); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 4; x.stroke();
    x.font = '30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('👷', 32, 36);
    var s = sprite(new THREE.CanvasTexture(c), 0xffffff, 16); s.position.set(0, 8, 0); scene.add(s); return s;
  }
  function freeCrew() { for (var i = 0; i < crews.length; i++) if (crews[i].state === 'idle') return crews[i]; return null; }
  function dispatch(t, mode) {
    var cw = freeCrew(); if (!cw) { toast('No hay cuadrillas libres', 'warn'); return false; }
    if (mode === 'repair') {
      var key = t.fault; if (!key) return false;
      if ((C.spares[key] | 0) <= 0) { toast('Sin repuesto de ' + FAULTS[key].label + ' — cómpralo', 'warn'); return false; }
      C.spares[key]--; refreshSpares();
    }
    cw.state = 'travel'; cw.target = t.i; cw.mode = mode; cw.tx = t.wx; cw.tz = t.wz; cw.sx = cw.x; cw.sz = cw.z;
    var dist = Math.hypot(cw.x - t.wx, cw.z - t.wz); cw.timer = Math.max(0.5, dist / CREW_SPEED); cw.travel = cw.timer;
    t.assigned = cw.id; updateInstanceColor(t);
    refreshCrews(); refreshFaultList();
    return true;
  }
  function crewArrive(cw) {
    var t = trackers[cw.target];
    cw.x = cw.tx; cw.z = cw.tz; cw.state = 'work';
    cw.timer = cw.mode === 'repair' ? FAULTS[t.fault].repairT : 3.0;
  }
  function crewFinish(cw) {
    var t = trackers[cw.target];
    if (cw.mode === 'repair') { clearFaultObj(t); toast('🔧 ' + t.name + ' reparado', 'ok'); }
    else { t.wear = 0; toast('🧰 ' + t.name + ': mantenimiento hecho', 'ok'); }
    t.assigned = -1; updateInstanceColor(t);
    cw.state = 'idle'; cw.target = -1; cw.mode = null;
    refreshCrews();
  }
  function updateCrews(dt) {
    for (var i = 0; i < crews.length; i++) {
      var cw = crews[i]; if (cw.state === 'idle') { cw.spr.visible = false; continue; }
      cw.spr.visible = true; cw.timer -= dt;
      if (cw.state === 'travel') {
        var f = clamp(1 - cw.timer / cw.travel, 0, 1);
        cw.spr.position.set(cw.sx + (cw.tx - cw.sx) * f, 8, cw.sz + (cw.tz - cw.sz) * f);
        if (cw.timer <= 0) crewArrive(cw);
      } else if (cw.state === 'work') {
        cw.spr.position.set(cw.tx, 8 + Math.sin(performance.now() * 0.006) * 1.5, cw.tz);
        if (cw.timer <= 0) crewFinish(cw);
      }
    }
  }

  /* ===================== viento ===================== */
  var WARN_S = 6, GUST_S = 7;
  function scheduleWinds() {
    DAY.windQueue = []; var n = DAY.weather.winds;
    for (var i = 0; i < n; i++) DAY.windQueue.push({ at: clamp(0.22 + (i + Math.random() * 0.5) * (0.62 / Math.max(1, n)), 0.15, 0.9), done: false });
  }
  function onGust() {
    var struct = [];
    for (var i = 0; i < trackers.length; i++) if (trackers[i].fault === 'amort') {
      var pen = 220 * (1 - 0.3 * C.ins); C.caja -= pen; DAY.costs += pen;
      clearFaultObj(trackers[i]); trackers[i].assigned = -1; setFault(trackers[i], 'eje', true); updateInstanceColor(trackers[i]); struct.push(trackers[i].name);
    }
    if (struct.length) toast('🌪️ Daño estructural (amortiguador) en ' + struct.length + ' seguidor(es)', 'warn');
    if (!DAY.safety) {
      var p = (350 + 90 * (C.day)) * (1 - 0.3 * C.ins); C.caja -= p; DAY.costs += p;
      var n = 2 + ((Math.random() * 3) | 0);
      for (var k = 0; k < n; k++) { var pool = trackers.filter(function (t) { return !t.fault && t.assigned < 0; }); if (pool.length) setFault(pool[(Math.random() * pool.length) | 0], pickFault('ventoso'), true); }
      windBanner(true, '🌪️ ¡DAÑOS POR VIENTO! −' + fmtE(p), 'bad'); toast('No pusiste seguridad a tiempo', 'warn');
    } else { DAY.safetyAuto = true; windBanner(true, '🛡️ Planta protegida', 'ok'); }
    refreshSpares();
  }
  function updateWind(dt, frac) {
    if (DAY.windState === 'idle') {
      for (var i = 0; i < DAY.windQueue.length; i++) { var w = DAY.windQueue[i]; if (!w.done && frac >= w.at) { w.done = true; DAY.windState = 'warning'; DAY.windTimer = WARN_S; windBanner(true, '💨 ¡VIENTO FUERTE! Pon SEGURIDAD (y revisa amortiguadores)'); tip('viento', 'Pon la planta en seguridad antes de la racha. Un amortiguador roto se daña aunque pongas seguridad: repáralo antes.'); break; } }
    } else if (DAY.windState === 'warning') { DAY.windTimer -= dt; if (DAY.windTimer <= 0) { DAY.windState = 'gust'; DAY.windTimer = GUST_S; onGust(); } }
    else if (DAY.windState === 'gust') { DAY.windTimer -= dt; if (DAY.windTimer <= 0) { DAY.windState = 'idle'; windBanner(false); if (DAY.safetyAuto) { DAY.safety = false; DAY.safetyAuto = false; syncSafety(); } } }
  }

  /* ===================== bucle ===================== */
  var lastNow = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0; lastNow = now;
    if (DAY && DAY.running) step(dt);
    if (renderer) renderer.render(scene, camera);
  }
  function step(dt) {
    DAY.t += dt; var frac = clamp(DAY.t / DAY_DUR, 0, 1);
    DAY.h = H0 + (H1 - H0) * frac; var dH = (H1 - H0) * dt / DAY_DUR;

    // sol
    var P = solarPos(DAY.h); _trk = trackAngle(DAY.h);
    _sx = Math.cos(P.el) * Math.sin(P.az); _sz = Math.max(0, Math.sin(P.el)); _irr = Math.max(0, Math.sin(Math.max(0, P.el)));
    var dir = sunWorldDir(DAY.h);
    sun.position.set(dir.x * 1200, Math.max(40, dir.y * 1200), dir.z * 1200); sun.target.position.set(0, 0, 0);
    sun.intensity = 0.15 + clamp(Math.sin(Math.max(0, P.el)) * 1.4, 0, 1) * 0.95;
    sunSprite.position.set(dir.x * 1500, Math.max(30, dir.y * 1500), dir.z * 1500); sunSprite.material.opacity = P.el > -0.05 ? 1 : 0;

    // nubes + suciedad
    DAY.cloudTimer -= dt; if (DAY.cloudTimer <= 0) { DAY.cloudTimer = 2.5 + Math.random() * 4; DAY.cloudTarget = Math.max(0, DAY.weather.cloud + (Math.random() - 0.5) * 0.3); }
    DAY.cloud += (DAY.cloudTarget - DAY.cloud) * Math.min(1, dt * 0.5);
    _skyT = clamp(1 - DAY.cloud * 0.8, 0.12, 1);
    _soil = clamp(DAY.weather.soil * (1 - 0.4 * C.clean), 0, 0.6);

    // cielo
    var col = new THREE.Color();
    if (P.el <= 0) col.copy(SKY_NIGHT); else { var kk = clamp(Math.sin(P.el) * 1.6, 0, 1); col.copy(SKY_DUSK).lerp(SKY_DAY, kk); }
    col.lerp(SKY_OVC, (1 - _skyT) * 0.7); scene.background.copy(col); if (scene.fog) scene.fog.color.copy(col);

    // seguidores: ángulo + desgaste + timers + matriz + color
    var baseR = _trk.R * D2R, realKW = 0;
    for (var hh = 0; hh < HERO.length; hh++) HERO[hh].spin.rotation.x = baseR;
    for (var i = 0; i < trackers.length; i++) {
      var t = trackers[i], f = t.fault ? FAULTS[t.fault] : null;
      var tgt = (f && !f.tracks) ? t.frozen : (DAY.safety ? 0 : baseR);
      t.angle += (tgt - t.angle) * Math.min(1, dt * 3.0);
      // desgaste
      if (!t.fault && t.assigned < 0) t.wear = Math.min(1, t.wear + dt * DAY.wearRate);
      // timers de avería
      if (f) {
        t.faultT += dt;
        if (f.escalate && t.assigned < 0 && t.faultT >= f.escT) { clearFaultObj(t); setFault(t, f.escalate, true); }
        else if (f.selfHeal && _irr * _skyT > 0.5) { t.healT += dt; if (t.healT > 8) { clearFaultObj(t); } }
      }
      // matriz instanciada (rotación sobre Z = basculación E-O)
      dummy.position.set(t.wx, 2.2, t.wz); dummy.rotation.set(0, 0, t.angle); dummy.updateMatrix();
      field.setMatrixAt(i, dummy.matrix);
      updateInstanceColor(t);
      if (t.marker && t.marker.visible) { t.marker.position.set(t.wx, 7, t.wz); t.marker.userData.p += dt * 5; t.marker.scale.setScalar(22 + Math.sin(t.marker.userData.p) * 4); }
      realKW += trackerKW(t);
    }
    field.instanceMatrix.needsUpdate = true; field.instanceColor.needsUpdate = true;

    // economía con MERCADO
    DAY.price = priceAt(DAY.h);
    var mwh = realKW * dH / 1000; DAY.kWh += realKW * dH;
    var rev = mwh * DAY.price; DAY.rev += rev; C.caja += rev;
    var idealKW = PNOM_T * _irr * _skyT * (1 - _soil) * _trk.cosAOI * trackers.length;
    DAY.idealKWh += idealKW * dH; DAY.kW = realKW;

    // averías periódicas
    DAY.failTimer -= dt; if (DAY.failTimer <= 0) { DAY.failTimer = DAY.failMean * (0.6 + Math.random() * 0.9); spawnFault(); }
    // crews + viento
    updateCrews(dt); updateWind(dt, frac);
    if (_trk.bt && DAY.h < 9) tip('bt', 'Al amanecer el backtracking evita sombras entre filas.');

    updateHUD(frac);
    if (frac >= 1) endDay();
  }

  function updateInstanceColor(t) {
    if (!field) return; var h = health(t);
    field.setColorAt(t.i, COL[h] || COL.ok);
  }

  /* ===================== HUD ===================== */
  function updateHUD(frac) {
    el('hDay').textContent = 'Día ' + C.day + '/' + C.days;
    el('hClock').textContent = clockOf(DAY.h);
    el('hPrice').textContent = fmt(DAY.price, 0) + ' €/MWh';
    el('hPrice').style.color = DAY.price > 90 ? 'var(--accent)' : (DAY.price < 35 ? 'var(--warn)' : 'var(--tx)');
    el('hProd').textContent = fmtMWh(DAY.kWh);
    el('hCash').textContent = fmtE(C.caja);
    el('hPow').textContent = fmt(DAY.kW, 0) + ' kW';
    var nf = 0; for (var i = 0; i < trackers.length; i++) if (trackers[i].fault) nf++;
    el('btnFaults').textContent = '⚠ ' + nf;
    el('btnFaults').style.color = nf ? 'var(--danger)' : 'var(--tx2)';
    // contrato
    var pct = clamp(DAY.kWh / 1000 / DAY.contract * 100, 0, 100);
    el('cBar').style.width = pct + '%';
    el('cTxt').textContent = fmt(DAY.kWh / 1000, 1) + ' / ' + fmt(DAY.contract, 0) + ' MWh';
    el('cBar').style.background = pct >= 100 ? 'var(--accent)' : 'var(--sun)';
    el('dayBar').style.width = (frac * 100).toFixed(1) + '%';
  }

  /* ===================== popup de seguidor ===================== */
  var popI = -1;
  function openTracker(i) {
    popI = i; var t = trackers[i];
    var ncuTxt = 'NCU-' + (('' + t.ncu).padStart ? ('' + t.ncu).padStart(2, '0') : t.ncu);
    el('fpTitle').textContent = t.name + ' · ' + ncuTxt;
    var html = '';
    if (t.fault) {
      var f = FAULTS[t.fault];
      el('fpIcon').textContent = f.icon; el('fpIcon').style.background = f.sev === 'alarm' ? 'var(--danger)' : 'var(--warn)';
      html += '<div class="fr"><b>' + f.label + '</b></div><div class="fsym">' + f.sym + '</div>';
      html += '<div class="fmeta">Repuesto en stock: <b>' + (C.spares[t.fault] | 0) + '</b> · coste ' + fmtE(f.spare) + '</div>';
      if (t.assigned >= 0) html += '<div class="fmeta" style="color:var(--blue)">🚐 Cuadrilla en camino…</div>';
    } else {
      el('fpIcon').textContent = '✓'; el('fpIcon').style.background = 'var(--ok)';
      html += '<div class="fr"><b>Operativo</b></div>';
      html += '<div class="fmeta">Desgaste: ' + fmt(t.wear * 100, 0) + '% · ' + fmt(trackerKW(t), 1) + ' kW</div>';
      if (t.assigned >= 0) html += '<div class="fmeta" style="color:var(--blue)">🚐 Mantenimiento en curso…</div>';
    }
    el('fpBody').innerHTML = html;
    // acciones
    var acts = '';
    if (t.fault && t.assigned < 0) {
      var f2 = FAULTS[t.fault], hasSpare = (C.spares[t.fault] | 0) > 0;
      if (hasSpare) acts += '<button class="rep" data-a="repair">🔧 Enviar cuadrilla</button>';
      else acts += '<button class="rep" data-a="buy">📦 Comprar repuesto ' + fmtE(Math.round(f2.spare * 2.2)) + '</button>';
    } else if (!t.fault && t.assigned < 0) {
      acts += '<button class="rep alt" data-a="prevent">🧰 Mantenimiento preventivo</button>';
    }
    acts += '<button class="cl" data-a="close">Cerrar</button>';
    el('fpActs').innerHTML = acts;
    Array.prototype.forEach.call(el('fpActs').querySelectorAll('button'), function (b) { b.onclick = function () { trackerAction(b.getAttribute('data-a')); }; });
    el('fpop').classList.add('show');
  }
  function closeTracker() { el('fpop').classList.remove('show'); popI = -1; }
  function trackerAction(a) {
    if (popI < 0) { closeTracker(); return; } var t = trackers[popI];
    if (a === 'repair') { if (dispatch(t, 'repair')) closeTracker(); }
    else if (a === 'prevent') { if (dispatch(t, 'prevent')) closeTracker(); }
    else if (a === 'buy') {
      var f = FAULTS[t.fault], price = Math.round(f.spare * 2.2);
      if (C.caja < price) { toast('Sin caja para el repuesto urgente', 'warn'); return; }
      C.caja -= price; DAY.costs += price; C.spares[t.fault] = (C.spares[t.fault] | 0) + 1; refreshSpares();
      toast('📦 Repuesto urgente de ' + f.label + ' comprado', 'ok'); openTracker(popI);
    } else closeTracker();
  }

  /* ===================== paneles laterales ===================== */
  function refreshCrews() {
    var busy = 0; for (var i = 0; i < crews.length; i++) if (crews[i].state !== 'idle') busy++;
    el('crewBox').innerHTML = '👷 Cuadrillas: <b>' + (crews.length - busy) + '</b>/' + crews.length + ' libres';
  }
  function refreshSpares() {
    var h = '📦 ';
    FKEYS.forEach(function (k) { h += '<span class="sp" title="' + FAULTS[k].label + '">' + FAULTS[k].icon + ' ' + (C.spares[k] | 0) + '</span>'; });
    el('spareBox').innerHTML = h;
  }
  function refreshFaultList() {
    if (!el('faultList').classList.contains('show')) return;
    var act = []; for (var i = 0; i < trackers.length; i++) if (trackers[i].fault) act.push(trackers[i]);
    if (!act.length) { el('flBox').innerHTML = '<div class="muted">Sin averías ✓</div>'; return; }
    act.sort(function (a, b) { return (FAULTS[b.fault].sev === 'alarm') - (FAULTS[a.fault].sev === 'alarm'); });
    var h = '';
    act.forEach(function (t) {
      var f = FAULTS[t.fault];
      h += '<div class="fli" data-i="' + t.i + '"><span class="fle ' + f.sev + '">' + f.icon + '</span><span class="fln">' + t.name + '<small>' + f.label + (t.assigned >= 0 ? ' · 🚐' : '') + '</small></span></div>';
    });
    el('flBox').innerHTML = h;
    Array.prototype.forEach.call(el('flBox').querySelectorAll('.fli'), function (d) { d.onclick = function () { focusTracker(+d.getAttribute('data-i')); }; });
  }
  function focusTracker(i) { var t = trackers[i]; view.tx = t.wx; view.tz = t.wz; view.radius = Math.max(140, view.radius * 0.6); applyCam(); openTracker(i); }

  /* ===================== toasts / consejos / banners ===================== */
  var toastT = null;
  function toast(msg, kind, ms) { var t = el('toast'); t.textContent = msg; t.className = 'toast show ' + (kind || 'info'); clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, ms || 2500); }
  function tip(key, msg) { if (!DAY || DAY.tips[key]) return; DAY.tips[key] = true; el('tipTxt').textContent = msg; el('tip').classList.add('show'); setTimeout(function () { el('tip').classList.remove('show'); }, 6800); }
  function windBanner(show, msg, kind) { var b = el('windBanner'); if (!show) { b.classList.remove('show'); return; } el('windTxt').textContent = msg; b.className = 'wind-banner show ' + (kind || 'alert'); }
  function syncSafety() { var b = el('btnSafety'); b.classList.toggle('on', DAY.safety); b.textContent = DAY.safety ? '🛡️ Seguridad: ON' : '🛡️ Seguridad'; }

  /* ===================== flujo de día / temporada ===================== */
  function dayContract(wKey) {
    // objetivo ~ producción realista del día según clima (MWh)
    var capMWh = trackers.length * PNOM_T / 1000;   // MWp
    var sun = { despejado: 6.7, nuboso: 4.6, cubierto: 3.2, ventoso: 6.0, nieve: 3.6 }[wKey] || 5.5;
    return +(capMWh * sun * 0.82).toFixed(0);
  }
  function startDay() {
    var wKey = C.weather[C.day - 1] || 'despejado';
    dayN = 150 + C.day * 6;   // avanza un poco en el año
    DAY = {
      running: true, t: 0, h: H0, weather: { key: wKey, label: WEATHER[wKey].label, icon: WEATHER[wKey].icon, cloud: WEATHER[wKey].cloud, winds: WEATHER[wKey].winds, soil: WEATHER[wKey].soil },
      kWh: 0, idealKWh: 0, rev: 0, costs: 0, kW: 0, price: priceAt(H0),
      contract: dayContract(wKey),
      cloud: WEATHER[wKey].cloud, cloudTarget: WEATHER[wKey].cloud, cloudTimer: 0,
      failMean: Math.max(2.6, (5.5 - C.day * 0.3) * (1 - 0.18 * C.rel)),
      wearRate: 0.012 * (1 - 0.18 * C.rel),
      failTimer: 4, windQueue: [], windState: 'idle', windTimer: 0, safety: false, safetyAuto: false, tips: {}
    };
    initCrews(); scheduleWinds(); syncSafety(); windBanner(false); closeTracker();
    // resetea seguidores del día
    for (var i = 0; i < trackers.length; i++) { var t = trackers[i]; clearFaultObj(t); t.assigned = -1; t.angle = 0; t.wear = 0.05 + Math.random() * 0.12; }
    refreshSpares(); refreshCrews();
    el('brief').classList.remove('show'); el('hud').classList.add('show'); el('actions').classList.add('show'); el('side').classList.add('show');
    toast('☀ ' + DAY.weather.icon + ' Día ' + C.day + ' · ' + DAY.weather.label + ' · contrato ' + DAY.contract + ' MWh', 'info', 3600);
  }
  function endDay() {
    DAY.running = false; closeTracker(); windBanner(false);
    el('hud').classList.remove('show'); el('actions').classList.remove('show'); el('side').classList.remove('show');
    // contrato
    var prodMWh = DAY.kWh / 1000, met = prodMWh >= DAY.contract;
    var bonus = 0, pen = 0;
    if (met) { bonus = 1500 + Math.round((prodMWh - DAY.contract) * 30); C.caja += bonus; C.contractsMet++; }
    else { pen = Math.round((DAY.contract - prodMWh) * 70); C.caja -= pen; }
    C.totalKWh += DAY.kWh; C.totalRev += DAY.rev; C.totalPen += pen;
    var rend = DAY.idealKWh > 0 ? clamp(DAY.kWh / DAY.idealKWh * 100, 0, 100) : 100;
    el('drTitle').textContent = 'Fin del día ' + C.day + ' · ' + DAY.weather.icon + ' ' + DAY.weather.label;
    el('drStats').innerHTML =
      '<div class="grid2">' +
        kpi('Producción', fmtMWh(DAY.kWh)) + kpi('Rendimiento', fmt(rend, 0) + '%') +
        kpi('Ingresos mercado', fmtE(DAY.rev)) + kpi('Costes O&M', fmtE(DAY.costs)) +
        kpi('Contrato', met ? '✅ Cumplido' : '❌ Incumplido') + kpi(met ? 'Bonus' : 'Penalización', met ? '+' + fmtE(bonus) : '−' + fmtE(pen)) +
      '</div><div class="pos">Caja: <b>' + fmtE(C.caja) + '</b></div>';
    saveCamp();
    el('btnNext').textContent = C.day >= C.days ? '🏁 Ver resultado de la temporada' : '➡ Continuar al día ' + (C.day + 1);
    el('dres').classList.add('show');
  }
  function nextDay() {
    el('dres').classList.remove('show');
    if (C.day >= C.days) { seasonEnd(); return; }
    C.day++; saveCamp(); showBrief();
  }
  function seasonEnd() {
    var score = Math.max(0, Math.round(C.caja + C.totalKWh / 1000 * 50 + C.contractsMet * 1000));
    var rec = { team: C.team, score: score, mwh: C.totalKWh / 1000, met: C.contractsMet, plant: C.plant, date: Date.now() };
    var arr = addRank(rec), pos = arr.indexOf(rec) + 1;
    el('seStats').innerHTML =
      '<div class="big">' + fmt(score, 0) + '</div><div class="muted" style="text-align:center">puntuación de temporada</div>' +
      '<div class="grid2">' + kpi('Caja final', fmtE(C.caja)) + kpi('Energía total', fmtMWh(C.totalKWh)) +
      kpi('Contratos', C.contractsMet + '/' + C.days) + kpi('Ingresos', fmtE(C.totalRev)) + '</div>' +
      '<div class="pos">Puesto <b>#' + pos + '</b> · ' + (window.PLANTAS[C.plant] ? window.PLANTAS[C.plant].name : C.plant) + '</div>';
    el('seRank').innerHTML = rankTable(arr, rec);
    try { localStorage.removeItem(CKEY); } catch (_) {}
    el('send').classList.add('show');
  }
  function rankTable(arr, hl) {
    if (!arr.length) return '<div class="muted">Aún no hay temporadas completadas.</div>';
    var h = '<table class="rank"><tr><th>#</th><th>Equipo</th><th>Energía</th><th>Puntos</th></tr>';
    for (var i = 0; i < Math.min(arr.length, 8); i++) { var r = arr[i], me = (hl && r === hl) ? ' class="me"' : ''; h += '<tr' + me + '><td>' + (i + 1) + '</td><td>' + escapeHtml(r.team) + '</td><td>' + fmt(r.mwh, 0) + ' MWh</td><td><b>' + fmt(r.score, 0) + '</b></td></tr>'; }
    return h + '</table>';
  }
  function kpi(l, v) { return '<div class="kpi"><div class="kl">' + l + '</div><div class="kv">' + v + '</div></div>'; }

  /* ===================== briefing + tienda ===================== */
  function showBrief() {
    loadPlant(C.plant);
    var wKey = C.weather[C.day - 1] || 'despejado', W = WEATHER[wKey];
    var contract = dayContract(wKey);
    el('bTitle').textContent = 'Día ' + C.day + ' de ' + C.days;
    el('bWeather').innerHTML = '<span class="bw">' + W.icon + ' ' + W.label + '</span>' + (W.winds > 1 ? '<span class="bw warn">💨 Día ventoso: revisa amortiguadores y ten seguridad a mano</span>' : '');
    el('bInfo').innerHTML =
      '<div class="bi"><span>📈 Mercado</span><b>pico de tarde ~' + fmt(priceAt(20.5), 0) + ' €/MWh</b></div>' +
      '<div class="bi"><span>📜 Contrato del día</span><b>' + contract + ' MWh</b></div>' +
      '<div class="bi"><span>👷 Cuadrillas</span><b>' + C.crews + '</b></div>' +
      '<div class="bi"><span>💰 Caja</span><b>' + fmtE(C.caja) + '</b></div>';
    buildShop();
    el('brief').classList.add('show');
  }
  function shopPrice(key) {
    var s = SHOP[key];
    if (key === 'crew') return s.base + (C.crews - 1) * 2500;
    if (key === 'spares') return s.base;
    var lvl = C[key] || 0; return Math.round(s.base * (1 + lvl * 0.6));
  }
  function shopLevel(key) {
    if (key === 'crew') return C.crews + ' ahora';
    if (key === 'spares') return null;
    var lvl = C[key] || 0, mx = SHOP[key].max; return 'nivel ' + lvl + '/' + mx;
  }
  function canBuy(key) {
    if (SHOP[key].max != null && (C[key] || 0) >= SHOP[key].max) return false;
    return C.caja >= shopPrice(key);
  }
  function buildShop() {
    var h = '';
    Object.keys(SHOP).forEach(function (k) {
      var s = SHOP[k], price = shopPrice(k), lvl = shopLevel(k), maxed = (s.max != null && (C[k] || 0) >= s.max);
      h += '<div class="shi"><div class="shic">' + s.icon + '</div><div class="sht"><b>' + s.name + (lvl ? ' <span class="lv">' + lvl + '</span>' : '') + '</b><small>' + s.desc + '</small></div>' +
        '<button class="shb" data-k="' + k + '" ' + (canBuy(k) ? '' : 'disabled') + '>' + (maxed ? 'Máx.' : fmtE(price)) + '</button></div>';
    });
    el('shopBox').innerHTML = h;
    Array.prototype.forEach.call(el('shopBox').querySelectorAll('.shb'), function (b) { b.onclick = function () { buy(b.getAttribute('data-k')); }; });
  }
  function buy(key) {
    if (!canBuy(key)) return; var price = shopPrice(key); C.caja -= price;
    if (key === 'crew') C.crews++;
    else if (key === 'spares') FKEYS.forEach(function (k) { C.spares[k] = (C.spares[k] | 0) + 2; });
    else C[key] = (C[key] || 0) + 1;
    saveCamp(); buildShop();
    el('bInfo').children[2].querySelector('b').textContent = C.crews;
    el('bInfo').children[3].querySelector('b').textContent = fmtE(C.caja);
    toast('Comprado: ' + SHOP[key].name, 'ok', 1600);
  }

  /* ===================== arranque ===================== */
  function init() {
    buildScene(el('cv'));
    requestAnimationFrame(loop); onResize(); window.addEventListener('resize', onResize);
    // portada
    var plantSel = 'burgo';
    el('seRankStart') && (el('seRankStart').innerHTML = rankTable(loadRank()));
    Array.prototype.forEach.call(document.querySelectorAll('.psel'), function (b) {
      b.onclick = function () { plantSel = b.getAttribute('data-p'); Array.prototype.forEach.call(document.querySelectorAll('.psel'), function (x) { x.classList.remove('on'); }); b.classList.add('on'); };
    });
    // ¿campaña guardada?
    var saved = loadCamp();
    if (saved && saved.day) { el('btnResume').style.display = ''; el('btnResume').onclick = function () { C = saved; el('start').classList.remove('show'); showBrief(); }; }
    el('btnNewSeason').onclick = function () { C = newCampaign((el('team').value || '').trim() || 'Equipo', plantSel); saveCamp(); el('start').classList.remove('show'); showBrief(); };
    el('btnStartDay').onclick = startDay;
    el('btnNext').onclick = nextDay;
    el('btnRestart').onclick = function () { el('send').classList.remove('show'); el('start').classList.add('show'); el('seRankStart').innerHTML = rankTable(loadRank()); };
    el('btnSafety').onclick = function () { if (!DAY || !DAY.running) return; DAY.safety = !DAY.safety; DAY.safetyAuto = false; syncSafety(); };
    el('btnPause').onclick = function () { if (!DAY) return; DAY.running = !DAY.running; el('btnPause').textContent = DAY.running ? '⏸' : '▶'; };
    el('btnFaults').onclick = function () { el('faultList').classList.toggle('show'); refreshFaultList(); };
    el('flClose').onclick = function () { el('faultList').classList.remove('show'); };
    el('tipClose').onclick = function () { el('tip').classList.remove('show'); };
  }
  function onResize() { var w = el('cv').clientWidth || innerWidth, h = el('cv').clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
