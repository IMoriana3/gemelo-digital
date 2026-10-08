#!/usr/bin/env bash
# CLONAR UN HERMANO POR EL COMMIT DEL PIN (GEM-PUERTA-04)
# ======================================================
# Un solo sitio donde se clona un hermano, y por tanto un solo sitio donde se
# decide CÓMO se autentica. Antes esto estaba escrito dos veces —una en el job
# `arneses` y otra en `navegador`— y duplicar la rutina de credenciales es la
# enfermedad de las ocho copias del rumbo del viento con un disfraz peor: la
# copia que se queda atrás no falla, falla RARO, y el 2026-10-08 ya costó una
# mañana leer un «exit 128» que no decía nada.
#
# POR QUÉ HACE FALTA UN SECRETO. Los pasos originales clonaban con una URL sin
# credenciales. Eso valía mientras los dos hermanos eran PÚBLICOS; el 2026-10-08
# `cobertura-zigbee` pasó a privado y los jobs `arneses` y `navegador` se cayeron
# en TODA PR de este repo y en `main`. Y no lo arregla el token por defecto: el
# `GITHUB_TOKEN` de Actions se limita al repositorio donde corre, que es lo que
# `pines.json` ya tenía escrito para `SolarGPTfull` en `CI_NO_LO_ALCANZA`.
#
#     HERMANOS_RO   secreto del repositorio con acceso de LECTURA a los
#                   hermanos (un PAT de grano fino, o una GitHub App instalada
#                   en todos). Si no está, se intenta sin él: un hermano público
#                   sigue clonándose igual, y eso mantiene el repo usable por
#                   quien no tenga el secreto (un fork, por ejemplo) en vez de
#                   convertir el secreto en un peaje nuevo.
#
# LO QUE NO HACE, Y ES DELIBERADO: si el clon falla, NO sigue adelante ni avisa
# y pasa. Sale con 1 y DICE la causa probable con nombre —hermano privado y
# secreto ausente— porque el modo de fallo caro aquí no es caerse, es caerse sin
# explicar nada. En CI la ausencia de un prerrequisito es un FALLO, no un salto.
#
#     tools/clona_hermano.sh <repo> [<directorio>] [--pines <ruta a pines.json>]
#
# El directorio por defecto es el propio nombre del repo, al lado del cwd, que es
# donde los arneses buscan a los hermanos.
set -euo pipefail

repo=""; destino=""; pines=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pines) pines="$2"; shift 2 ;;
    -*) echo "clona_hermano: opción desconocida «$1»" >&2; exit 2 ;;
    *) if [ -z "$repo" ]; then repo="$1"; else destino="$1"; fi; shift ;;
  esac
done
[ -n "$repo" ] || { echo "uso: clona_hermano.sh <repo> [<dir>] [--pines <ruta>]" >&2; exit 2; }
destino="${destino:-$repo}"
pines="${pines:-pines.json}"
dueno="${OWNER:-imoriana3}"

[ -f "$pines" ] || { echo "clona_hermano: no encuentro $pines" >&2; exit 2; }

# EL COMMIT SALE DE pines.json, SIEMPRE. Pasarlo por argumento habría dejado la
# puerta a que un día alguien llame a esto con «main» y la referencia vuelva a
# moverse sola, que es justo lo que el pin existe para evitar.
sha=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['repos'][sys.argv[2]]['commit'])" "$pines" "$repo")
[ -n "$sha" ] || { echo "clona_hermano: $repo no tiene pin en $pines" >&2; exit 2; }

echo "── $repo → $sha"

git init -q "$destino"
cd "$destino"
git remote add origin "https://github.com/$dueno/$repo.git"

# La credencial va por `http.extraheader`, no incrustada en la URL: en la URL
# acabaría escrita en `.git/config` del clon Y en cualquier traza del remoto.
# Y la forma BASE64 se enmascara a mano: Actions tapa el valor del secreto en el
# log, pero no su codificación — un `set -x` de más la habría enseñado entera.
cabecera=()
if [ -n "${HERMANOS_RO:-}" ]; then
  b64=$(printf 'x-access-token:%s' "$HERMANOS_RO" | base64 -w0)
  echo "::add-mask::$b64"
  cabecera=(-c "http.https://github.com/.extraheader=AUTHORIZATION: basic $b64")
  echo "   (con HERMANOS_RO)"
else
  echo "   (sin secreto: solo funcionará si el hermano es público)"
fi

if ! git "${cabecera[@]}" fetch -q --depth 1 origin "$sha"; then
  echo ""
  echo "✗ NO HE PODIDO CLONAR $repo EN $sha."
  if [ -z "${HERMANOS_RO:-}" ]; then
    echo "  El secreto HERMANOS_RO no está puesto, así que el clon ha ido SIN"
    echo "  credenciales. Si $repo es PRIVADO, esto es exactamente lo esperado:"
    echo "  el GITHUB_TOKEN por defecto se limita al repositorio donde corre y no"
    echo "  alcanza a un hermano privado."
    echo "  Cura: un secreto del repositorio llamado HERMANOS_RO con acceso de"
    echo "  LECTURA a $repo — un PAT de grano fino, o una GitHub App instalada en"
    echo "  los dos. Lo provisiona el mantenedor: no es una decisión técnica, es"
    echo "  dar acceso a un repo privado desde otro."
  else
    echo "  HERMANOS_RO SÍ está puesto, así que no es que falte la credencial:"
    echo "  o no alcanza a $repo (revisa el alcance del PAT o dónde está"
    echo "  instalada la App), o el commit $sha ya no existe en el remoto"
    echo "  (¿historia reescrita?). Las dos son cosas distintas y conviene"
    echo "  distinguirlas antes de tocar el pin."
  fi
  exit 1
fi

git checkout -q FETCH_HEAD

# EL CLON TIENE QUE ESTAR EN EL PIN. Va aquí dentro además de en su paso propio:
# este script es el único que clona, así que es el sitio donde la comprobación no
# se puede saltar por haber llamado al clon de otra manera.
real=$(git rev-parse HEAD)
if [ "$real" != "$sha" ]; then
  echo "✗ el clon de $repo está en $real y el pin dice $sha" >&2
  exit 1
fi
echo "   OK $repo en $real"
