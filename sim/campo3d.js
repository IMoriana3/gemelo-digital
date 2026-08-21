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

   ── Por qué hay DOS verbos y no uno ──
   `actualiza(P)` mueve la escena según la simulación. `dibuja()` la pinta. Estaban
   juntos, y eso hacía que el 3D fuera al ritmo del repintado de la interfaz —una vez
   cada 0,22 s, o sea 4,5 fps— y que girar la cámara no pintara NADA hasta el
   siguiente tick. De ahí lo de «va lento y trabado»: no era el coste, era la cadencia.
   Medido: 1.500 instancias, 30 draw calls, 71k triángulos, 1,2 ms por render. Sobra
   máquina; faltaban frames.

   Separados, cada uno va a lo suyo: se dibuja a ritmo de pantalla siempre que haga
   falta (girar, redimensionar, que la planta se haya movido) y se actualiza solo
   cuando la simulación ha avanzado de verdad. Y como girar la cámara no cambia la
   escena, el mapa de sombras —que es el 83 % del coste del render— no se rehace en
   esos frames.
   ============================================================================ */
(function (global) {
'use strict';

var D2R = Math.PI / 180;

function Campo3D(cont, cfg) {
  cfg = cfg || {};
  this.cont = cont;
  this.bifila = cfg.bifila !== false;      /* el seguidor de la casa; monofila se pide */
  this.alSeleccionar = cfg.alSeleccionar || function () {};
  this.THREE = global.THREE;
  if (!this.THREE) throw new Error('falta lib/three.min.js');
  if (!global.Seguidor) throw new Error('falta seguidor.js (el modelo compartido)');

  var T = this.THREE, yo = this;
  this.scene = new T.Scene();
  this.camera = new T.PerspectiveCamera(46, 1, 0.5, 6000);
  this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  this.renderer.setPixelRatio(Math.min(1.75, global.devicePixelRatio || 1));
  this.renderer.shadowMap.enabled = true;
  this.renderer.shadowMap.type = T.PCFSoftShadowMap;
  /* Las sombras NO se rehacen solas. Girar la cámara no cambia dónde cae una sombra, y
     rehacer el mapa en cada frame se lleva el 83 % del coste (1,02 ms de 1,23). Se marca
     sucio cuando la escena se mueve de verdad, en `actualiza()`. */
  this.renderer.shadowMap.autoUpdate = false;
  cont.appendChild(this.renderer.domElement);
  this.renderer.domElement.style.display = 'block';
  this.renderer.domElement.style.width = '100%';
  this.renderer.domElement.style.height = '100%';

  /* Luz: el sol lo mueve la simulación, la hemisférica solo levanta las sombras. La
     intensidad es la de la página hermana (index.html), no una subida a ojo: a 2,1 el
     suelo Lambert se saturaba y salía un verde plano contra el que los módulos no
     contrastaban -- parecía una maqueta, no un campo. */
  /* Ajustes de sombra: los de `cobertura-zigbee/backtracking.html`, que ya se peleó con
     esto y dejó escrito el porqué. No se re-deducen aquí. */
  this.sol = new T.DirectionalLight(0xfff0dd, 1.45);
  this.sol.castShadow = true;
  this.sol.shadow.mapSize.set(4096, 4096);
  this.sol.shadow.bias = -2e-4;
  this.sol.shadow.normalBias = 0.3;
  this.scene.add(this.sol);
  this.scene.add(this.sol.target);
  this.hemi = new T.HemisphereLight(0x9fc3e8, 0x2b2a24, 0.50);
  this.scene.add(this.hemi);

  /* EL SOL, VISIBLE. Estaba solo como luz, así que la escena no decía dónde está: se
     veía que había sombras pero no de dónde venían, y el seguimiento pierde el sentido
     si no ves a qué apunta. */
  this.solMesh = new T.Mesh(new T.SphereGeometry(1, 16, 12),
                            new T.MeshBasicMaterial({ color: 0xfbbd23, fog: false }));
  this.solMesh.frustumCulled = false;
  this.scene.add(this.solMesh);

  /* LA VELETA. El viento decide el abanderamiento y hasta ahora era un número en un
     panel: en el campo no se veía ni que soplaba ni de dónde. La flecha apunta ADONDE
     SOPLA y el disco de debajo marca el norte, que es lo que ata la escena al mapa. */
  this.veleta = new T.Group();
  var flecha = new T.Group();
  var palo = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 5, 8),
                        new T.MeshBasicMaterial({ color: 0x6fb7ff, fog: false }));
  palo.rotation.z = -Math.PI / 2;
  var punta = new T.Mesh(new T.ConeGeometry(0.55, 1.6, 10),
                         new T.MeshBasicMaterial({ color: 0x6fb7ff, fog: false }));
  punta.rotation.z = -Math.PI / 2; punta.position.x = 3.3;
  flecha.add(palo, punta);
  this.flechaViento = flecha;
  this.veleta.add(flecha);
  /* aguja del norte, fija: sin ella una flecha girando no dice nada */
  var norte = new T.Mesh(new T.ConeGeometry(0.42, 1.5, 8),
                         new T.MeshBasicMaterial({ color: 0xe7edf3, fog: false }));
  norte.rotation.z = Math.PI / 2;      /* el norte es −X en este marco */
  norte.position.set(-2.6, 0, 0);
  this.veleta.add(norte);
  this.scene.add(this.veleta);

  /* Suelo y niebla. El plano se acababa a 600 m del centro y se veía el CORTE contra el
     cielo, como si la planta flotara en una bandeja. Con niebla del color del horizonte
     el borde se disuelve. Los dos se dimensionan en `construye()` a partir del campo:
     con la niebla fija a 300 m se comía la planta entera y todo salía lavado. */
  this.suelo = new T.Mesh(new T.PlaneGeometry(1, 1),
                          new T.MeshLambertMaterial({ color: 0x39402c }));
  this.suelo.rotation.x = -Math.PI / 2;
  this.suelo.receiveShadow = true;
  this.scene.add(this.suelo);
  this.scene.fog = new T.Fog(0x87a8c4, 1e5, 2e5);
  this.grupoPlanta = new T.Group();
  this.scene.add(this.grupoPlanta);

  this.blancoOrbita = new T.Vector3(0, 2, 0);
  this._sucio = true;                       /* hay algo que pintar */
  this.orbita = orbita(this.renderer.domElement, this.camera, this.blancoOrbita, 120, 12, 3000, T,
                       function () { yo._sucio = true; yo.ajustaSombra(); });
  this.picar();
  this.redimensiona();

  /* El tamaño se mira cuando CAMBIA, no en cada pintado: `setSize` reasigna
     canvas.width, y eso tira el buffer de dibujo aunque el número sea el mismo. */
  if (global.ResizeObserver) {
    this._ro = new global.ResizeObserver(function () { yo.redimensiona(); });
    this._ro.observe(cont);
  }
  this._onRes = function () { yo.redimensiona(); };
  global.addEventListener('resize', this._onRes);

  /* bucle propio, a ritmo de pantalla: la interfaz repinta cuando quiere, el 3D no
     depende de ella */
  this._vivo = true;
  (function rueda() {
    if (!yo._vivo) return;
    global.requestAnimationFrame(rueda);
    if (yo._sucio) yo.dibuja();
  })();
}

/* ── el mapa de sombras ─────────────────────────────────────────────────────
   Esto ya estaba resuelto en `cobertura-zigbee/backtracking.html`, que dejó escritas las
   dos causas de la sierra. Se copia el criterio, no se vuelve a deducir:

   1. El recuadro se CIÑE A LA VISTA y sigue a la cámara. Cubrir el campo entero pasara
      lo que pasara era gastar la mitad de los texels en suelo que no se ve; allí eran
      «4096 px sobre 4 km: texels de 2 m».
   2. Y es ANISÓTROPO. Con el sol rasante cada texel se proyecta 1/sen(elev) por el
      suelo, así que un recuadro cuadrado da texels de metros al alba y al ocaso —y la
      sombra avanza a saltos, clavada hasta cruzar un texel—. El alto se ciñe a lo que la
      escena ocupa VISTA DESDE EL SOL: R·sen(el) + alturas·cos(el).

   Esa segunda parte es la que me faltaba, y es justo la que se nota a las horas en que
   se miran las sombras. */
Campo3D.prototype.ajustaSombra = function () {
  if (!this._radioCampo) return;
  var r = Math.max(22, Math.min(this._radioCampo, this.orbita.radio() * 0.75));
  var b = this.blancoOrbita, el = this._el == null ? 0.6 : this._el;
  if (this._rSombra && Math.abs(r - this._rSombra) < r * 0.12 &&
      Math.abs(b.x - this._sx) < r * 0.25 && Math.abs(b.z - this._sz) < r * 0.25 &&
      Math.abs(el - this._elSombra) < 0.05) return;
  this._rSombra = r; this._sx = b.x; this._sz = b.z; this._elSombra = el;
  this.sol.target.position.set(b.x, 0, b.z);
  this.sol.target.updateMatrixWorld();
  this._zen = null;                     /* el sol se recoloca sobre el nuevo objetivo */
  var sc = this.sol.shadow.camera;
  var vy = Math.max(20, r * Math.sin(el) + 15 * Math.cos(el));   /* 15 m: lo que levanta la planta */
  sc.left = -r; sc.right = r; sc.top = vy; sc.bottom = -vy;
  var dLT = this.sol.position.distanceTo(this.sol.target.position) || 400;
  sc.near = Math.max(1, dLT - 450); sc.far = dLT + 450;
  sc.updateProjectionMatrix();
  this.renderer.shadowMap.needsUpdate = true;
  this._sucio = true;
};

/* Cambiar de bífila a monofila rehace el campo entero: cambian las piezas de cada
   equipo y el paso entre filas. */
Campo3D.prototype.ponBifila = function (b, P) {
  b = !!b;
  if (b === this.bifila) return;
  this.bifila = b;
  if (P) { this.construye(P); this.actualiza(P); }
};

Campo3D.prototype.para = function () {
  this._vivo = false;
  if (this._ro) this._ro.disconnect();
  global.removeEventListener('resize', this._onRes);
};

/* ── la flota ───────────────────────────────────────────────────────────────
   Se rehace solo cuando cambia el número de equipos, no cada paso. */
Campo3D.prototype.construye = function (P) {
  var T = this.THREE, S = global.Seguidor;
  /* Rehacer la planta creaba mallas nuevas y dejaba las viejas en la GPU: quitarlas de
     la escena no libera nada. Cambiar de 25 a 2.000 y volver unas cuantas veces acababa
     tirando el contexto WebGL, y eso se ve como que «el 3D se ha roto». */
  while (this.grupoPlanta.children.length) {
    var v = this.grupoPlanta.children[0];
    this.grupoPlanta.remove(v);
    /* los materiales se crean nuevos en cada `construye`, así que estos ya no los usa
       nadie; la textura de células es aparte y la cachea el modelo, no se toca */
    if (v.geometry) v.geometry.dispose();
    if (v.material && v.material.dispose) v.material.dispose();
  }
  this._ang = null; this._zen = null;

  var tcus = P.tcus;
  this.n = tcus.length;
  this.orden = tcus;

  var D = S.DIMS;
  /* El tubo de par del modelo va a lo largo de X y bascula sobre X, así que el PASO
     ENTRE FILAS (6 m canónicos) va en Z. Varios seguidores de la misma línea se
     alinean en X, separados por su vano.

     Y un seguidor de la casa es BIFILA: DOS vigas a 6 m, gobernadas por un solo motor
     —una lleva el slew, la TCU, la antena y el seccionador; la gemela va por el eje de
     transmisión y no lleva nada—. Aquí se dibujaba una sola viga por equipo, y encima
     con TCU y motor propios: el campo enseñaba la mitad de la estructura y el doble de
     electrónica. `monofila` existe para las plantas que sí lo son; el modelo canónico
     es la bífila y es lo que sale por defecto. */
  var bifila = this.bifila !== false;
  var pitch = 6.0;                       /* CANONICAL_PITCH_M: entre vigas contiguas */
  var pasoFila = bifila ? pitch * 2 : pitch;   /* de un seguidor al siguiente */
  var largo = D.span || 34;              /* la fila entera, con su vano de motor */
  var porLinea = Math.max(1, Math.round(Math.sqrt(this.n * pasoFila / largo * 2.2)));
  var lineas = Math.ceil(this.n / porLinea);
  /* El eje del tubo va a la ALTURA DEL POSTE. Estaba a y = 0, o sea con 1,10 m de poste
     bajo tierra y las mesas rozando el suelo: por eso no se veían los postes y la sombra
     salía pegada al panel y aserrada — un receptor a centímetros del proyector es acné de
     shadow map garantizado. La cota es del modelo (postH), la misma que usa index.html. */
  var hEje = D.postH || 2.0;
  this.bases = [];
  this.pos = [];                          /* {x,z} sin desempaquetar matrices en el bucle */
  for (var i = 0; i < this.n; i++) {
    var c = i % porLinea, f = Math.floor(i / porLinea);
    var x = (c - (porLinea - 1) / 2) * (largo + 6);
    var z = (f - (lineas - 1) / 2) * pasoFila;
    this.bases.push(new T.Matrix4().makeTranslation(x, hEje, z));
    this.pos.push({ x: x, z: z });
  }
  this._ext = { x: (porLinea - 1) * (largo + 6) + largo,
                z: (lineas - 1) * pasoFila + (bifila ? pitch : 0) + 4 };

  /* el modelo compartido, en instancias. `vistePaneles` le pone las células al vidrio:
     sin ellas `glass` es blanco liso y el campo sale a trozos cegado o negro según le
     dé el sol, que es media parte de lo que se veía «raro». */
  var SG = S.vistePaneles ? S.vistePaneles(T, S.materials(T)) : S.materials(T);
  this.piezas = [];
  var yo = this;
  /* OJO con el contrato del modelo: `mat` es una CLAVE del mapa de materiales y
     `geom` una FÁBRICA `(THREE) -> BufferGeometry`, no objetos ya construidos.
     Pasárselos tal cual a InstancedMesh revienta dentro del render, no al crearlo. */
  /* El poste viene marcado `terrainScaled`: el modelo lo dibuja con un largo nominal y
     cuenta con que la app lo ESTIRE hasta donde esté el suelo —o el terreno, en las
     páginas que lo tienen—. Sin eso queda colgando en el aire con el pie a 0,9 m, que es
     como estaba. La cabeza no se toca: va donde va, debajo de la corona. */
  function alSuelo(geom, locals) {
    if (!geom.boundingBox) geom.computeBoundingBox();
    var bb = geom.boundingBox, alto = bb.max.y - bb.min.y;
    if (alto <= 0) return locals;
    return locals.map(function (m) {
      var top = m.elements[13] + bb.max.y;          /* la cabeza, tal cual la puso el modelo */
      var s = (top + hEje) / alto;                  /* hasta y = −hEje local, o sea el suelo */
      if (!(s > 1)) return m;
      var n = m.clone();
      n.elements[5] = s;
      n.elements[13] = top - s * bb.max.y;
      return n;
    });
  }
  function monta(plan, dz) {
    plan.forEach(function (p) {
      var geom = (typeof p.geom === 'function') ? p.geom(T) : p.geom;
      var mat = (typeof p.mat === 'string') ? (SG[p.mat] || SG.steel) : p.mat;
      if (!geom || !geom.isBufferGeometry) return;
      if (p.terrainScaled) p = { key: p.key, mat: p.mat, spin: p.spin, cast: p.cast,
                                 locals: alSuelo(geom, p.locals) };
      var im = new T.InstancedMesh(geom, mat, yo.n * p.locals.length);
      im.castShadow = !!p.cast; im.receiveShadow = true;
      im.frustumCulled = false;
      yo.grupoPlanta.add(im);
      /* la traslación a SU viga va antes del giro: cada tubo bascula sobre su propio
         eje, no sobre el del vecino */
      yo.piezas.push({ im: im, locals: p.locals, spin: !!p.spin,
                       mT: dz ? new T.Matrix4().makeTranslation(0, 0, dz) : null });
    });
  }
  monta(S.instancePlan(T, { materials: SG, detail: 'mass', west: true }),
        bifila ? -pitch / 2 : 0);
  if (bifila) {
    monta(S.instancePlan(T, { materials: SG, detail: 'mass', west: false }), pitch / 2);

    /* El EJE DE TRANSMISIÓN: lo que hace que la gemela se mueva sin motor propio. Sin él
       la bífila son dos vigas girando a la vez porque sí. No es una pieza de `parts()`
       —eso describe UNA viga— sino algo que va entre las dos, así que lo coloca la app
       con la cota del modelo. No bascula: sale de la reductora, que es fija. */
    if (S.ejeTransGeom) {
      var yo2 = this;
      var ponFijo = function (geom, dz) {
        var im = new T.InstancedMesh(geom, SG.steel, yo2.n);
        im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
        yo2.grupoPlanta.add(im);
        var me = new T.Matrix4(), tz = new T.Matrix4().makeTranslation(0, 0, dz || 0);
        for (var e = 0; e < yo2.n; e++) {
          me.multiplyMatrices(yo2.bases[e], tz);
          im.setMatrixAt(e, me);
        }
        im.instanceMatrix.needsUpdate = true;
      };
      ponFijo(S.ejeTransGeom(T, pitch), 0);
      if (S.cardanGeom) {                       /* los dos acoplamientos de los extremos */
        var dzc = S.cardanDz(pitch);
        ponFijo(S.cardanGeom(T), -dzc);
        ponFijo(S.cardanGeom(T), dzc);
      }
    }
  }

  /* Testigos de salud, uno por seguidor. Van al EXTREMO de la fila y a poca altura: en
     el centro y a 3,6 m quedaban flotando sueltos, sin que se viera de quién era cada
     uno. Y su matriz no cambia nunca —la base no se mueve—, así que se pone aquí una
     vez; por frame solo se toca el color, y solo si ha cambiado. */
  var geo = new T.SphereGeometry(0.38, 10, 8);
  var mat = new T.MeshBasicMaterial({ color: 0xffffff, fog: false });
  this.testigos = new T.InstancedMesh(geo, mat, this.n);
  this.testigos.frustumCulled = false;
  this.grupoPlanta.add(this.testigos);
  this._colTmp = new T.Color();
  this._salud = new Array(this.n);
  var mt = new T.Matrix4(), off = new T.Matrix4().makeTranslation(largo / 2 + 1.6, 1.2, 0);
  for (var q = 0; q < this.n; q++) {
    mt.multiplyMatrices(this.bases[q], off);
    this.testigos.setMatrixAt(q, mt);
  }
  this.testigos.instanceMatrix.needsUpdate = true;

  /* aro del seleccionado: elipse a la medida del SEGUIDOR —las dos vigas si es bífila—,
     no un donut de 3,4 m suelto en medio */
  this.aro = new T.Mesh(new T.TorusGeometry(1, 0.06, 6, 48),
                        new T.MeshBasicMaterial({ color: 0x36D399, fog: false }));
  this.aro.rotation.x = -Math.PI / 2;
  this.aro.scale.set(largo * 0.55, bifila ? pitch / 2 + 2.6 : 4.2, 1);
  this.aro.visible = false;
  this.grupoPlanta.add(this.aro);

  /* La cámara de sombras se ajusta al CAMPO. Estaba fija en ±140 m y una planta de 200
     seguidores mide 350: las tres cuartas partes del campo no proyectaban sombra, y eso
     es lo que hacía que se viera plano y falso. */
  var diag = Math.hypot(this._ext.x, this._ext.z);
  this._radioCampo = Math.max(60, diag * 0.62);
  this.ajustaSombra();

  /* La niebla empieza PASADO el campo. Puesta antes, lavaba de gris la mitad de lejos
     de la planta y parecía que faltaba render, no que hubiera atmósfera. Y el suelo se
     estira más allá de donde la niebla ya lo ha borrado, así no se ve dónde acaba. */
  this.scene.fog.near = diag * 2.0;
  this.scene.fog.far = diag * 9;
  this.suelo.geometry.dispose();
  this.suelo.geometry = new T.PlaneGeometry(diag * 24, diag * 24);

  this._m = new T.Matrix4(); this._rx = new T.Matrix4(); this._acc = new T.Matrix4();
  this.encuadra();
  this._sucio = true;
};

/* ── mover la escena según la simulación ────────────────────────────────────
   Barato y con cero reservas: se llama tantas veces como avance la simulación, pero
   solo hace trabajo si algo se ha movido de verdad. */
var COL_SALUD = { ok: 0x37b87c, aviso: 0xe0a52b, alarma: 0xe2574c, offline: 0x5e7388 };

Campo3D.prototype.actualiza = function (P) {
  if (!P || !P.tcus.length) return;
  if (!this.piezas || P.tcus.length !== this.n) this.construye(P);
  var tcus = P.tcus, i, j;

  /* ¿se ha movido alguna mesa? Rehacer 1.500 matrices para dejarlas donde estaban es
     trabajo tirado, y de noche o en pausa están TODAS quietas. */
  var movio = false;
  if (!this._ang) { this._ang = new Float32Array(this.n); movio = true; }
  for (i = 0; i < this.n; i++) {
    var a = tcus[i].anguloReal;
    if (Math.abs(a - this._ang[i]) > 0.02) { this._ang[i] = a; movio = true; }
  }

  if (movio) {
    for (var pi = 0; pi < this.piezas.length; pi++) {
      var pz = this.piezas[pi], k = 0;
      for (i = 0; i < this.n; i++) {
        /* la MESA, no lo que el TCU mide: si el sensor miente, aquí se ve torcida.
           El signo es el MISMO que usa el gemelo 3D sobre este modelo
           (`rotation.x = angulo·D2R`): negarlo dejaría el campo en espejo, que es un
           error que no canta hasta que alguien compara las dos páginas a la vez. */
        if (pz.spin) this._rx.makeRotationX(this._ang[i] * D2R);
        for (var l = 0; l < pz.locals.length; l++) {
          this._acc.copy(this.bases[i]);
          if (pz.mT) this._acc.multiply(pz.mT);     /* a su viga, antes de bascular */
          if (pz.spin) this._acc.multiply(this._rx);
          this._acc.multiply(pz.locals[l]);
          pz.im.setMatrixAt(k++, this._acc);
        }
      }
      pz.im.instanceMatrix.needsUpdate = true;
    }
  }

  /* testigos: el mismo criterio de salud que el SCADA. Solo el color, y solo el que
     cambia — la posición ya está puesta desde `construye`. */
  var tocaColor = false;
  for (j = 0; j < this.n; j++) {
    var sa = tcus[j].salud ? tcus[j].salud() : 'ok';
    if (this._salud[j] === sa) continue;
    this._salud[j] = sa;
    this._colTmp.setHex(COL_SALUD[sa] || COL_SALUD.ok);
    this.testigos.setColorAt(j, this._colTmp);
    tocaColor = true;
  }
  if (tocaColor && this.testigos.instanceColor) this.testigos.instanceColor.needsUpdate = true;

  /* el sol de la simulación, no uno de adorno */
  var s = tcus[0] && tcus[0].solar, solMovio = false;
  if (s) {
    /* El seguidor bascula sobre X = eje N-S, así que la componente ESTE-OESTE del sol
       (sin az) va en Z y la NORTE-SUR (cos az) en X. Es el mismo mapeo que el gemelo
       3D sobre este modelo; cambiarlas de sitio pone el sol a lo largo del tubo y el
       seguimiento deja de tener sentido, sin que nada falle. */
    if (this._zen == null || Math.abs(s.zen - this._zen) > 0.05 || Math.abs(s.az - this._az) > 0.05) {
      this._zen = s.zen; this._az = s.az; solMovio = true;
      var el = Math.max((90 - s.zen) * D2R, 0.04), az = s.az * D2R, ce = Math.cos(el);
      var d = Math.max(320, Math.hypot(this._ext.x, this._ext.z));
      /* RELATIVO al objetivo de la sombra: si se pone en absoluto y el recuadro de
         sombras se desplaza con la cámara, la luz cambia de dirección al moverse */
      var tg = this.sol.target.position;
      this.sol.position.set(tg.x + Math.cos(az) * ce * d, tg.y + Math.sin(el) * d,
                            tg.z + Math.sin(az) * ce * d);
      /* la elevación decide el alto del recuadro de sombras: con sol rasante hay que
         estirarlo o el texel se proyecta metros por el suelo */
      this._el = el;
      this.ajustaSombra();
      this.sol.intensity = s.dia ? 1.45 : 0.05;
      this.hemi.intensity = s.dia ? 0.50 : 0.16;
      var cielo = s.dia ? 0x87a8c4 : 0x0b1119;
      if (this._bg !== cielo) {
        this.scene.background = new this.THREE.Color(cielo);
        this.scene.fog.color.setHex(cielo);
        this._bg = cielo;
      }
    }
  }

  /* el disco del sol, a media distancia para que se vea sin irse al infinito, y la
     veleta en una esquina del campo */
  /* El disco va a una distancia que depende de CUÁNTO SE VE, no del tamaño del campo:
     puesto a 128 m con la cámara encuadrando la planta se quedaba fuera de cuadro y no
     servía de nada. Atado al radio de órbita entra casi siempre — y cuando el sol está
     detrás de la cámara no se ve, que es lo correcto. */
  if (s && (solMovio || this._solPuesto !== this.orbita.radio())) {
    this._solPuesto = this.orbita.radio();
    var dm = Math.max(45, this._solPuesto * 0.8);
    var el2 = Math.max((90 - s.zen) * D2R, 0.04), az2 = s.az * D2R, ce2 = Math.cos(el2);
    var tg2 = this.sol.target.position;
    this.solMesh.position.set(tg2.x + Math.cos(az2) * ce2 * dm, Math.sin(el2) * dm,
                              tg2.z + Math.sin(az2) * ce2 * dm);
    this.solMesh.scale.setScalar(Math.max(1.2, dm * 0.035));
    this.solMesh.visible = !!s.dia;
    this._sucio = true;
  }
  var m = P.meteo;
  if (m && this.veleta) {
    /* `dirViento` es METEOROLÓGICA: de DÓNDE viene (0 N · 90 E). En este marco el norte
       es −X y el este −Z, así que un viento DEL norte sopla hacia +X.

       La flecha nace apuntando a +X, o sea al sur, que es justo adonde sopla el del
       norte: con dirViento = 0 no hay que girarla nada. Un giro en Y de θ la lleva a
       (cos θ, 0, −sen θ), así que θ = −dirViento. Tenía un π de más y la flecha
       señalaba de dónde venía el viento en vez de adónde iba. */
    var dv = (m.dirViento || 0) * D2R;
    this.flechaViento.rotation.y = -dv;
    /* y la veleta se escala con el CAMPO: una flecha de 5 m junto a una planta de 230 m
       de diagonal es un punto azul que no se ve */
    var v = m.viento || 0, esc = Math.max(1, Math.hypot(this._ext.x, this._ext.z) / 90);
    this.veleta.scale.setScalar(esc);
    this.flechaViento.scale.setScalar(Math.max(0.55, Math.min(2.2, 0.55 + v / 12)));
    this.flechaViento.visible = v > 0.3;
    this.veleta.position.set(-this._ext.x / 2 - 8 * esc, 4 * esc, -this._ext.z / 2 - 7 * esc);
    if (this._dv !== dv || this._vv !== v) { this._dv = dv; this._vv = v; this._sucio = true; }
  }

  if (movio || tocaColor || solMovio) {
    /* solo aquí se rehace el mapa de sombras: es lo que cuesta, y girar la cámara no
       cambia dónde cae una sombra */
    if (movio || solMovio) this.renderer.shadowMap.needsUpdate = true;
    this._sucio = true;
  }
};

/* ── pintar ──────────────────────────────────────────────────────────────── */
Campo3D.prototype.dibuja = function () {
  this._sucio = false;
  this.renderer.render(this.scene, this.camera);
};

/* compatibilidad: `paso` sigue siendo «ponte al día y píntate ya» */
Campo3D.prototype.paso = function (P) { this.actualiza(P); this.dibuja(); };

Campo3D.prototype.selecciona = function (idx) {
  if (!this.aro || idx == null || !this.pos[idx]) {
    if (this.aro && this.aro.visible) { this.aro.visible = false; this._sucio = true; }
    return;
  }
  if (this._sel === idx && this.aro.visible) return;
  this._sel = idx;
  this.aro.position.set(this.pos[idx].x, 0.15, this.pos[idx].z);
  this.aro.visible = true;
  this._sucio = true;
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
    for (var i = 0; i < yo.pos.length; i++) {
      var d = Math.hypot(yo.pos[i].x - pt.x, yo.pos[i].z - pt.z);
      if (d < dmin) { dmin = d; mejor = i; }
    }
    if (mejor >= 0 && dmin < 30) { yo.selecciona(mejor); yo.alSeleccionar(mejor); }
  });
};

/* La cámara se pone FUERA del campo y por encima. Antes salía dentro, entre las filas,
   con medio campo cortado por el borde: se veía un pasillo enorme y no una planta. */
/* Se busca la distancia MÁS CERCANA a la que el campo entero sigue cabiendo, probando
   a proyectar sus ocho esquinas. Con un factor a ojo sobre el radio salía mal por los
   dos lados: con pocos seguidores el campo quedaba diminuto en medio de un descampado,
   y con doscientos se abría la pestaña con media planta fuera de cuadro. Un campo es
   una losa plana, no una esfera: cuánto ocupa depende del ángulo de cámara y de la
   forma del hueco, así que se mide en vez de estimarse. */
Campo3D.prototype.encuadra = function () {
  if (!this.pos || !this.pos.length) return;
  var T = this.THREE, hx = this._ext.x / 2, hz = this._ext.z / 2, hy = 5;
  this.blancoOrbita.set(0, 3, 0);

  var esq = [], sx, sy, sz;
  for (sx = -1; sx <= 1; sx += 2) for (sy = 0; sy <= 1; sy++) for (sz = -1; sz <= 1; sz += 2) {
    esq.push(new T.Vector3(sx * hx, sy * hy, sz * hz));
  }
  var yo = this, v = new T.Vector3();
  function cabe(r) {
    yo.orbita.pon(r);
    yo.camera.updateMatrixWorld();
    for (var i = 0; i < esq.length; i++) {
      v.copy(esq[i]).project(yo.camera);
      if (Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) return false;
    }
    return true;
  }
  var lo = 25, hi = Math.max(90, Math.hypot(hx, hz) * 6);
  if (cabe(hi)) {
    for (var it = 0; it < 20; it++) { var m = (lo + hi) / 2; if (cabe(m)) hi = m; else lo = m; }
  }
  this.orbita.pon(hi);
  this._sucio = true;
};

Campo3D.prototype.redimensiona = function () {
  var w = this.cont.clientWidth || 800, h = this.cont.clientHeight || 480;
  if (w === this._w && h === this._h) return;          /* setSize tira el buffer de dibujo */
  this._w = w; this._h = h;
  this.renderer.setSize(w, h, false);
  this.camera.aspect = w / Math.max(1, h);
  this.camera.updateProjectionMatrix();
  this._sucio = true;
};

/* órbita mínima, el mismo criterio que el gemelo 3D: arrastrar gira, botón
   derecho o shift desplaza, rueda acerca. */
function orbita(dom, cam, blanco, r0, rmin, rmax, T, alMover) {
  var st = { theta: 0.62, phi: 1.02, radius: r0 }, ptr = {}, modo = null;
  alMover = alMover || function () {};
  function clampR(v) { return Math.max(rmin, Math.min(rmax, v)); }
  function aplica() {
    var sp = Math.sin(st.phi), cp = Math.cos(st.phi);
    cam.position.set(blanco.x + st.radius * sp * Math.sin(st.theta),
                     blanco.y + st.radius * cp,
                     blanco.z + st.radius * sp * Math.cos(st.theta));
    cam.lookAt(blanco);
    alMover();                     /* sin esto, girar la cámara no pinta nada */
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
  return { aplica: aplica, radio: function () { return st.radius; },
           pon: function (r) { st.radius = clampR(r); aplica(); } };
}

if (typeof window !== 'undefined') window.Campo3D = Campo3D;
if (typeof module !== 'undefined') module.exports = Campo3D;
})(this);
