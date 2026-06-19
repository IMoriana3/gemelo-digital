/* ============================================================================
 * seguidor.js — FUENTE ÚNICA del seguidor solar (cotas + piezas + materiales)
 * ----------------------------------------------------------------------------
 * La consumen los DOS visores, cada uno a su manera, SIN duplicar la definición:
 *   · Gemelo Digital  -> Seguidor.buildGroup(THREE, {detail:'full'})  (mallas sueltas, 1 ud)
 *   · Cobertura 3D    -> Seguidor.parts(THREE, {detail:'mass'})       (InstancedMesh, 215 ud)
 * Mejorar este archivo (una cota, un material, una pieza) mejora AMBOS.
 * Se sincroniza IDÉNTICO en los dos repos (como zigbee_pv_model.js).
 *
 * MARCO CANÓNICO (local del seguidor):
 *   +X = a lo largo del tubo de par (eje N-S)      Y = arriba      Z = transversal
 *   Basculación del panel = giro sobre X.   Motor del slew sale hacia -Z.
 *   Cada app coloca el seguidor en su mundo con su PROPIA matriz base (orientación
 *   + posición + drape al terreno); el resto del frame del visor no cambia.
 *
 * CONTRATO para renderizar una pieza p en el mundo:
 *   spin=true : M = base · Rx(ángulo) · p.m        (bascula con el tubo)
 *   spin=false: M = base · p.m                      (fija: slew drive)
 *   donde base = matriz de colocación del seguidor (la pone la app) y
 *         Rx(ángulo) = giro de basculación sobre el eje del tubo (X canónica).
 * ==========================================================================*/
(function (root) {
  'use strict';
  var S = {};

  /* ---------- COTAS CANÓNICAS (m) — módulo 1134×2382, cadena de 28 ---------- */
  var D = {
    modW: 1.134, modH: 2.382, gapMod: 0.012, gapDrive: 0.55, modsPerStr: 28,
    off: 0.14,            // cara del módulo sobre el eje del tubo
    tube: 0.12,           // viga de torsión cuadrada 120 mm
    postH: 2.0, filaZ: 3.0,
    purlY: 0.085,         // correas apoyadas sobre el tubo
    jbY: 0.09, jbZ: 0.71, // cajas de conexión bajo el módulo
    tcuX: 1.4,            // TCU desplazada a lo largo del tubo, junto al motor
    antHang: 0.50, antTip: 0.07,   // la antena CUELGA 50 cm vertical desde el conector; la antena en sí (gruesa) mide 7 cm
    medioFactor: 0.504    // el seguidor "Medio" mide ~la mitad
  };
  D.pitch  = D.modW + D.gapMod;
  D.strLen = D.modsPerStr * D.pitch;        // largo de UN ala
  D.span   = 2 * D.strLen + D.gapDrive;     // tubo completo (largo)
  D.mesaC  = D.gapDrive / 2 + D.strLen / 2; // centro de cada ala
  S.DIMS = D;

  /* ---------- MATERIALES (cada app crea los suyos con su THREE) ---------- */
  S.materials = function (THREE) {
    return {
      glass:  new THREE.MeshStandardMaterial({ color:0xffffff, roughness:.14, metalness:.10, emissive:0x0a1626, emissiveIntensity:.07 }),
      frame:  new THREE.MeshStandardMaterial({ color:0xb8c0c8, roughness:.35, metalness:.70 }),
      steel:  new THREE.MeshStandardMaterial({ color:0x9aa3ac, roughness:.45, metalness:.65 }),
      blue:   new THREE.MeshStandardMaterial({ color:0x2f5fb0, roughness:.40, metalness:.40 }),
      motor:  new THREE.MeshStandardMaterial({ color:0x1a1c20, roughness:.50, metalness:.55 }),
      correa: new THREE.MeshStandardMaterial({ color:0x707a85, roughness:.50, metalness:.55 }),
      cable:  new THREE.MeshStandardMaterial({ color:0xc0392b, roughness:.60 }),
      jbox:   new THREE.MeshStandardMaterial({ color:0x101216, roughness:.70 }),
      tcu:    new THREE.MeshStandardMaterial({ color:0x232f3b, roughness:.50, metalness:.30 }),
      silver: new THREE.MeshStandardMaterial({ color:0xaab4be, roughness:.40, metalness:.60 })
    };
  };

  function mT(THREE, x, y, z){ return new THREE.Matrix4().makeTranslation(x, y, z); }
  // catenaria (cable con caída) entre dos puntos locales -> geometría tubular
  function catenary(THREE, a, b, sag, r){
    var mid = a.clone().lerp(b, 0.5); mid.y -= (sag||0.10);
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 12, r||0.012, 6, false);
  }
  // CORREA de perfil OMEGA (sombrero): sección en X-Y extruida a lo largo de Z (ancho del módulo)
  function omegaGeom(TH){   // perfil OMEGA de chapa fina (3 mm), ESTRECHO, 80 cm CENTRADO en la viga, VOLTEADO 180° (corona plana sobre el tubo, alas arriba donde se atornilla el marco)
    var W=0.028, c=0.013, H=0.055, t=0.003, ft=0.003, s=new TH.Shape();
    s.moveTo(-W,0); s.lineTo(-W,ft); s.lineTo(-c-t,ft); s.lineTo(-c-t,H); s.lineTo(c+t,H); s.lineTo(c+t,ft); s.lineTo(W,ft); s.lineTo(W,0);
    s.lineTo(c,0); s.lineTo(c,H-t); s.lineTo(-c,H-t); s.lineTo(-c,0); s.closePath();
    var L=0.80, g=new TH.ExtrudeGeometry(s,{depth:L, bevelEnabled:false}); g.translate(0,0,-L/2); g.rotateX(Math.PI); return g;
  }
  // ABARCÓN (U-bolt) que abraza la viga y fija la correa
  function abarconGeom(TH){   // U-bolt que RODEA la viga: baja por un lado, pasa por DEBAJO del tubo y sube por el otro
    var p=[new TH.Vector3(0,0.10,-0.072), new TH.Vector3(0,-0.072,-0.072), new TH.Vector3(0,-0.088,0), new TH.Vector3(0,-0.072,0.072), new TH.Vector3(0,0.10,0.072)];
    return new TH.TubeGeometry(new TH.CatmullRomCurve3(p), 10, 0.008, 6, false);
  }
  // ABARCÓN de la TCU: ∩ POR ENCIMA de la viga, extremos hacia ABAJO justo hasta la chapa plana de la TCU (que va contra el tubo). Al revés que el de la correa.
  function abarconTcuGeom(TH){
    var p=[new TH.Vector3(0,-0.10,-0.072), new TH.Vector3(0,0.072,-0.072), new TH.Vector3(0,0.088,0), new TH.Vector3(0,0.072,0.072), new TH.Vector3(0,-0.10,0.072)];
    return new TH.TubeGeometry(new TH.CatmullRomCurve3(p), 12, 0.004, 6, false);   // U-bolt M8 (Ø8 mm) y patas que entran por los agujeros de las chapas
  }
  // caja de conexión: 3 por módulo en la LÍNEA CENTRAL (a lo ancho del módulo), pequeñas
  function jboxGeom(TH){ return new TH.BoxGeometry(0.09, 0.04, 0.08); }
  // cable de string LEAPFROG: salta 2 módulos (paso doble). Sección 6 mm² → Ø ~6 mm (radio 0.003)
  function leapCableGeom(TH){ return catenary(TH, new TH.Vector3(-D.pitch, D.jbY-0.02, 0), new TH.Vector3(D.pitch, D.jbY-0.02, 0), 0.12, 0.003); }

  /* ====================================================================
   * PIEZAS de UN tubo (una fila). Devuelve una lista de descriptores:
   *   { key, mat, spin, cast, geom(THREE), m:Matrix4 }
   * opts.size   : 'largo' (2 alas) | 'medio' (1 ala centrada)
   * opts.detail : 'full'  -> módulos uno a uno, correa por hueco, cable
   *                          módulo→módulo, caja por módulo   (GEMELO)
   *               'mass'  -> 1 mesa texturizada por ala + correas repr.
   *                          + canaleta + cajas               (COBERTURA 215 ud)
   * Postes/piers y la disposición en campo los pone CADA app (difieren).
   * ==================================================================== */
  S.parts = function (THREE, opts) {
    opts = opts || {};
    var size   = opts.size   || 'largo';
    var detail = opts.detail || 'full';
    var medio  = (size === 'medio');
    var out = [];
    var push = function (key, mat, spin, cast, geom, m){ out.push({ key:key, mat:mat, spin:spin, cast:cast, geom:geom, m:m }); };

    /* --- TUBO DE PAR (bascula) --- */
    var tubeLen = medio ? D.span * D.medioFactor : D.span;
    push('tube', 'steel', true, true,
      function (TH){ return new TH.BoxGeometry(tubeLen, D.tube, D.tube); }, mT(THREE, 0,0,0));
    // TAPAS NEGRAS en cada extremo de la viga de torsión
    var capX = tubeLen/2 - 0.025, capGeom = function (TH){ return new TH.BoxGeometry(0.06, 0.135, 0.135); };
    push('tubecap', 'jbox', true, true, capGeom, mT(THREE,  capX, 0, 0));
    push('tubecap', 'jbox', true, true, capGeom, mT(THREE, -capX, 0, 0));

    /* --- ALAS: 'medio' = 1 ala centrada en X=0; 'largo' = 2 alas (+X / -X) --- */
    var wings = medio ? [ { dir:+1, edge:-D.strLen/2 } ]                       // centrada
                      : [ { dir:+1, edge:+D.gapDrive/2 }, { dir:-1, edge:-D.gapDrive/2 } ];

    wings.forEach(function (w) {
      // X del centro del módulo m (0..27) y del borde b (0..28) del ala
      var modX = function (m){ return w.edge + w.dir * (m + 0.5) * D.pitch; };
      var brdX = function (b){ return w.edge + w.dir * b * D.pitch; };
      var wingC = w.edge + w.dir * D.strLen / 2;   // centro del ala

      if (detail === 'full') {
        /* módulos uno a uno: marco + vidrio + caja; CORREAS solo en los HUECOS entre módulos (n+1), perfil OMEGA + abarcón; cable módulo→módulo */
        for (var b = 0; b <= D.modsPerStr; b++) {
          var bx = w.edge + w.dir * b * D.pitch;
          push('correa', 'correa', true, false, omegaGeom, mT(THREE, bx, 0.115, 0));     // correa omega (corona plana sobre el tubo; las alas suben hasta el marco, ahí se atornilla)
          push('abarcon', 'silver', true, false, abarconGeom, mT(THREE, bx, 0, 0));      // U-bolt que la fija a la viga
        }
        var jbX = D.modW/6;                                 // 3 cajas por módulo en la LÍNEA CENTRAL (z=0), repartidas a lo ANCHO: a 1/3, 1/2 y 2/3
        for (var m = 0; m < D.modsPerStr; m++) {
          var cx = modX(m);
          push('frame', 'frame', true, true,
            function (TH){ return new TH.BoxGeometry(D.modW, 0.05, D.modH); }, mT(THREE, cx, D.off, 0));          // marco perimetral
          push('glass', 'glass', true, true,
            function (TH){ return new TH.BoxGeometry(D.modW-0.04, 0.06, D.modH-0.04); }, mT(THREE, cx, D.off, 0)); // BIFACIAL
          push('jbox', 'jbox', true, false, jboxGeom, mT(THREE, cx-jbX, D.jbY, 0));   // caja a 1/3 del ancho (saca cable)
          push('jbox', 'jbox', true, false, jboxGeom, mT(THREE, cx,     D.jbY, 0));   // caja central
          push('jbox', 'jbox', true, false, jboxGeom, mT(THREE, cx+jbX, D.jbY, 0));   // caja a 2/3 del ancho (saca cable)
        }
        // CABLEADO LEAPFROG (salto de rana): cada cable salta 2 módulos a lo largo de la cadena (eje X), junto a la línea central; 6 mm²
        for (var c = 0; c <= D.modsPerStr - 3; c++) {
          var even = (c % 2 === 0);
          push(even?'cablepos':'cableneg', even?'cable':'jbox', true, false, leapCableGeom, mT(THREE, modX(c+1), 0, even?0.05:-0.05));
        }
      } else {
        /* 'mass': 1 MESA por ala (textura de células) + correas repr. + canaleta + cajas */
        push('mesa', 'glass', true, true,
          function (TH){ return new TH.BoxGeometry(D.strLen, 0.05, D.modH); }, mT(THREE, wingC, D.off, 0));
        var NPUR = 8;                                       // correas representativas por ala
        for (var i = 0; i < NPUR; i++) {
          var px = w.edge + w.dir * (i + 0.5) * (D.strLen / NPUR);
          push('correa', 'correa', true, false,
            function (TH){ return new TH.BoxGeometry(0.05, 0.05, D.modH*0.96); }, mT(THREE, px, D.purlY, 0));
        }
        push('cable', 'cable', true, false,                 // canaleta de string a lo largo del ala
          function (TH){ return new TH.BoxGeometry(D.strLen*0.94, 0.05, 0.035); }, mT(THREE, wingC, D.jbY-0.02, D.jbZ));
        for (var j = 0; j < 3; j++) {                       // 3 cajas por ala
          var jx = w.edge + w.dir * (j + 0.5) * (D.strLen / 3);
          push('jbox', 'jbox', true, false,
            function (TH){ return new TH.BoxGeometry(0.16, 0.05, 0.10); }, mT(THREE, jx, D.jbY, D.jbZ));
        }
      }
    });

    /* --- TCU colgada del tubo (bascula con él). Se dibuja con su MODELO real tcu.glb; aquí el sillín de fijación + abarcones. --- */
    push('tcu', 'tcu', true, true,
      function (TH){ return new TH.BoxGeometry(0.50, 0.26, 0.36); }, mT(THREE, D.tcuX, -0.22, 0));
    // CHAPAS / sillín de fijación bajo la viga: chapa plana contra el tubo por la que el abarcón M8 entra y aprieta
    var tcuChapa = function (TH){ return new TH.BoxGeometry(0.05, 0.012, 0.21); };
    push('tcuchapa', 'steel', true, true, tcuChapa, mT(THREE, D.tcuX-0.13, -0.067, 0));
    push('tcuchapa', 'steel', true, true, tcuChapa, mT(THREE, D.tcuX+0.13, -0.067, 0));
    push('tcuabarcon', 'silver', true, false, abarconTcuGeom, mT(THREE, D.tcuX-0.135, 0, 0));   // DOS abarcones M8 (∩ sobre la viga) que entran por las pestañas REALES del glb (asimétricas: lado conectores y el otro)
    push('tcuabarcon', 'silver', true, false, abarconTcuGeom, mT(THREE, D.tcuX+0.047, 0, 0));

    /* --- SLEW DRIVE en el centro del tubo (FIJO: no bascula; el tubo gira dentro) --- */
    out.push({ key:'corona', mat:'blue', spin:false, cast:true, twin:true,   // corona slew; TWIN: también en la viga GEMELA (la del eje de transmisión, sin motor)
      geom:function (TH){ var g=new TH.CylinderGeometry(0.25,0.25,0.16,24); g.rotateZ(Math.PI/2); return g; }, m:mT(THREE, 0,0,0) });
    push('reductora', 'blue', false, true,                  // cuerpo de la reductora (worm)
      function (TH){ return new TH.BoxGeometry(0.30,0.36,0.26); }, mT(THREE, 0,-0.04,0));
    push('cuello', 'blue', false, true,                     // cuello reductora → motor
      function (TH){ var g=new TH.CylinderGeometry(0.06,0.06,0.12,14); g.rotateX(Math.PI/2); return g; }, mT(THREE, 0,-0.04,-0.20));
    push('motor', 'motor', false, true,                     // MOTOR horizontal saliendo hacia -Z
      function (TH){ var g=new TH.CylinderGeometry(0.085,0.085,0.40,18); g.rotateX(Math.PI/2); return g; }, mT(THREE, 0,-0.04,-0.46));
    push('tapa', 'blue', false, true,                       // tapa del motor
      function (TH){ var g=new TH.CylinderGeometry(0.092,0.092,0.05,18); g.rotateX(Math.PI/2); return g; }, mT(THREE, 0,-0.04,-0.68));
    push('motorcable', 'jbox', false, true,                 // cable de potencia al motor: NEGRO, sale de la reductora hasta el motor
      function (TH){ return new TH.TubeGeometry(new TH.CatmullRomCurve3([new TH.Vector3(0.13,-0.12,-0.13), new TH.Vector3(0.07,-0.16,-0.26), new TH.Vector3(0,-0.06,-0.40)]),10,0.006,6,false); }, mT(THREE, 0,0,0));
    // SOPORTE de la corona: poste ROBUSTO hasta el suelo (terrainScaled: la app lo estira desde la corona al terreno)
    out.push({ key:'bracket', mat:'steel', spin:false, cast:true, twin:true,   // saddle/bracket que une el poste a la corona (como el render); TWIN: en ambas vigas
      geom:function (TH){ return new TH.BoxGeometry(0.36, 0.16, 0.48); }, m:mT(THREE, 0,-0.20,0) });
    out.push({ key:'soporte', mat:'steel', spin:false, cast:true, terrainScaled:true, twin:true,   // poste galvanizado del soporte; TWIN: igual bajo la corona de la viga gemela
      geom:function (TH){ return new TH.BoxGeometry(0.22, 1.0, 0.32); }, m:mT(THREE, 0,-0.6,0) });
    // ANTENA de la TCU: cuelga VERTICAL hacia el suelo y queda a ~30 cm del suelo. La app la
    // estira (su longitud depende de la altura/terreno) y la mantiene VERTICAL aunque el tubo bascule.
    out.push({ key:'antena', mat:'jbox', spin:true, cast:true, antenna:true,        // CABLE de antena (coax): FINO ~Ø4,4 mm; la app lo cuelga vertical desde la TCU
      geom:function (TH){ return new TH.CylinderGeometry(0.0022,0.0022,1.0,6); }, m:mT(THREE, D.tcuX-0.16, -0.225, 0) });
    out.push({ key:'antenatip', mat:'jbox', spin:true, cast:true, antenna:true, tip:true,   // la ANTENA en sí: ~Ø12 mm, 7 cm en el extremo de abajo
      geom:function (TH){ return new TH.CylinderGeometry(0.006,0.006,1.0,8); }, m:mT(THREE, D.tcuX-0.16, -0.225, 0) });

    // CABLE MOTOR → TCU: del conector del motor (FIJO, en el slew) al conector de motor de la TCU (BASCULA con el tubo).
    // Cruza el límite spin/estático: extremo 'a' estático, extremo 'b' gira con el tubo. La app calcula ambos extremos
    // en el mundo por frame y orienta este cilindro unitario (alto 1, eje Y) entre ellos.
    out.push({ key:'motorlink', mat:'jbox', spin:false, cast:true, motorLink:true,   // cable de motor: NEGRO, 6 mm² (Ø~7 mm), del conector del motor (fijo) al conector de la TCU (bascula)
      a:[0,-0.06,-0.40], b:[D.tcuX-0.165,-0.11,0.045],
      geom:function (TH){ return new TH.CylinderGeometry(0.0035,0.0035,1,6); }, m:mT(THREE, 0,0,0) });

    // AMORTIGUADORES (2 por viga): pie FIJO al PENÚLTIMO poste (N y S), otro extremo en la viga (bascula). Cruzan
    // spin/estático -> la app los orienta por frame entre 'a' y 'b'. La X de los postes la pone CADA app (sus retículas
    // difieren) vía opts.damperX = [xNorte, xSur]; si no se pasa, se estima a partir del largo del tubo.
    var dampXs = opts.damperX; if (!dampXs) { var dd = Math.min(24, tubeLen/2 - 5); dampXs = [-dd, dd]; }
    dampXs.forEach(function (dx) {
      out.push({ key:'damper', mat:'motor', spin:false, cast:true, damperLink:true,
        a:[dx,-0.95,0.10], b:[dx,-0.15,0.28],
        geom:function (TH){ return new TH.CylinderGeometry(0.022,0.022,1,10); }, m:mT(THREE, 0,0,0) });   // = vástago FINO; la app le añade un cuerpo más grueso (body+rod, como el gemelo)
    });

    return out;
  };

  /* ====================================================================
   * CONVENIENCIA PARA EL GEMELO: construye mallas sueltas.
   * Devuelve { spin, static } (dos THREE.Group): la app rota 'spin' con el
   * ángulo de basculación y deja 'static' fijo. Comparten materiales.
   * ==================================================================== */
  S.buildGroup = function (THREE, opts) {
    opts = opts || {};
    var mats = opts.materials || S.materials(THREE);
    var spin = new THREE.Group(), stat = new THREE.Group();
    S.parts(THREE, opts).forEach(function (p) {
      if (p.motorLink || p.damperLink) return;   // enlaces (cable motor / amortiguadores): cruzan spin/estático; los gestiona la app por frame
      var mesh = new THREE.Mesh(p.geom(THREE), mats[p.mat]);
      mesh.applyMatrix4(p.m);
      mesh.castShadow = !!p.cast; mesh.receiveShadow = true;
      (p.spin ? spin : stat).add(mesh);
    });
    return { spin: spin, static: stat, dims: D };
  };

  /* ====================================================================
   * CONVENIENCIA PARA EL GEMELO (bifila): construye UNA viga del tracker como
   * mallas sueltas, resolviendo la lógica oeste/este/twin de la fuente:
   *   opts.west=true  -> viga del MOTOR: todo (módulos, correas, slew completo,
   *                      TCU + abarcones + chapas + antena).
   *   opts.west=false -> viga GEMELA (eje de transmisión): módulos/correas/etc.
   *                      + SOLO las piezas twin del slew (corona, bracket, soporte).
   * Devuelve { spin, static, modCols }: 'spin' bascula (rotation.x), 'static'
   * fija (slew); 'modCols' = centros de módulo {x,z} (p.ej. para capas de nieve).
   * ==================================================================== */
  S.buildBeam = function (THREE, opts) {
    opts = opts || {};
    var mats = opts.materials || S.materials(THREE);
    var west = opts.west !== false;
    var skip = opts.skip || {};
    var WEST = { tcu:1, tcuabarcon:1, tcuchapa:1, antena:1, antenatip:1, motorlink:1 };
    var spin = new THREE.Group(), stat = new THREE.Group(), modCols = [], dampers = [];
    S.parts(THREE, { size:opts.size||'largo', detail:opts.detail||'full' }).forEach(function (p) {
      if (p.motorLink) return;                                   // cable motor↔TCU: lo gestiona la app por frame (pendiente)
      if (p.damperLink) { dampers.push({ a:p.a, b:p.b }); return; }   // amortiguadores: en AMBAS vigas; render per-frame en la app
      if (skip[p.key]) return;
      if (!west && (WEST[p.key] || p.antenna)) return;           // TCU/antena/abarcón-TCU/chapa: solo viga oeste
      if (!west && !p.spin && !p.twin) return;                   // slew completo solo oeste; en la gemela solo piezas twin
      var mesh = new THREE.Mesh(p.geom(THREE), mats[p.mat]);
      mesh.applyMatrix4(p.m);
      mesh.castShadow = !!p.cast; mesh.receiveShadow = true;
      (p.spin ? spin : stat).add(mesh);
      if (p.key === 'frame') modCols.push({ x:p.m.elements[12], z:p.m.elements[14] });
    });
    return { spin: spin, static: stat, modCols: modCols, dampers: dampers, dims: D };
  };

  /* ====================================================================
   * CONVENIENCIA PARA COBERTURA (instanciado). Agrupa las piezas por tipo
   * (geometría+material) para que la app cree UN InstancedMesh por tipo y
   * coloque N copias. Las 'spin' se rematrizan por frame; las fijas, una vez.
   *   plan = Seguidor.instancePlan(THREE, {detail:'mass', size:'largo'})
   *   -> [{ key, mat, geom, spin, cast, locals:[Matrix4,...] }]
   * La app: por cada tracker t y cada local L -> setMatrixAt(base_t · (spin?Rx:1) · L)
   * ==================================================================== */
  S.instancePlan = function (THREE, opts) {
    var byType = {}, order = [];
    S.parts(THREE, opts).forEach(function (p) {
      if (!byType[p.key]) { byType[p.key] = { key:p.key, mat:p.mat, geom:p.geom, spin:p.spin, cast:p.cast, terrainScaled:!!p.terrainScaled, twin:!!p.twin, antenna:!!p.antenna, tip:!!p.tip, motorLink:!!p.motorLink, damperLink:!!p.damperLink, a:p.a, b:p.b, as:[], bs:[], locals:[] }; order.push(p.key); }
      byType[p.key].locals.push(p.m);
      if (p.a) byType[p.key].as.push(p.a);
      if (p.b) byType[p.key].bs.push(p.b);
    });
    return order.map(function (k){ return byType[k]; });
  };

  S.VERSION = '0.4.4';
  root.Seguidor = S;
})(typeof window !== 'undefined' ? window : this);
