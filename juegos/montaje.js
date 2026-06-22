/* ============================================================================
 * Ensambla el Tracker — montaje 3D por orden correcto (juego interno Factiun)
 * ----------------------------------------------------------------------------
 * Reutiliza la FUENTE ÚNICA del seguidor (../seguidor.js): construye sus piezas
 * y las agrupa por PASO de montaje. El jugador elige qué componente toca montar
 * (en el orden real) y la pieza "cae" en su sitio. Contrarreloj + penalización
 * por errores. Enseña la secuencia real de montaje.
 * ==========================================================================*/
(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var THREE = window.THREE;

  /* ---- pasos de montaje (orden REAL) + a qué paso va cada pieza de seguidor.js ---- */
  var STEPS = [
    { label: 'Hincas y soporte', icon: '⛏️', desc: 'Cimentación: postes hincados y silla del rodamiento.' },
    { label: 'Accionamiento (slew + motor)', icon: '⚙️', desc: 'Corona slew, reductora y motor en el centro.' },
    { label: 'Tubo de torsión', icon: '➖', desc: 'La viga que gira (dos medias-vigas) sobre el slew.' },
    { label: 'Correas', icon: '🔩', desc: 'Correas omega + abarcones que abrazan la viga.' },
    { label: 'Módulos FV', icon: '🟦', desc: 'Los módulos fotovoltaicos sobre las correas.' },
    { label: 'Cajas y cableado', icon: '🔌', desc: 'Cajas de conexión y string (leapfrog).' },
    { label: 'TCU y antena', icon: '📡', desc: 'Unidad de control colgada de la viga + antena.' }
  ];
  var STEP_OF = {
    soporte: 0, bracket: 0,
    corona: 1, reductora: 1, cuello: 1, motor: 1, tapa: 1, motorcable: 1,
    tube: 2, tubecap: 2,
    correa: 3,
    mesa: 4,
    cable: 5, jbox: 5,
    tcu: 6, tcuchapa: 6, tcuabarcon: 6, antena: 6, antenatip: 6
  };
  var SKIP = { motorlink: 1, damper: 1 };

  /* ---- escena ---- */
  var renderer, scene, camera, master, stepGroups = [], anims = [];
  var view = { theta: 0.9, phi: 0.95, radius: 26, auto: true };

  function panelTex() {
    var W = 96, H = 192, c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    x.fillStyle = '#0a1019'; x.fillRect(0, 0, W, H);
    var nx = 6, ny = 12, cw = W / nx, ch = H / ny, g = 1.3;
    for (var iy = 0; iy < ny; iy++) for (var ix = 0; ix < nx; ix++) { x.fillStyle = 'hsl(214,48%,' + (7.5 + Math.random() * 3.5).toFixed(1) + '%)'; x.fillRect(ix * cw + g, iy * ch + g, cw - 2 * g, ch - 2 * g); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  function buildScene(wrap) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c141d);
    scene.fog = new THREE.Fog(0x0c141d, 60, 160);
    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 600);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0x4a5e72, 0.8));
    scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x223018, 0.5));
    var sun = new THREE.DirectionalLight(0xfff2d8, 1.05); sun.position.set(20, 30, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); var s = sun.shadow.camera; s.left = -25; s.right = 25; s.top = 25; s.bottom = -25; s.near = 1; s.far = 90; s.updateProjectionMatrix(); sun.shadow.bias = -0.0006;
    scene.add(sun);
    // suelo sutil
    var ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x16202b, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = true; scene.add(ground);
    buildSeguidor();
    bindCamera(renderer.domElement);
    applyCam();
  }

  function buildSeguidor() {
    master = new THREE.Group(); master.position.set(0, 2, 0); scene.add(master);
    for (var i = 0; i < STEPS.length; i++) { var g = new THREE.Group(); g.visible = false; stepGroups.push(g); master.add(g); }
    var mats = Seguidor.materials(THREE), ptex = panelTex();
    mats.glass.map = ptex; mats.glass.needsUpdate = true;
    Seguidor.parts(THREE, { size: 'largo', detail: 'mass' }).forEach(function (p) {
      if (SKIP[p.key]) return;
      var si = STEP_OF[p.key]; if (si == null) return;
      var mesh = new THREE.Mesh(p.geom(THREE), mats[p.mat]);
      mesh.applyMatrix4(p.m); mesh.castShadow = !!p.cast; mesh.receiveShadow = true;
      stepGroups[si].add(mesh);
    });
  }

  /* ---- cámara ---- */
  function applyCam() {
    var sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    camera.position.set(view.radius * sp * Math.sin(view.theta), 3 + view.radius * cp, view.radius * sp * Math.cos(view.theta));
    camera.lookAt(0, 2.4, 0);
  }
  function bindCamera(dom) {
    var ptrs = {}, pinchD = 0; dom.style.touchAction = 'none';
    function npt() { return Object.keys(ptrs).length; }
    function pd() { var k = Object.keys(ptrs); if (k.length < 2) return 0; var a = ptrs[k[0]], b = ptrs[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    dom.addEventListener('pointerdown', function (e) { ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; view.auto = false; if (npt() === 2) pinchD = pd(); try { dom.setPointerCapture(e.pointerId); } catch (_) {} });
    dom.addEventListener('pointermove', function (e) {
      var pv = ptrs[e.pointerId]; if (!pv) return; var dx = e.clientX - pv.x, dy = e.clientY - pv.y; ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (npt() >= 2) { var d = pd(); if (pinchD > 0 && d > 0) view.radius = clamp(view.radius * pinchD / d, 10, 70); pinchD = d; applyCam(); return; }
      view.theta -= dx * 0.006; view.phi = clamp(view.phi - dy * 0.006, 0.25, 1.45); applyCam();
    });
    function up(e) { delete ptrs[e.pointerId]; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} }
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', function (e) { e.preventDefault(); view.auto = false; view.radius = clamp(view.radius * (1 + Math.sign(e.deltaY) * 0.1), 10, 70); applyCam(); }, { passive: false });
  }

  /* ---- juego ---- */
  var G = null;
  function start() {
    for (var i = 0; i < stepGroups.length; i++) stepGroups[i].visible = false;
    anims = [];
    G = { idx: 0, errors: 0, t0: performance.now(), running: true };
    el('start').classList.remove('show'); el('end').classList.remove('show');
    el('hud').classList.add('show'); el('qbox').classList.add('show');
    renderChecklist(); ask();
  }
  function ask() {
    if (G.idx >= STEPS.length) return finish();
    el('qPrompt').textContent = '¿Qué se monta ahora? (paso ' + (G.idx + 1) + '/' + STEPS.length + ')';
    // opciones: correcta + 2 señuelos de pasos NO hechos
    var correct = G.idx;
    var pool = []; for (var i = G.idx + 1; i < STEPS.length; i++) pool.push(i);
    for (var j = G.idx - 1; j >= 0 && pool.length < 2; j--) pool.push(j);   // si faltan, usa anteriores
    shuffle(pool); var opts = [correct, pool[0], pool[1]].filter(function (v, k, a) { return v != null && a.indexOf(v) === k; });
    while (opts.length < 3 && opts.length < STEPS.length) { var r = (Math.random() * STEPS.length) | 0; if (opts.indexOf(r) < 0) opts.push(r); }
    shuffle(opts);
    var h = '';
    opts.forEach(function (si) { h += '<button class="opt" data-s="' + si + '"><span class="oi">' + STEPS[si].icon + '</span>' + STEPS[si].label + '</button>'; });
    el('opts').innerHTML = h;
    Array.prototype.forEach.call(el('opts').querySelectorAll('.opt'), function (b) { b.onclick = function () { pick(parseInt(b.getAttribute('data-s'), 10), b); }; });
  }
  function pick(si, btn) {
    if (!G.running) return;
    if (si === G.idx) {
      revealStep(G.idx); G.idx++;
      toast('✅ ' + STEPS[si].label, 'ok');
      renderChecklist();
      setTimeout(ask, 350);
    } else {
      G.errors++;
      btn.classList.add('bad'); setTimeout(function () { btn.classList.remove('bad'); }, 500);
      toast('❌ Ese no es el siguiente. Pista: ' + STEPS[G.idx].desc, 'warn', 3200);
    }
  }
  function revealStep(i) {
    var g = stepGroups[i]; g.visible = true; g.position.y = 5; anims.push({ g: g, t: 0 });
  }
  function renderChecklist() {
    var h = '';
    for (var i = 0; i < STEPS.length; i++) {
      var done = i < G.idx;
      h += '<div class="ck' + (done ? ' done' : '') + '"><span class="cki">' + (done ? '✓' : STEPS[i].icon) + '</span>' + (done ? STEPS[i].label : '— ¿?') + '</div>';
    }
    el('checklist').innerHTML = h;
    el('hStep').textContent = G.idx + '/' + STEPS.length;
    el('hErr').textContent = G.errors;
  }
  function finish() {
    G.running = false;
    el('qbox').classList.remove('show');
    var secs = (performance.now() - G.t0) / 1000;
    var score = Math.max(0, Math.round(10000 - secs * 60 - G.errors * 600));
    el('endStats').innerHTML =
      '<div class="big">' + score + '</div><div class="muted" style="text-align:center">puntos</div>' +
      '<div class="grid2"><div class="kpi"><div class="kl">Tiempo</div><div class="kv">' + fmtT(secs) + '</div></div>' +
      '<div class="kpi"><div class="kl">Errores</div><div class="kv">' + G.errors + '</div></div></div>' +
      '<div class="muted" style="text-align:center;margin-top:6px">Secuencia completada · seguidor montado ✔</div>';
    el('end').classList.add('show');
    view.auto = true;
  }
  function fmtT(s) { var m = Math.floor(s / 60), r = Math.round(s % 60); return (m ? m + 'm ' : '') + r + 's'; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---- toast ---- */
  var tT = null;
  function toast(m, k, ms) { var t = el('toast'); t.textContent = m; t.className = 'toast show ' + (k || 'info'); clearTimeout(tT); tT = setTimeout(function () { t.className = 'toast'; }, ms || 2200); }

  /* ---- loop ---- */
  var last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    if (view.auto) { view.theta += dt * 0.18; applyCam(); }
    for (var i = anims.length - 1; i >= 0; i--) { var a = anims[i]; a.t += dt; var f = Math.min(1, a.t / 0.5); a.g.position.y = 5 * (1 - (1 - (1 - f) * (1 - f))); if (f >= 1) { a.g.position.y = 0; anims.splice(i, 1); } }
    renderer.render(scene, camera);
  }
  function onResize() { var w = el('cv').clientWidth || innerWidth, h = el('cv').clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  function init() {
    buildScene(el('cv')); requestAnimationFrame(loop); onResize(); addEventListener('resize', onResize);
    el('btnStart').onclick = start;
    el('btnAgain').onclick = start;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
