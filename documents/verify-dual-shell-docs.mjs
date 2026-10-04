#!/usr/bin/env node
// verify-dual-shell-docs.mjs — Linter de documentación Markdown con comandos para dos shells (zsh y PowerShell 7).
//
// Qué hace:     Recorre los .md de las carpetas indicadas y comprueba la convención "dual-shell":
//               - cada bloque ```bash/zsh/powershell/pwsh``` va precedido de un marcador
//                 <!-- dual-shell: common -->, <!-- dual-shell: explicit --> o <!-- shell-remoto:... -->;
//               - un bloque "explicit" trae versión zsh Y PowerShell; uno "common" trae un ```text```;
//               - los bloques PowerShell no usan sintaxis POSIX (export, sed, grep, \ al final…) y
//                 los zsh no usan cmdlets/variables de PowerShell ($env:, Get-Content, ` al final…);
//               - cada marcador va seguido de una explicación (**Comandos y opciones:**, **Variables:**…);
//               - cada documento enlaza al fichero de convenciones y tiene una sección "## Glosario".
// Requisitos:   Node.js 16+ (solo módulos nativos).
// Uso:          node verify-dual-shell-docs.mjs docs/runbooks docs/operacion
//               DUAL_SHELL_DOC_ROOTS=docs/a,docs/b node verify-dual-shell-docs.mjs
//               node verify-dual-shell-docs.mjs | jq '.issues[] | select(.reason=="unmarked-shell-block")'
// Variables:    argumentos posicionales      carpetas raíz a revisar (prioridad máxima).
//               DUAL_SHELL_DOC_ROOTS         alternativa: carpetas separadas por comas.
//                                            Si no hay ni argumentos ni variable: docs/operacion,
//                                            docs/runbooks y docs/aprendizaje (relativas al cwd).
//               DUAL_SHELL_CONVENTION_FILE   nombre del fichero de convenciones que cada .md debe
//                                            enlazar (por defecto command-conventions-pwsh-zsh.md).
// Efectos:      SOLO LECTURA.
// Salida:       JSON por stdout: { counts, issueCount, issues: [{ file, line, language, reason, sample }] }.
//               Siempre termina con código 0: revisa issueCount.
import fs from "node:fs";
import path from "node:path";

const argRoots = process.argv.slice(2);
const envRoots = (process.env.DUAL_SHELL_DOC_ROOTS || "").split(",").map((root) => root.trim()).filter(Boolean);
const roots = argRoots.length ? argRoots : envRoots.length ? envRoots : [
  "docs/operacion",
  "docs/runbooks",
  "docs/aprendizaje",
];
const conventionFile = process.env.DUAL_SHELL_CONVENTION_FILE || "command-conventions-pwsh-zsh.md";
// Escapa el nombre para usarlo dentro de una expresión regular.
const conventionFilePattern = conventionFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ignored = new Set(["archive", "backups", "build", "dist", "logs", "node_modules", "vendor", ".terraform"]);

function files(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...files(fullPath));
    if (entry.isFile() && entry.name.endsWith(".md")) result.push(fullPath);
  }
  return result;
}

// Apertura de bloque de código con lenguaje de shell (o text para comandos comunes).
const fence = /^\s*```(bash|sh|shell|zsh|powershell|pwsh|text)\s*$/;
// Cada regla es [motivo, patrón]: si el patrón aparece en un bloque de ese lenguaje, se reporta.
const checks = {
  powershell: [
    ["posix-env", /(^|\n)\s*(export|source)\s+/],
    ["posix-tool", /(^|\n|[|;&]\s*)(sed|awk|grep|cat|find|xargs|head|tail|chmod|sudo|mktemp|du|df|unzip|touch|rmdir|tr|rg|networksetup|scutil|dscacheutil|nc|env|getent|ip|journalctl|systemctl)\b/],
    ["posix-option", /(^|\n|[|;&]\s*)(ls|sort|rm|cp|mv|mkdir|date)\s+-/],
    ["posix-path", /(^|[\s"'])\/tmp\//],
    ["posix-loop", /(^|\n)\s*(for\s+\w+\s+in|while\s+|if\s+\[|case\s+)/],
    ["posix-null", /\/dev\/null/],
    ["posix-continuation", /\\\s*$/m],
    ["posix-shebang", /^#!\/(usr\/bin\/env\s+)?(ba|z)?sh/m],
    ["posix-date", /\$\(date\s+-/],
    ["posix-parameter-expansion", /\$\{[^}\n]+(?:##|%%|#|%)[^}\n]*\}/],
    ["posix-function", /(^|\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{/],
    ["posix-base64", /\bbase64\s+(-d|--decode)\b/],
    ["unquoted-env-string", /(^|\n)\s*\$env:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(arn:|[a-z]{2}-[a-z]+-\d)\S*/],
    ["unix-gradle-wrapper", /(^|\n)\s*\.\/gradlew\b/],
    ["bash-json-escaping", /--filter[^\n]*\\"/],
    ["unexpanded-local-wildcard", /aws\s+s3\s+cp[^\n]*\*/],
    ["bash-heredoc", /<<\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/],
  ],
  zsh: [
    ["pwsh-env", /\$env:/i],
    ["pwsh-cmdlet", /\b(Get-Content|Set-Content|Select-Object|Where-Object|ForEach-Object|ConvertFrom-Json|ConvertTo-Json|Write-Host|Write-Output|Test-Path|New-Item|Remove-Item|Get-ChildItem|Get-Date|Set-Location|Expand-Archive|Join-Path|Get-Location|Get-PSDrive|Get-NetAdapter|Out-File|Out-Null|Resolve-DnsName|Test-NetConnection|Resolve-Path|Add-Type)\b/],
    ["pwsh-assignment", /(^|\n)\s*\$[A-Za-z_][A-Za-z0-9_]*\s*=\s*/],
    ["pwsh-continuation", /`\s*$/m],
    ["pwsh-heredoc", /(^|\n)\s*\$?[A-Za-z_][A-Za-z0-9_]*\s*=\s*@['"]/],
    ["pwsh-loop", /(^|\n)\s*(foreach\s*\(|if\s*\(|while\s*\()/i],
  ],
  text: [
    ["rtk", /(^|[|;&]\s*)rtk\s+/m],
    ["continued-line", /(?:\\|`)\s*$/m],
    ["posix-env", /(^|\n)\s*(export|source)\s+/],
    ["posix-tool", /(^|\n|[|;&]\s*)(ls\s+-|du\b|df\b|find\b|grep\b|sed\b|awk\b|head\b|tail\b|tr\b|rg\b|chmod\b|sudo\b|mktemp\b|unzip\b|touch\b|rmdir\b|networksetup\b|scutil\b|dscacheutil\b|nc\b|env\b|getent\b|ip\b|journalctl\b|systemctl\b|date\s+-)/],
    ["posix-control", /(^|\n)\s*(for\s+\w+\s+in|while\s+|if\s+\[|case\s+|\[\[)/],
    ["posix-null", /\/dev\/null/],
    ["pwsh-env", /\$env:/i],
    ["pwsh-cmdlet", /\b(Get-Content|Set-Content|Select-Object|Where-Object|ForEach-Object|ConvertFrom-Json|ConvertTo-Json|Write-Host|Write-Output|Test-Path|New-Item|Remove-Item|Get-ChildItem|Get-Date|Set-Location|Expand-Archive|Join-Path|Get-Location|Get-PSDrive|Get-NetAdapter|Find-NetRoute|Out-File|Out-Null|Resolve-DnsName|Test-NetConnection|Resolve-Path|Add-Type)\b/],
    ["pwsh-native", /\b(curl\.exe|netsh\s+winhttp|route\s+print)\b/i],
    ["macos-native", /(^|\n|[|;&]\s*)(networksetup|scutil|dscacheutil|nc|env|getent|ip|journalctl|systemctl)\b/],
    ["pwsh-control", /(^|\n)\s*(foreach\s*\(|if\s*\(|while\s*\()/i],
  ],
};

const issues = [];
const counts = { documents: 0, filesWithConvention: 0, bash: 0, sh: 0, shell: 0, zsh: 0, powershell: 0, pwsh: 0, text: 0, commonMarkers: 0, explicitMarkers: 0, explanations: 0, glossaries: 0 };

for (const file of roots.flatMap(files).sort()) {
  const content = fs.readFileSync(file, "utf8");
  counts.documents += 1;
  const isConvention = file.endsWith(conventionFile);
  // Busca un enlace Markdown cuyo texto contenga "convenciones" y apunte al fichero de convenciones.
  const conventionLink = content.match(new RegExp(`\\[[^\\]]*convenciones[^\\]]*\\]\\(([^)]*${conventionFilePattern})\\)`, "i"));
  if (conventionLink) {
    counts.filesWithConvention += 1;
    const target = path.resolve(path.dirname(file), conventionLink[1]);
    if (!fs.existsSync(target)) issues.push({ file, line: 1, language: "markdown", reason: "broken-convention-link" });
  } else if (!isConvention) {
    issues.push({ file, line: 1, language: "markdown", reason: "missing-convention-link" });
  }
  counts.commonMarkers += (content.match(/<!-- dual-shell: common -->/g) ?? []).length;
  counts.explicitMarkers += (content.match(/<!-- dual-shell: explicit -->/g) ?? []).length;
  counts.explanations += (content.match(/\*\*(?:Comandos y opciones|Referencia|Variables|Ejemplo no ejecutable|Descripción|Qu[eé] comprueba|Qu[eé] hace y riesgo|Diferencia(?: respecto al comando anterior| respecto a la consulta inicial de RDS| para (?:TEST|PROD))):\*\*/g) ?? []).length;
  counts.glossaries += (content.match(/^## Glosario$/gm) ?? []).length;
  if (!content.includes("## Glosario")) issues.push({ file, line: 1, language: "markdown", reason: "missing-glossary" });
  if (/macOS zsh y Windows VDI - PowerShell 7 \(mismo comando\)|\*\*macOS - zsh\*\*|\*\*Windows VDI - PowerShell 7\*\*|igual al entrar desde macOS o desde la VDI/.test(content)) {
    issues.push({ file, line: 1, language: "markdown", reason: "long-shell-label" });
  }
  const markerPattern = /<!-- (?:dual-shell: (?:common|explicit)|shell-remoto:[^>]*) -->/g;
  const markerMatches = [...content.matchAll(markerPattern)];
  for (let markerIndex = 0; markerIndex < markerMatches.length; markerIndex += 1) {
    const current = markerMatches[markerIndex];
    const next = markerMatches[markerIndex + 1];
    const chunk = content.slice(current.index, next?.index ?? content.length);
    if (!/\*\*(?:Comandos y opciones|Referencia|Variables|Ejemplo no ejecutable|Descripción|Qu[eé] comprueba|Qu[eé] hace y riesgo|Diferencia(?: respecto al comando anterior| respecto a la consulta inicial de RDS| para (?:TEST|PROD))):\*\*/.test(chunk)) {
      const line = content.slice(0, current.index).split(/\r?\n/).length;
      issues.push({ file, line, language: "markdown", reason: "missing-command-explanation" });
    }
  }
  const lines = content.split(/\r?\n/);
  let activeMarker = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes("<!-- dual-shell: common -->")) {
      if (activeMarker) issues.push({ file, line: activeMarker.line, language: "marker", reason: "incomplete-marker" });
      activeMarker = { kind: "common", line: index + 1, languages: new Set() };
      continue;
    }
    if (lines[index].includes("<!-- dual-shell: explicit -->")) {
      if (activeMarker) issues.push({ file, line: activeMarker.line, language: "marker", reason: "incomplete-marker" });
      activeMarker = { kind: "explicit", line: index + 1, languages: new Set() };
      continue;
    }
    if (lines[index].includes("<!-- shell-remoto:")) {
      if (activeMarker) issues.push({ file, line: activeMarker.line, language: "marker", reason: "incomplete-marker" });
      activeMarker = { kind: "remote", line: index + 1, languages: new Set() };
      continue;
    }
    const match = lines[index].match(fence);
    if (!match) continue;
    const language = match[1];
    const normalizedLanguage = language === "pwsh" ? "powershell" : ["bash", "sh", "shell"].includes(language) ? "zsh" : language;
    const markerKindForFence = activeMarker?.kind ?? null;
    if (activeMarker) {
      activeMarker.languages.add(language === "text" ? "text" : normalizedLanguage);
      const complete =
        (activeMarker.kind === "common" && activeMarker.languages.has("text")) ||
        (activeMarker.kind === "explicit" && activeMarker.languages.has("zsh") && activeMarker.languages.has("powershell")) ||
        (activeMarker.kind === "remote" && activeMarker.languages.has("zsh"));
      if (complete) activeMarker = null;
    } else if (language !== "text" && !file.endsWith(conventionFile)) {
      issues.push({ file, line: index + 1, language, reason: "unmarked-shell-block" });
    }
    counts[language] += 1;
    const startLine = index + 1;
    const body = [];
    index += 1;
    while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    if (index >= lines.length) {
      issues.push({ file, line: startLine, language, reason: "unclosed-fence" });
    }
    const text = body.join("\n");
    const applicableChecks = normalizedLanguage === "text" && markerKindForFence !== "common" ? [] : checks[normalizedLanguage];
    for (const [reason, pattern] of applicableChecks) {
      if (pattern.test(text)) issues.push({ file, line: startLine, language, reason, sample: body.find((line) => line.trim())?.trim().slice(0, 160) ?? "" });
    }
    if (normalizedLanguage === "powershell") {
      const assignedEnvironmentNames = [...text.matchAll(/\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((match) => match[1]);
      for (const name of assignedEnvironmentNames) {
        if (new RegExp(`\\$(?!env:)${name}\\b`).test(text)) {
          issues.push({ file, line: startLine, language, reason: "plain-reference-to-env-variable", sample: name });
        }
      }
      const assignedLocalNames = [...text.matchAll(/(^|\n)\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((match) => match[2]);
      for (const name of assignedLocalNames) {
        if (new RegExp(`\\$${name}_[A-Za-z0-9]`).test(text)) {
          issues.push({ file, line: startLine, language, reason: "ambiguous-variable-interpolation", sample: name });
        }
      }
    }
  }
  if (activeMarker) issues.push({ file, line: activeMarker.line, language: "marker", reason: "incomplete-marker" });
}

console.log(JSON.stringify({ counts, issueCount: issues.length, issues }, null, 2));
