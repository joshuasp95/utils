# ai-agents

Hooks, validadores e informes para agentes de IA de terminal: **Claude Code** y **Codex CLI**.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `claude-code/hooks/approval-gate.sh` | Hook `PreToolUse`: bloquea comandos destructivos (`rm -rf`, `git push --force`, `kubectl delete`, `terraform apply`, `DROP TABLE`...) y escrituras en ficheros sensibles, obligando a Claude a pedirte permiso | SOLO LECTURA (decide permitir/bloquear) |
| `claude-code/podcast/validate-podcast.sh` | Valida que un guion en texto plano es apto para lectura en voz alta (Edge Read Aloud): BOM UTF-8, sin Markdown, sin emojis, números en palabras... | SOLO LECTURA |
| `codex/hooks/notify-permission.sh` | Notificación de macOS + pitido cuando Codex espera tu aprobación | SOLO LECTURA (solo notifica) |
| `codex/hooks/notify-stop.sh` | Notificación de macOS + pitido cuando Codex termina el turno | SOLO LECTURA (solo notifica) |
| `sessions-report/generate-report.mjs` | Genera un HTML navegable con el resumen de tus sesiones locales de Codex y Claude Code en un intervalo de fechas | Lee sesiones; ESCRIBE el HTML |
| `sessions-report/validate-report.mjs` | Comprueba el HTML generado (estructura, ausencia de secretos y trazas, JS válido) | SOLO LECTURA |

## Requisitos

- `bash`, `jq` (approval-gate), `python3` y `od` (validate-podcast).
- macOS con `osascript` (hooks de Codex).
- Node.js >= 18 y la CLI `sqlite3` (sessions-report; `sqlite3` solo si usas Codex).

## Variables

| Variable / argumento | Script | Obligatoria | Qué es | Valor por defecto |
|---|---|---|---|---|
| `$1` | `validate-podcast.sh` | Sí | Ruta al guion `.txt` | — |
| `--start` / `REPORT_START` | `generate-report.mjs` | No | Inicio del intervalo (`YYYY-MM-DD`) | hace 90 días |
| `--end` / `REPORT_END` | `generate-report.mjs` | No | Fin del intervalo, incluido | hoy |
| `--output` / `REPORT_OUTPUT` | ambos `.mjs` | No | Ruta del HTML | `./informe-sesiones-ia.html` |
| `CODEX_HOME` | `generate-report.mjs` | No | Carpeta de datos de Codex | `$HOME/.codex` |
| `CLAUDE_HOME` | `generate-report.mjs` | No | Carpeta de datos de Claude Code | `$HOME/.claude` |
| `CODEX_DB` | `generate-report.mjs` | No | SQLite de Codex con la tabla `threads` | `$CODEX_HOME/state_5.sqlite` |
| `REPORT_TZ` | `generate-report.mjs` | No | Zona horaria de las fechas (ej. `Europe/Madrid`) | la del sistema |
| `--expected-cards N` | `validate-report.mjs` | No | Número exacto de fichas esperado | solo exige ≥ 1 |

Los hooks no tienen variables: reciben la información por `stdin` desde el agente.

## Claude Code: registrar `approval-gate.sh` como hook `PreToolUse`

Un **hook** es un comando que Claude Code ejecuta automáticamente en un momento concreto.
`PreToolUse` se dispara **antes** de que Claude use una herramienta (Bash, Write, Edit...). Claude
Code le pasa por `stdin` un JSON como este:

```json
{ "tool_name": "Bash", "tool_input": { "command": "rm -rf build/" } }
```

Si el hook termina con **código 2**, Claude Code cancela la acción y le muestra a Claude lo que el
hook escribió en `stderr`; Claude entonces te pregunta. Con código 0 la acción sigue normal.

1. Copia el script y hazlo ejecutable:

   ```bash
   mkdir -p ~/.claude/hooks
   cp claude-code/hooks/approval-gate.sh ~/.claude/hooks/
   chmod +x ~/.claude/hooks/approval-gate.sh
   ```

   `mkdir -p` crea la carpeta (y las intermedias) sin fallar si ya existe; `chmod +x` da permiso de ejecución.

2. Añade esto a `~/.claude/settings.json` (todos los proyectos) o a `.claude/settings.json` de un
   proyecto. Si ya tienes una clave `hooks`, combina el contenido en lugar de duplicarla:

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Bash|Write|Edit",
           "hooks": [
             { "type": "command", "command": "bash ~/.claude/hooks/approval-gate.sh" }
           ]
         }
       ]
     }
   }
   ```

   Qué es cada clave:

   - `hooks`: objeto con todos los hooks, agrupados por evento.
   - `PreToolUse`: el evento "antes de usar una herramienta". Es una lista de grupos.
   - `matcher`: qué herramientas activan el grupo. Es una regex sobre el nombre de la herramienta:
     `Bash|Write|Edit` = cualquiera de las tres. (También puedes crear un grupo por herramienta con
     `"matcher": "Bash"`, etc.; el efecto es el mismo.)
   - `hooks` (interno): lista de comandos a ejecutar para ese grupo, en orden.
   - `type: "command"`: el hook es un comando de shell (el tipo habitual).
   - `command`: lo que se ejecuta. Se lanza en una shell, así que `~` se expande a tu `$HOME`.
     Poner `bash` delante evita depender del bit de ejecución.

3. Reinicia la sesión de Claude Code (o revisa con `/hooks`) y pruébalo a mano:

   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | ~/.claude/hooks/approval-gate.sh; echo "exit=$?"
   # APPROVAL REQUIRED: git force push detected: ...   exit=2
   ```

   `echo $?` muestra el código de salida del último comando.

## Codex CLI: registrar los hooks de notificación

Codex lee los hooks de `~/.codex/hooks.json`, con el mismo formato que Claude Code:

```json
{
  "hooks": {
    "PermissionRequest": [
      { "matcher": "", "hooks": [ { "type": "command", "command": "<RUTA_ABSOLUTA>/notify-permission.sh" } ] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [ { "type": "command", "command": "<RUTA_ABSOLUTA>/notify-stop.sh" } ] }
    ]
  }
}
```

- `PermissionRequest`: se dispara cuando Codex necesita que apruebes una acción.
- `Stop`: se dispara cuando Codex termina su turno y te devuelve el control.
- `matcher: ""`: cadena vacía = aplica siempre.
- `command`: usa la ruta absoluta del script (p. ej. `<TU_HOME>/.codex/hooks/notify-stop.sh`; `echo $HOME` te dice cuál es tu home)
  y dale permiso de ejecución con `chmod +x`.

La primera vez, Codex te pide **confiar** en cada hook nuevo; al aceptarlo guarda un hash del hook en
`~/.codex/config.toml` (sección `[hooks.state]`). Si cambias el hook, volverá a preguntarte.

Si las notificaciones no aparecen: Ajustes del Sistema → Notificaciones → "Script Editor" (es la app
que muestra las notificaciones de `osascript`) → permitir.

## Ejemplos de uso

```bash
# Validar un guion de podcast (códigos: 0 ok, 1 uso, 2 incumple, 3 ok con avisos)
./claude-code/podcast/validate-podcast.sh ~/podcasts/guion.txt

# Informe de sesiones del último trimestre
node sessions-report/generate-report.mjs --start 2026-07-01 --end 2026-09-30 --output ~/informes/sesiones.html
node sessions-report/validate-report.mjs ~/informes/sesiones.html
```

### Personalizar `generate-report.mjs`

Al principio del fichero hay un objeto `CONFIG` con todo lo que depende de tu forma de trabajar:

- `projectMarkers`: carpetas tras las que va el nombre del proyecto en la ruta de trabajo de la sesión
  (`/home/user/dev/projects/tienda` + marker `projects` → proyecto `tienda`).
- `excludeCodexTitles`: regex de títulos de sesión de Codex que no se incluyen.
- `titleObjectives`: objetivo fijo para sesiones con ese título y sin texto recuperable.
- `topicRules` / `fallbackTopicRules`: reglas "si el mensaje coincide con esta regex → usa este
  resumen". Se evalúan en orden; la primera que coincide gana. `text: ""` descarta el mensaje.

El informe contiene resúmenes de tus conversaciones (se redactan patrones típicos de tokens y claves,
pero no todo). Revísalo antes de compartirlo.
