/* Guía de uso del simulador. Solo interfaz: no lee ni modifica el motor,
   no emite avisos y no cambia la reproducción. Se monta una sola vez. */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var nav = document.querySelector('.app > nav');
  if (!nav || !document.getElementById('hailPanel') || document.getElementById('simGuiaOpen')) return;

  var style = document.createElement('style');
  style.id = 'simGuiaStyle';
  style.textContent = `
    #simGuiaOpen,#simGuia button{font:600 13px var(--sans,system-ui);cursor:pointer;border-radius:8px;min-height:40px;padding:8px 12px}
    #simGuiaOpen{flex:none;border:1px solid var(--accent,#36d399);color:var(--accent,#36d399);background:var(--card,#0f151d);white-space:nowrap}
    #simGuiaOpen:focus-visible,#simGuia button:focus-visible,#simGuia summary:focus-visible{outline:2px solid var(--accent,#36d399);outline-offset:3px}
    #simGuia{box-sizing:border-box;width:680px;max-width:calc(100vw - 24px);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);padding:0;border:1px solid var(--line2,#32485d);border-radius:14px;background:var(--panel,#121922);color:var(--tx,#e7eef4);font:14px/1.55 var(--sans,system-ui);overflow:auto;overscroll-behavior:contain;box-shadow:0 16px 70px #0009}
    #simGuia::backdrop{background:#03080cba}
    #simGuia .sg-head{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 20px;background:var(--panel,#121922);border-bottom:1px solid var(--line,#23303d)}
    #simGuia h2{font:600 19px var(--display,system-ui);margin:0}
    #simGuia .sg-body{padding:0 20px 18px}
    #simGuia .sg-intro{color:var(--tx2,#a6b4c2);margin:14px 0}
    #simGuia details{border-top:1px solid var(--line,#23303d);padding:12px 0}
    #simGuia summary{cursor:pointer;font-weight:600;color:var(--tx,#e7eef4);padding:3px 0}
    #simGuia details p{margin:10px 0 0;color:var(--tx2,#a6b4c2)}
    #simGuia details b{color:var(--tx,#e7eef4)}
    #simGuia .sg-example{padding:10px 12px;border:1px solid var(--line2,#32485d);border-radius:8px;background:var(--card2,#15212d);color:var(--tx,#e7eef4)}
    #simGuia .sg-note{font-size:12px;color:var(--tx2,#a6b4c2)}
    #simGuia .sg-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
    #simGuia button{background:var(--card2,#15212d);color:var(--tx,#e7eef4);border:1px solid var(--line2,#32485d)}
    #simGuia [data-sg-jump="hail"]{border-color:var(--accent,#36d399);color:var(--accent,#36d399)}
    @media(max-width:760px){
      .app > nav:has(#simGuiaOpen){height:auto;min-height:48px;flex-wrap:wrap;padding-top:7px;padding-bottom:7px;gap:8px 12px}
      .app > nav:has(#simGuiaOpen) > .right{flex-basis:100%;margin-left:0;justify-content:space-between}
      #simGuia .sg-head{padding:12px 14px}#simGuia .sg-body{padding:0 14px 14px}
    }
  `;
  document.head.appendChild(style);

  var trigger = document.createElement('button');
  trigger.id = 'simGuiaOpen';
  trigger.type = 'button';
  trigger.textContent = '? Guía rápida';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'simGuia');
  nav.insertBefore(trigger, nav.querySelector('.right'));

  var dialog = document.createElement('dialog');
  dialog.id = 'simGuia';
  dialog.setAttribute('aria-labelledby', 'simGuiaTitle');
  dialog.innerHTML = `
    <div class="sg-head">
      <h2 id="simGuiaTitle">Guía rápida del simulador</h2>
      <button type="button" id="simGuiaClose" aria-label="Cerrar guía rápida">Cerrar ×</button>
    </div>
    <div class="sg-body">
      <p class="sg-intro">Consulta la ayuda sin salir de la aplicación. Abrirla no modifica la planta ni pausa la simulación; para detener el reloj, usa el botón de pausa.</p>
      <details open>
        <summary>1 · Preparar y observar la planta</summary>
        <p>Elige <b>Emplazamiento</b> y <b>Alimentación y batería</b>. Revisa el número de equipos y pulsa <b>↻ Rehacer planta</b>: reconstruye la simulación, así que úsalo antes del ensayo.</p>
        <p>En <b>Tiempo</b>, empieza a <b>×60</b> y pulsa <b>▶ Simular</b>, o avanza con <b>+1 min</b>. En <b>Campo 3D · escenario</b>, arrastra para girar, usa el botón derecho para desplazar y la rueda para acercar. Un clic en un seguidor lo selecciona.</p>
        <p><b>Planta</b> resume la flota; <b>Detalle del equipo</b> compara objetivo, ángulo real y medido; <b>Mapa Modbus en vivo</b> muestra los registros simulados. El 3D representa el ángulo real del gemelo, no necesariamente el que mide su inclinómetro.</p>
      </details>
      <details>
        <summary>2 · Tu primera prueba de granizo</summary>
        <p>Empieza con viento bajo y sin averías ni forzados. En <b>Granizo</b>, prueba estos valores:</p>
        <p class="sg-example"><b>Viento medio:</b> 3 m/s · <b>Tamaño:</b> 30 mm · <b>Probabilidad:</b> 80 % · <b>ETA:</b> 10 min · <b>Lead:</b> 60 min · <b>Señal +impacto:</b> 15 min · <b>Hold salida:</b> 60 min.</p>
        <p>Pulsa <b>⚡ Emitir / reforecast</b> y deja avanzar la simulación. Mira la ejecución de flota en <b>Planta</b> y la maniobra en <b>Campo 3D</b>. Cambiar los valores del aviso no lo emite: hay que pulsar el botón.</p>
        <p><b>ETA</b> es el tiempo hasta el impacto; <b>Lead</b>, la anticipación de defensa. Con ETA 90 min y Lead 60 min, primero hay vigilancia: faltan 30 minutos simulados para entrar en defensa.</p>
        <p class="sg-note">Valores didácticos, no una consigna de seguridad para una planta real. La orientación y la ejecución dependen de las prioridades y del estado de cada equipo.</p>
      </details>
      <details>
        <summary>3 · Entender los estados y probar averías</summary>
        <p><b>ORDENADO ≠ ACK ≠ MOVIENDO ≠ EN POSICIÓN ≠ PROTEGIDO.</b> Una orden enviada no demuestra que haya llegado ni que se haya completado. Revisa el resumen de flota y el detalle del TCU.</p>
        <p>Repite el ensayo seleccionando un seguidor y activando <b>Eje calado (rotor bloqueado)</b> antes de emitir el aviso. Después prueba <b>Radio propia TCU caída</b> para distinguir un bloqueo mecánico de un fallo de comunicación. Desactiva las averías al terminar; algunas alarmas necesitan el rearme indicado en la aplicación.</p>
      </details>
      <details>
        <summary>4 · Retirar el aviso y guardar resultados</summary>
        <p><b>Retirar aviso</b> no libera inmediatamente: debe cumplirse <b>Hold salida</b>. <b>Sin dato</b> simula falta de información, no fin del peligro. Un aviso válido que reaparece durante la retención cancela la salida.</p>
        <p>Guarda el <b>CSV de la traza</b> en <b>Detalle del equipo</b>. En el mapa Modbus, fija registros con la chincheta para verlos también bajo el campo 3D.</p>
      </details>
      <p class="sg-note"><b>Alcance:</b> este banco simula los equipos y su imagen de registros; no manda órdenes a la planta real. La capa de granizo no inventa un registro Modbus de firmware y su confirmación física pertenece al gemelo, no a una medida de campo.</p>
      <div class="sg-actions">
        <button type="button" data-sg-jump="hail">Ir a los controles de granizo</button>
        <button type="button" data-sg-jump="campo">Ver Campo 3D</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  var closeButton = document.getElementById('simGuiaClose');
  var previousFocus = null, destination = null;

  trigger.addEventListener('click', function () {
    if (dialog.open) return;
    previousFocus = document.activeElement;
    destination = null;
    dialog.showModal();
    dialog.scrollTop = 0;
    closeButton.focus();
  });
  dialog.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var items = Array.from(dialog.querySelectorAll('button, summary, a[href], input, select, textarea, [tabindex]'))
      .filter(function (el) { return !el.disabled && el.tabIndex >= 0 && el.getClientRects().length; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  closeButton.addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) {
    if (event.target !== dialog) return;
    var r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('close', function () {
    var target = null;
    if (destination === 'hail') {
      target = document.getElementById('hailMm');
    } else if (destination === 'campo') {
      target = document.querySelector('.tab[data-v="campo"]');
      if (target) target.click();
    }
    destination = null;
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
      target.focus({ preventScroll: true });
    } else if (previousFocus && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  });
  dialog.querySelectorAll('[data-sg-jump]').forEach(function (button) {
    button.addEventListener('click', function () {
      destination = button.getAttribute('data-sg-jump');
      dialog.close();
    });
  });
})();
