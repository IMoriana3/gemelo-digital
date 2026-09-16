#!/usr/bin/env node
/* ¿SE HAN MOVIDO LOS HERMANOS DESDE EL PIN? (GEM-PUERTA-02)
   =========================================================
   La puerta clona los repos hermanos POR EL COMMIT DEL PIN, para que el
   veredicto de una PR de aquí no dependa de lo que otro empujó hace un minuto.
   Eso resuelve el blanco móvil y abre el fallo contrario: perder de vista que el
   hermano evoluciona. Los dos están pagados en esta casa —`sync_seguidor.py
   --check` llevaba MESES en rojo diciendo que el modelo iba por detrás de su
   consumidor y no lo miró nadie, y en SolarGPTfull un pin que se movía solo
   atascó tres PRs a la vez—, y son fallos distintos con curas distintas.

   Éste es la cura del segundo, y por eso NO BLOQUEA. Informa, sale con 0
   siempre, y pasarlo a puerta tendrá que ser una decisión y no un descuido: un
   aviso que tumba PRs por un cambio ajeno deja de ser aviso y se vuelve peaje.

   Lo que dice, para cada hermano:
     - cuántos commits lleva la punta por delante del pin;
     - si el pin sigue siendo ANCESTRO de la punta (si no, hubo reescritura de
       historia y mover el pin no es un avance, es otra rama);
     - qué ficheros de los que este repo REALMENTE consume han cambiado.

   Esa última línea es la que lo hace útil. «El hermano tiene 40 commits nuevos»
   no es accionable; «cambió plantas_indice.json, que es de donde sale el
   emparejado layout↔cartera» sí. Nada de esto mueve el pin: eso se hace
   ejecutando los arneses contra el candidato, como dice pines.json.

       node tools/deriva_pines.mjs [--owner imoriana3]
*/
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const i = args.indexOf('--owner');
const OWNER = i >= 0 ? args[i + 1] : 'imoriana3';

/* Lo que este repo consume de cada hermano. No es «todo el repo»: un cambio en
   un fichero que aquí no se lee no es deriva, es ruido — y un vigilante que
   grita por todo se deja de leer, que es como murió el anterior. */
const CONSUMIDO = {
  'proyectos': ['cartera-tabla.html'],
  'cobertura-zigbee': ['plantas_indice.json', '_layout.json'],
  'SolarGPTfull': ['solargpt/solargpt_core/tcu_compare.py',
                   'solargpt/solargpt_core/tcu.py',
                   'solargpt/solargpt_core/tracker.py'],
};

const pines = JSON.parse(readFileSync(join(RAIZ, 'pines.json'), 'utf8'));
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();

const tmp = mkdtempSync(join(tmpdir(), 'gem-deriva-'));
let alDia = 0, movidos = 0, ciegos = 0;
try {
  for (const [repo, meta] of Object.entries(pines.repos)) {
    const pin = meta.commit;
    console.log(`\n── ${repo}`);
    const dir = join(tmp, repo);
    try {
      execFileSync('git', ['init', '-q', dir]);
      git(dir, 'remote', 'add', 'origin', `https://github.com/${OWNER}/${repo}.git`);
      /* Ni `--depth 1` ni clon entero.
         `--depth 1` no traería historia, y entonces «no puedo saber si el pin es
         ancestro» se leería igual que «no ha cambiado» — la mentira cara.
         El clon entero de SolarGPTfull tarda minutos y esto corre en cada PR.
         `--filter=blob:none` trae TODA la historia de commits y árboles y deja
         los contenidos para cuando se pidan: basta para la ancestría, para el
         recuento y para `diff --name-only`, que no mira dentro de los ficheros. */
      git(dir, 'fetch', '-q', '--filter=blob:none', 'origin', 'main');
    } catch (e) {
      /* Un vigilante que no puede mirar lo DICE. Callarlo sería indistinguible
         de «no hay deriva», que es la mentira más cara de las dos. */
      ciegos++;
      console.log('   NO VERIFICABLE — no he podido clonarlo.');
      console.log(`     ${String(e.message).split('\n')[0]}`);
      /* La causa esperada tiene nombre y conviene decirlo: en CI, el
         GITHUB_TOKEN por defecto sólo alcanza al repositorio donde corre, así
         que un hermano PRIVADO no se puede clonar. Aquí pasa con SolarGPTfull.
         Decir «no pude» sin decir «probablemente por esto» deja al que lo lea
         buscando una avería que no existe. */
      console.log('     Si es un repo PRIVADO, es lo esperado en CI: el GITHUB_TOKEN por');
      console.log('     defecto se limita a este repositorio. En local, con acceso, sí se ve.');
      continue;
    }
    const punta = git(dir, 'rev-parse', 'origin/main');
    if (punta === pin) { console.log(`   al día · ${pin.slice(0, 8)}`); alDia++; continue; }

    movidos++;
    let ancestro = true;
    try { git(dir, 'merge-base', '--is-ancestor', pin, punta); } catch { ancestro = false; }

    const n = ancestro ? git(dir, 'rev-list', '--count', `${pin}..${punta}`) : '?';
    console.log(`   pin   ${pin.slice(0, 8)}`);
    console.log(`   punta ${punta.slice(0, 8)}  ·  ${n} commits por delante`);
    if (!ancestro) {
      console.log('   ATENCIÓN: el pin NO es ancestro de la punta — hubo reescritura de');
      console.log('   historia. Mover el pin aquí no sería avanzar, sería cambiar de rama.');
    }

    const tocados = git(dir, 'diff', '--name-only', `${pin}..${punta}`).split('\n').filter(Boolean);
    const nuestros = tocados.filter(f => (CONSUMIDO[repo] || []).some(p => f.includes(p)));
    if (nuestros.length) {
      console.log(`   y ${nuestros.length} de los ficheros que este repo CONSUME han cambiado:`);
      nuestros.slice(0, 12).forEach(f => console.log(`     - ${f}`));
      if (nuestros.length > 12) console.log(`     … y ${nuestros.length - 12} más`);
      console.log('   → merece mirarlo: clona el candidato, corre los arneses CONTRA ÉL,');
      console.log('     y mueve el pin sólo si pasan (el procedimiento está en pines.json).');
    } else {
      console.log('   nada de lo que este repo consume ha cambiado.');
    }
  }

  /* Los ciegos van EN EL RESUMEN, no sólo arriba. «0 al día · 0 movidos» tras no
     haber podido mirar ninguno se lee como «todo en orden», y es el vacío
     contado como verificación. Un vigilante tiene que decir cuánto NO vio. */
  console.log(`\n${alDia} al día · ${movidos} movidos · ${ciegos} no verificables`);
  if (ciegos && !alDia && !movidos) {
    console.log('OJO: no he podido mirar NINGUNO. Esto no es «sin deriva», es «sin datos».');
  }
  console.log('Esto NO bloquea: es un aviso, no una puerta. Ver la cabecera para el porqué.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
/* Salida 0 SIEMPRE, y a propósito. Si algún día esto tiene que parar una PR,
   que sea borrando esta línea con un commit que lo explique. */
process.exit(0);
