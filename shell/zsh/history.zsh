# history.zsh — historial de zsh grande, compartido entre terminales y con backups automáticos
#
# Qué hace:     1) Configura un historial persistente grande (300k líneas en memoria, 200k en
#                  disco) con marca de tiempo y compartido en vivo entre todas las terminales.
#               2) Al abrir una shell interactiva, carga también el ~/.zsh_history clásico si
#                  usas un fichero distinto, para no "perder" el historial antiguo.
#               3) Hace copias de seguridad del historial cada 6 h o cada 500 líneas nuevas
#                  (lo que ocurra antes), comprobándolo como mucho cada 15 min.
# Requisitos:   zsh 5+. Nada externo (usa los módulos zsh/datetime y add-zsh-hook).
# Uso:          source /ruta/a/utils/shell/zsh/history.zsh   (desde ~/.zshrc)
#               o copiarlo a $ZSH_CUSTOM/05-history.zsh si usas Oh My Zsh.
# Variables:    ZSH_PERSISTENT_HISTORY_FILE  fichero de historial (defecto: ~/.zsh_history_persistent).
#               ZSH_HISTORY_BACKUP_DIR       carpeta de backups (defecto: ~/.zsh_history_backups).
#               ZSH_HISTORY_BACKUP_CHECK_INTERVAL_SECONDS  cada cuánto se comprueba (defecto: 900 = 15 min).
#               ZSH_HISTORY_BACKUP_INTERVAL_SECONDS        backup si pasó este tiempo (defecto: 21600 = 6 h).
#               ZSH_HISTORY_BACKUP_MIN_LINE_DELTA          backup si hay estas líneas nuevas (defecto: 500).
#               Defínelas ANTES de cargar este fichero para cambiarlas.
# Efectos:      ESCRIBE en local: el fichero de historial y copias en ZSH_HISTORY_BACKUP_DIR.
#               Los backups no se rotan: bórralos a mano de vez en cuando.
# Salida:       Ninguna por pantalla.

# ── Tamaño y fichero ─────────────────────────────────────────────────────────
# HISTSIZE = líneas que se guardan en memoria; SAVEHIST = líneas que se escriben en disco.
HISTFILE="${ZSH_PERSISTENT_HISTORY_FILE:-$HOME/.zsh_history_persistent}"
HISTSIZE=300000
SAVEHIST=200000

# ── Comportamiento ───────────────────────────────────────────────────────────
setopt extended_history       # guarda fecha y duración de cada comando (": <epoch>:<seg>;cmd")
setopt append_history         # añade al fichero en lugar de sobrescribirlo al cerrar
setopt share_history          # las terminales abiertas comparten historial en vivo
setopt hist_expire_dups_first # al llegar al límite, borra primero los duplicados
setopt hist_ignore_dups       # no guarda un comando igual al inmediatamente anterior
setopt hist_ignore_space      # no guarda comandos que empiezan por espacio (útil para secretos)
setopt hist_verify            # al expandir !!/!$ muestra el comando antes de ejecutarlo
setopt hist_save_by_copy      # escribe en un temporal y lo renombra: evita corromper el fichero

# Carga inicial: fc -R lee un fichero de historial; -I solo añade entradas nuevas (sin duplicar).
if [[ -o interactive && -r "$HISTFILE" ]]; then
  fc -RI "$HISTFILE"
  # Si usas un fichero propio, importa también el ~/.zsh_history por defecto de zsh.
  if [[ "$HISTFILE" != "$HOME/.zsh_history" && -r "$HOME/.zsh_history" ]]; then
    fc -RI "$HOME/.zsh_history"
  fi
fi

# ── Backups automáticos ──────────────────────────────────────────────────────
ZSH_HISTORY_BACKUP_DIR="${ZSH_HISTORY_BACKUP_DIR:-$HOME/.zsh_history_backups}"
ZSH_HISTORY_BACKUP_CHECK_INTERVAL_SECONDS="${ZSH_HISTORY_BACKUP_CHECK_INTERVAL_SECONDS:-900}"
ZSH_HISTORY_BACKUP_INTERVAL_SECONDS="${ZSH_HISTORY_BACKUP_INTERVAL_SECONDS:-21600}"
ZSH_HISTORY_BACKUP_MIN_LINE_DELTA="${ZSH_HISTORY_BACKUP_MIN_LINE_DELTA:-500}"

# zsh/datetime aporta $EPOCHSECONDS (hora actual en segundos) sin lanzar `date`.
zmodload zsh/datetime 2>/dev/null

# Se ejecuta antes de cada prompt (hook precmd). Sale enseguida si aún no toca comprobar,
# así que no ralentiza la shell.
_zsh_history_backup_maybe() {
  emulate -L zsh                 # opciones zsh estándar solo dentro de la función
  setopt local_options no_unset

  [[ -n "${EPOCHSECONDS:-}" ]] || return 0
  (( EPOCHSECONDS < ${_ZSH_HISTORY_BACKUP_NEXT_CHECK:-0} )) && return 0
  typeset -gi _ZSH_HISTORY_BACKUP_NEXT_CHECK=$(( EPOCHSECONDS + ZSH_HISTORY_BACKUP_CHECK_INTERVAL_SECONDS ))

  [[ -r "$HISTFILE" ]] || return 0
  mkdir -p "$ZSH_HISTORY_BACKUP_DIR" 2>/dev/null || return 0

  # El fichero de estado guarda "<epoch del último backup> <líneas en ese momento>".
  local state_file="$ZSH_HISTORY_BACKUP_DIR/.state-persistent"
  local last_ts=0 last_lines=0 current_lines line_delta stamp backup_file

  if [[ -r "$state_file" ]]; then
    read -r last_ts last_lines < "$state_file"
  fi

  current_lines="$(wc -l < "$HISTFILE" 2>/dev/null)"
  current_lines="${current_lines//[[:space:]]/}"
  [[ "$current_lines" == <-> ]] || return 0      # <-> = patrón zsh para "entero positivo"

  line_delta=$(( current_lines - last_lines ))
  (( line_delta < 0 )) && line_delta="$current_lines"   # el historial se truncó: cuenta todo

  if (( EPOCHSECONDS - last_ts >= ZSH_HISTORY_BACKUP_INTERVAL_SECONDS || line_delta >= ZSH_HISTORY_BACKUP_MIN_LINE_DELTA )); then
    stamp="$(command date +%Y%m%d-%H%M%S)"
    backup_file="$ZSH_HISTORY_BACKUP_DIR/.zsh_history.persistent.$stamp"
    cp -p "$HISTFILE" "$backup_file" 2>/dev/null || return 0   # -p conserva permisos y fechas
    print -r -- "$EPOCHSECONDS $current_lines" >| "$state_file"
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd _zsh_history_backup_maybe
