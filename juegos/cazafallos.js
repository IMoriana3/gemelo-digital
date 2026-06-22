/* ============================================================================
 * Caza-fallos — inspección de seguidor (juego interno Factiun)
 * ----------------------------------------------------------------------------
 * Reutiliza ../seguidor.js para mostrar un seguidor 3D con puntos de inspección.
 * Cada ronda da un SÍNTOMA y el jugador debe TOCAR el componente averiado.
 * Acierto = puntos (con bonus de rapidez); fallo = se revela el correcto.
 * Enseña a relacionar síntoma -> componente (módulo, correa, motor, TCU,
 * cableado, amortiguador).
 * ==========================================================================*/
(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var THREE = window.THREE;

  /* puntos de inspección (posición en el mundo; seguidor en grupo a y=2) */
  var HOTSPOTS = [
    { key: 'modulo', pos: [14, 2.25, 0] },
    { key: 'correa', pos: [-8, 2.15, 0] },
    { key: 'motor', pos: [0, 1.95, -0.55] },
    { key: 'tcu', pos: [1.4, 1.75, 0] },
    { key: 'cableado', pos: [9, 2.05, 0.1] },
    { key: 'amortiguador', pos: [-20, 1.15, 0.35] }
  ];
  var DEFECTS = {
    modulo: { label: 'Módulo / string', sym: 'Una rama produce mucho menos de lo normal y se aprecia una zona más oscura en los paneles.', exp: 'Módulo o string dañado (microgrietas / punto caliente).' },
    correa: { label: 'Correa / abarcón', sym: 'Con viento, un tramo de módulos vibra y se oye un golpeteo metálico.', exp: 'Correa u abarcón flojo: revisar el par de apriete.' },
    motor: { label: 'Accionamiento (motor)', sym: 'El seguidor no acompaña al sol y el motor calienta y consume de más.', exp: 'Sobrecorriente o avería en el accionamiento (slew/motor).' },
    tcu: { label: 'TCU / comunicaciones', sym: 'El seguidor ha desaparecido del SCADA: no envía telemetría.', exp: 'Fallo de la TCU o de las comunicaciones.' },
    cableado: { label: 'Cajas y cableado', sym: 'Falta por completo la producción de un string entero.', exp: 'Conector/caja de conexión suelto o cable dañado.' },
    amortiguador: { label: 'Amortiguador', sym: 'Con rachas de viento la viga oscila demasiado y no se estabiliza.', exp: 'Amortiguador roto: riesgo estructural, repúchalo antes del viento.' }
  };
  var ROUNDS = 8, RTIME = 15;

  var renderer, scene, camera, master, hitboxes = [], dots = {};
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  var view = { theta: 0.95, phi: 0.95, radius: 24, auto: true };

  function ringTex() {
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    x.clearRect(0, 0, 64, 64); x.strokeStyle = '#fff'; x.lineWidth = 7; x.beginPath(); x.arc(32, 32, 22, 0, 6.2832); x.stroke();
    x.globalAlpha = 0.35; x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 18, 0, 6.2832); x.fill();
    return new THREE.CanvasTexture(c);
  }
  var RING = null;
  function panelTex() {
    var W = 96, H = 192, c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    x.fillStyle = '#0a1019'; x.fillRect(0, 0, W, H); var nx = 6, ny = 12, cw = W / nx, ch = H / ny, g = 1.3;
    for (var iy = 0; iy < ny; iy++) for (var ix = 0; ix < nx; ix++) { x.fillStyle = 'hsl(214,48%,' + (7.5 + Math.random() * 3.5).toFixed(1) + '%)'; x.fillRect(ix * cw + g, iy * ch + g, cw - 2 * g, ch - 2 * g); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  function buildScene(wrap) {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c141d); scene.fog = new THREE.Fog(0x0c141d, 70, 180);
    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 600);
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; wrap.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0x4a5e72, 0.8)); scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x223018, 0.5));
    var sun = new THREE.DirectionalLight(0xfff2d8, 1.05); sun.position.set(18, 30, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); var s = sun.shadow.camera; s.left = -38; s.right = 38; s.top = 38; s.bottom = -38; s.near = 1; s.far = 90; s.updateProjectionMatrix(); sun.shadow.bias = -0.0006; scene.add(sun);
    var ground = new THREE.Mesh(new THREE.CircleGeometry(70, 48), new THREE.MeshStandardMaterial({ color: 0x16202b, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    master = new THREE.Group(); master.position.set(0, 2, 0); scene.add(master);
    var SG = Seguidor.materials(THREE); SG.glass.map = panelTex(); SG.glass.needsUpdate = true;
    var beam = Seguidor.buildBeam(THREE, { west: true, materials: SG, detail: 'mass', size: 'largo', skip: { antena: 1, antenatip: 1 } });
    master.add(beam.spin); master.add(beam.static);
    // postes
    var steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ac, roughness: 0.45, metalness: 0.65 });
    for (var px = -30; px <= 30; px += 10) { var col = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2, 0.16), steel); col.position.set(px, 1, 0); col.castShadow = true; scene.add(col); }

    RING = ringTex();
    HOTSPOTS.forEach(function (hs) {
      var hb = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), new THREE.MeshBasicMaterial({ visible: false }));
      hb.position.set(hs.pos[0], hs.pos[1], hs.pos[2]); hb.userData.key = hs.key; scene.add(hb); hitboxes.push(hb);
      var d = new THREE.Sprite(new THREE.SpriteMaterial({ map: RING, color: 0x36d399, transparent: true, depthTest: false, depthWrite: false }));
      d.scale.set(2.4, 2.4, 1); d.position.set(hs.pos[0], hs.pos[1], hs.pos[2]); d.userData.p = Math.random() * 6.28; d.visible = false; scene.add(d); dots[hs.key] = d;
    });
    bindCamera(renderer.domElement); applyCam();
  }

  function applyCam() { var sp = Math.sin(view.phi), cp = Math.cos(view.phi); camera.position.set(view.radius * sp * Math.sin(view.theta), 3 + view.radius * cp, view.radius * sp * Math.cos(view.theta)); camera.lookAt(0, 2.2, 0); }
  function bindCamera(dom) {
    var ptrs = {}, down = null, pinchD = 0; dom.style.touchAction = 'none';
    function npt() { return Object.keys(ptrs).length; }
    function pd() { var k = Object.keys(ptrs); if (k.length < 2) return 0; var a = ptrs[k[0]], b = ptrs[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    dom.addEventListener('pointerdown', function (e) { ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; view.auto = false; if (npt() === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; else { down = null; pinchD = pd(); } try { dom.setPointerCapture(e.pointerId); } catch (_) {} });
    dom.addEventListener('pointermove', function (e) {
      var pv = ptrs[e.pointerId]; if (!pv) return; var dx = e.clientX - pv.x, dy = e.clientY - pv.y; ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (npt() >= 2) { var d = pd(); if (pinchD > 0 && d > 0) view.radius = clamp(view.radius * pinchD / d, 10, 60); pinchD = d; applyCam(); return; }
      if (down && (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 9)) down.moved = true;
      view.theta -= dx * 0.006; view.phi = clamp(view.phi - dy * 0.006, 0.25, 1.45); applyCam();
    });
    function up(e) { var single = npt() === 1; if (down && !down.moved && single && (performance.now() - down.t) < 450) tap(down.x, down.y); delete ptrs[e.pointerId]; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} if (npt() === 0) { down = null; pinchD = 0; } }
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', function (e) { e.preventDefault(); view.auto = false; view.radius = clamp(view.radius * (1 + Math.sign(e.deltaY) * 0.1), 10, 60); applyCam(); }, { passive: false });
  }
  function tap(cx, cy) {
    if (!G || !G.running || G.answered) return;
    var r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((cx - r.left) / r.width) * 2 - 1; ndc.y = -((cy - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    var hit = ray.intersectObjects(hitboxes, false);
    if (hit.length) evaluate(hit[0].object.userData.key);
  }

  /* ---- juego ---- */
  var G = null;
  function start() {
    G = { idx: 0, score: 0, ok: 0, running: true, answered: false, defect: null, endAt: 0, raf: 0 };
    el('start').classList.remove('show'); el('end').classList.remove('show'); el('hud').classList.add('show'); el('panel').classList.add('show');
    view.auto = false; newRound();
  }
  function newRound() {
    G.answered = false;
    var keys = HOTSPOTS.map(function (h) { return h.key; });
    G.defect = keys[(Math.random() * keys.length) | 0];
    el('rNum').textContent = (G.idx + 1) + ' / ' + ROUNDS;
    el('rScore').textContent = G.score;
    el('sym').textContent = DEFECTS[G.defect].sym;
    el('reveal').className = 'reveal'; el('reveal').innerHTML = ''; el('btnNext').style.visibility = 'hidden';
    HOTSPOTS.forEach(function (h) { var d = dots[h.key]; d.visible = true; d.material.color.setHex(0x36d399); d.material.opacity = 1; });
    G.endAt = performance.now() + RTIME * 1000; cancelAnimationFrame(G.raf); tick();
  }
  function tick() {
    var left = Math.max(0, G.endAt - performance.now()), frac = left / (RTIME * 1000);
    el('timerBar').style.width = (frac * 100) + '%';
    el('timerBar').style.background = frac < 0.25 ? 'var(--danger)' : (frac < 0.5 ? 'var(--sun)' : 'var(--accent)');
    if (left <= 0) { if (!G.answered) evaluate(null); return; }
    G.raf = requestAnimationFrame(tick);
  }
  function evaluate(key) {
    if (G.answered) return; G.answered = true; cancelAnimationFrame(G.raf);
    var left = Math.max(0, G.endAt - performance.now()), frac = left / (RTIME * 1000);
    var correct = key === G.defect;
    var pts = correct ? Math.round(500 + 500 * frac) : 0; G.score += pts; if (correct) G.ok++;
    HOTSPOTS.forEach(function (h) {
      var d = dots[h.key];
      if (h.key === G.defect) d.material.color.setHex(0x37b87c);
      else if (h.key === key) d.material.color.setHex(0xe2574c);
      else { d.material.opacity = 0.25; }
    });
    var d2 = DEFECTS[G.defect];
    var msg = correct ? ('✅ ¡Correcto! +' + pts) : (key == null ? '⏱ Tiempo agotado' : '❌ No era ahí');
    el('reveal').className = 'reveal show ' + (correct ? 'ok' : 'bad');
    el('reveal').innerHTML = '<b>' + msg + ' · ' + d2.label + '</b><div class="exp">' + d2.exp + '</div>';
    el('rScore').textContent = G.score;
    el('btnNext').style.visibility = 'visible';
    el('btnNext').textContent = (G.idx + 1 >= ROUNDS) ? '🏁 Ver resultado' : '➡ Siguiente';
  }
  function next() { G.idx++; if (G.idx >= ROUNDS) end(); else newRound(); }
  function end() {
    G.running = false; el('panel').classList.remove('show');
    HOTSPOTS.forEach(function (h) { dots[h.key].visible = false; }); view.auto = true;
    el('endStats').innerHTML = '<div class="big">' + G.score + '</div><div class="muted" style="text-align:center">puntos</div>' +
      '<div class="muted" style="text-align:center;margin-top:8px">Aciertos: <b style="color:var(--tx)">' + G.ok + ' / ' + ROUNDS + '</b></div>';
    el('end').classList.add('show');
  }

  var last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    if (view.auto) { view.theta += dt * 0.18; applyCam(); }
    var k; for (k in dots) { var d = dots[k]; if (d.visible) { d.userData.p += dt * 4; d.scale.setScalar(2.4 + Math.sin(d.userData.p) * 0.5); } }
    renderer.render(scene, camera);
  }
  function onResize() { var w = el('cv').clientWidth || innerWidth, h = el('cv').clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function init() { buildScene(el('cv')); requestAnimationFrame(loop); onResize(); addEventListener('resize', onResize); el('btnStart').onclick = start; el('btnNext').onclick = next; el('btnAgain').onclick = start; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
