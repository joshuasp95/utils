#!/usr/bin/env bash
set -uo pipefail
# clone-group-repos.sh — clona por SSH todos los proyectos de un grupo de GitLab
#
# Qué hace:     Pide a la API de GitLab la lista de proyectos de un grupo (página a página,
#               100 por página), y clona cada uno en DEST_DIR/<nombre-proyecto>, saltándose
#               los que coincidan con EXCLUDE_PATTERN.
# Requisitos:   bash, curl, jq, git. Clave SSH dada de alta en GitLab (se clona por SSH).
#               Token personal de GitLab con scope read_api.
# Uso:          GITLAB_URL=https://gitlab.example.com GROUP_ID=1234 DEST_DIR=~/src ./clone-group-repos.sh
#               GITLAB_TOKEN=<TOKEN> GITLAB_URL=... GROUP_ID=... EXCLUDE_PATTERN='archive|old' ./clone-group-repos.sh
# Variables:    GITLAB_URL      (obligatoria) URL base de tu GitLab, sin /api/v4.
#               GROUP_ID        (obligatoria) id numérico del grupo (GitLab → grupo → "Group ID")
#                               o su ruta codificada para URL (mi-grupo%2Fsubgrupo).
#               DEST_DIR        (opcional, defecto: directorio actual) dónde se clonan.
#               EXCLUDE_PATTERN (opcional) regex (bash =~); los proyectos cuyo nombre
#                               coincida no se clonan. Vacío = no excluir nada.
#               GITLAB_TOKEN    (opcional) token; si no está definido se pide por teclado
#                               sin mostrarlo (read -s).
# Efectos:      ESCRIBE: crea un directorio por repositorio dentro de DEST_DIR (git clone).
#               En GitLab solo lee.
# Salida:       Mensajes por proyecto en la terminal.

: "${GITLAB_URL:?Define GITLAB_URL (ej: https://gitlab.example.com)}"
: "${GROUP_ID:?Define GROUP_ID (ej: 1234)}"
DEST_DIR="${DEST_DIR:-.}"
EXCLUDE_PATTERN="${EXCLUDE_PATTERN:-}"

# Token: de la variable de entorno o, si no existe, leído en silencio (-s no hace eco, -r no
# interpreta barras invertidas). Nunca se guarda en disco.
if [[ -z "${GITLAB_TOKEN:-}" ]]; then
  read -rs -p "GitLab token: " GITLAB_TOKEN
  echo
fi

mkdir -p "$DEST_DIR"

page=1
while :; do
  # GET /groups/:id/projects → lista JSON de proyectos del grupo.
  #   per_page=100 → máximo permitido por GitLab; page=N → número de página.
  # Cabecera PRIVATE-TOKEN: forma de autenticación con token personal en la API de GitLab.
  # curl -sS: silencioso pero mostrando errores; -f: falla si el HTTP status es >= 400.
  response="$(curl -sSf -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    "$GITLAB_URL/api/v4/groups/$GROUP_ID/projects?per_page=100&page=$page")" || {
    echo "ERROR: fallo al consultar la página $page de la API" >&2
    exit 1
  }

  # Página vacía ([]) → no hay más proyectos.
  [[ "$(jq 'length' <<<"$response")" -eq 0 ]] && break

  # Por cada proyecto: "<path>\t<ssh_url_to_repo>".
  #   .path            → nombre corto del proyecto (último tramo de la URL)
  #   .ssh_url_to_repo → git@host:grupo/proyecto.git
  # (El original sacaba el nombre cortando la URL con cut, lo que fallaba con subgrupos.)
  while IFS=$'\t' read -r name repo; do
    echo "$repo"
    if [[ -n "$EXCLUDE_PATTERN" && "$name" =~ $EXCLUDE_PATTERN ]]; then
      echo "$name excluido (EXCLUDE_PATTERN)"
      continue
    fi
    if git clone "$repo" "$DEST_DIR/$name"; then
      echo "$name cloned!"
    else
      echo "AVISO: no se pudo clonar $name (¿ya existe el directorio?)" >&2
    fi
  done < <(jq -r '.[] | [.path, .ssh_url_to_repo] | @tsv' <<<"$response")

  page=$((page + 1))
done
