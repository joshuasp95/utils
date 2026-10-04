# git

Utilidades para trabajar con repositorios Git y plataformas como GitLab.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `gitlab/clone-group-repos.sh` | Clona por SSH los proyectos de un grupo de GitLab, con paginación y exclusión por regex | ESCRIBE: crea un directorio por repo en `DEST_DIR`. En GitLab solo lee |

## Requisitos

- `bash`, `curl`, `jq`, `git`.
- Clave SSH registrada en tu usuario de GitLab (el clonado usa `ssh_url_to_repo`).
- Token personal de GitLab (User Settings → Access Tokens) con scope `read_api`.

## Variables

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `GITLAB_URL` | Sí | URL base de GitLab, sin `/api/v4` | La URL con la que entras en GitLab |
| `GROUP_ID` | Sí | Id numérico del grupo, o su ruta codificada (`grupo%2Fsubgrupo`) | Página del grupo → botón de copiar "Group ID" |
| `DEST_DIR` | No (`.`) | Carpeta donde se clonan los repos | Tú eliges |
| `EXCLUDE_PATTERN` | No (vacío) | Regex: los proyectos cuyo nombre coincida no se clonan | Ej. `archive\|legacy` |
| `GITLAB_TOKEN` | No | Token; si no existe se pide por teclado sin mostrarlo | Access Tokens de GitLab |

## Uso

```bash
GITLAB_URL=https://gitlab.example.com GROUP_ID=1234 DEST_DIR=~/src/mi-grupo \
  EXCLUDE_PATTERN='archive|old' ./gitlab/clone-group-repos.sh
```

- `VAR=valor ./script.sh`: define la variable solo para esa ejecución.
- Sin `GITLAB_TOKEN`, el script pregunta `GitLab token:` y no muestra lo que escribes (`read -s`).
- Por dentro llama a `GET /api/v4/groups/<GROUP_ID>/projects?per_page=100&page=N` hasta recibir
  una página vacía. No incluye proyectos de subgrupos (eso requeriría `include_subgroups=true`).
- Si un directorio de destino ya existe, `git clone` falla para ese repo, se avisa y se sigue con el resto.
