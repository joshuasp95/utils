#!/usr/bin/env bash
set -euo pipefail
# approval-gate.sh — hook PreToolUse de Claude Code que bloquea operaciones destructivas
#
# Qué hace:     Claude Code le pasa por stdin (JSON) la herramienta que va a usar y sus
#               argumentos. Si es un comando Bash destructivo (rm -rf, git push --force,
#               kubectl delete, terraform apply, DROP TABLE...) o una escritura en un
#               fichero sensible (.env, *.pem, kubeconfig...), sale con código 2: Claude
#               NO ejecuta la acción, ve el mensaje de stderr y te pide confirmación.
# Requisitos:   bash, jq, grep con -E. Registrado como hook PreToolUse en settings.json
#               (ver README.md de esta carpeta).
# Uso:          Lo invoca Claude Code automáticamente. Prueba manual:
#               echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}' | ./approval-gate.sh; echo $?
# Variables:    Ninguna. Entrada JSON por stdin con .tool_name, .tool_input.command
#               (herramienta Bash) y .tool_input.file_path (Write/Edit).
# Efectos:      SOLO LECTURA (solo decide si se permite o no la acción).
# Salida:       Código 0 = permitir; código 2 + mensaje en stderr = bloquear y preguntar.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
CMD=$(echo  "$INPUT" | jq -r '.tool_input.command // empty')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

block() {
  echo "APPROVAL REQUIRED: $1" >&2
  echo "Tell me explicitly to proceed and I will retry the action." >&2
  exit 2
}

# ── Bash: destructive command patterns ──────────────────────────────────────
if [[ "$TOOL" == "Bash" && -n "$CMD" ]]; then

  # Filesystem destruction
  echo "$CMD" | grep -qiE '(^|[;&|])\s*rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s' \
    && block "rm -rf detected: '$CMD'"

  echo "$CMD" | grep -qiE '(^|[;&|])\s*rm\s+-[a-zA-Z]*r\s' \
    && block "recursive rm detected: '$CMD'"

  # Git destructive ops
  echo "$CMD" | grep -qiE 'git\s+(push\s+.*(-f|--force)|push\s+-f)' \
    && block "git force push detected: '$CMD'"

  echo "$CMD" | grep -qiE 'git\s+reset\s+--hard' \
    && block "git reset --hard detected: '$CMD'"

  echo "$CMD" | grep -qiE 'git\s+clean\s+(-[a-zA-Z]*f)' \
    && block "git clean -f detected: '$CMD'"

  echo "$CMD" | grep -qiE 'git\s+(checkout|restore)\s+(\.|--\s*\.)' \
    && block "git checkout/restore . (discard all changes) detected: '$CMD'"

  echo "$CMD" | grep -qiE 'git\s+branch\s+-D' \
    && block "git branch -D (force delete) detected: '$CMD'"

  # Kubernetes destructive
  echo "$CMD" | grep -qiE 'kubectl\s+(delete|drain|cordon)\s' \
    && block "kubectl destructive op detected: '$CMD'"

  # Terraform apply/destroy
  echo "$CMD" | grep -qiE '(^|[;&|])\s*(tf|terraform)\s+(apply|destroy)' \
    && block "terraform apply/destroy detected: '$CMD'"

  # Docker destructive
  echo "$CMD" | grep -qiE 'docker\s+(rm\s+-f|system\s+prune|rmi\s+-f|network\s+prune|volume\s+prune)' \
    && block "docker destructive op detected: '$CMD'"

  # AWS mutating/deleting
  echo "$CMD" | grep -qiE 'aws\s+[a-z0-9-]+\s+(delete|terminate|destroy|remove|disassociate|detach|revoke)' \
    && block "AWS mutating operation detected: '$CMD'"

  # Database DDL (inline SQL)
  echo "$CMD" | grep -qiE '(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)' \
    && block "destructive SQL statement detected: '$CMD'"

fi

# ── Write/Edit: sensitive file paths ────────────────────────────────────────
if [[ "$TOOL" =~ ^(Write|Edit)$ && -n "$FILE" ]]; then

  echo "$FILE" | grep -qiE '(\.env|\.env\.[a-z]+|secrets?\.[a-z]+|credentials|kubeconfig|id_rsa|id_ed25519|\.pem|\.key)$' \
    && block "write to sensitive file detected: '$FILE'"

fi

exit 0
