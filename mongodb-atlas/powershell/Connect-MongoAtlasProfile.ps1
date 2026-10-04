# Connect-MongoAtlasProfile.ps1 — atajos de PowerShell para conectar con mongosh a clusters Atlas por alias.
#
# Qué hace:     Define un catálogo de clusters ($script:MongoAtlasTargets: alias → proyecto,
#               cluster, entorno, hostname privado y público) y funciones para listarlos,
#               construir su URI mongodb+srv:// y abrir mongosh contra ellos.
#               Por defecto usa el hostname PRIVADO (Private Link / private endpoint);
#               con -Standard usa el hostname público.
# Requisitos:   PowerShell 5.1+ o 7+, mongosh en el PATH.
# Uso:          Cargar en la sesión (dot-sourcing):  . "$HOME\mongo\Connect-MongoAtlasProfile.ps1"
#               O pegar el contenido en $PROFILE para tenerlo siempre:
#                 New-Item -ItemType Directory -Force -Path (Split-Path $PROFILE)
#                 notepad $PROFILE
#               Después:
#                 mat                              # lista los alias (Get-MongoAtlasTargets)
#                 mshow app1-dev                   # detalle de un alias
#                 muri app1-dev mydb               # imprime la URI
#                 mgo app1-dev mydb                # abre mongosh (pide password)
#                 mgo app1-dev mydb -Standard      # por hostname público
#                 mgo app1-dev -User otro-usuario
# Variables:    $env:MONGO_ATLAS_USER     (opcional) usuario de BD por defecto. Si no existe,
#                                         se usa <DB_USER> y conviene pasar -User.
#               $env:MONGO_ATLAS_APPNAME  (opcional) appName de la URI. Por defecto mongosh.
#               $script:MongoAtlasTargets ← AJUSTAR: rellenar con tus clusters. Los hostnames
#                                         salen de Atlas UI → Connect, o de
#                                         `atlas clusters connectionStrings describe <CLUSTER> --projectId <PROJECT_ID>`
#                                         (privateEndpoint[0].srvConnectionString y standardSrv,
#                                         sin el prefijo mongodb+srv://).
# Efectos:      SOLO LECTURA por sí mismo (no cambia nada en Atlas). Lo que hagas dentro de
#               mongosh es responsabilidad de la sesión interactiva.
# Salida:       Tablas/objetos por consola; Connect-MongoAtlas abre una sesión mongosh.

$script:MongoAtlasDefaultUser = if ($env:MONGO_ATLAS_USER) { $env:MONGO_ATLAS_USER } else { "<DB_USER>" }   # ← AJUSTAR
$script:MongoAtlasAuthSource = "admin"
$script:MongoAtlasAppName = if ($env:MONGO_ATLAS_APPNAME) { $env:MONGO_ATLAS_APPNAME } else { "mongosh" }

# Catálogo de clusters ← AJUSTAR (ejemplos ficticios).
#   Alias        : nombre corto que tecleas (p.ej. <app>-<entorno>).
#   Project      : nombre del proyecto Atlas (informativo).
#   Cluster      : nombre del cluster en Atlas (informativo).
#   Env / Entity : entorno y entidad/unidad de negocio (informativos, para filtrar a ojo).
#   PrivateHost  : hostname SRV del private endpoint (suele llevar "-pl-0").
#   StandardHost : hostname SRV público.
$script:MongoAtlasTargets = [ordered]@{
    "app1-dev" = @{ Project = "my-project-dev"; Cluster = "app1-dev"; Env = "DEV"; Entity = "UNIT-A"; PrivateHost = "app1-dev-pl-0.<ID>.mongodb.net"; StandardHost = "app1-dev.<ID>.mongodb.net" }
    "app1-pre" = @{ Project = "my-project-pre"; Cluster = "app1-pre"; Env = "PRE"; Entity = "UNIT-A"; PrivateHost = "app1-pre-pl-0.<ID>.mongodb.net"; StandardHost = "app1-pre.<ID>.mongodb.net" }
    "app1-pro" = @{ Project = "my-project-pro"; Cluster = "app1-pro"; Env = "PRO"; Entity = "UNIT-A"; PrivateHost = "app1-pro-pl-0.<ID>.mongodb.net"; StandardHost = "app1-pro.<ID>.mongodb.net" }
}

# Lista todos los alias en tabla (alias: mat)
function Get-MongoAtlasTargets {
    $script:MongoAtlasTargets.GetEnumerator() |
        Sort-Object Name |
        ForEach-Object {
            [PSCustomObject]@{
                Alias = $_.Name
                Entity = $_.Value.Entity
                Env = $_.Value.Env
                Project = $_.Value.Project
                Cluster = $_.Value.Cluster
                PrivateHost = $_.Value.PrivateHost
                StandardHost = $_.Value.StandardHost
            }
        } |
        Format-Table -AutoSize
}

# Devuelve la URI mongodb+srv:// de un alias (alias: muri).
# ValidateScript rechaza alias que no existan en el catálogo.
function Get-MongoAtlasUri {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [ValidateScript({ $script:MongoAtlasTargets.Contains($_) })]
        [string]$Target,

        [Parameter(Position = 1)]
        [string]$Database = "admin",

        [switch]$Standard
    )

    $targetConfig = $script:MongoAtlasTargets[$Target]
    $hostName = if ($Standard) { $targetConfig.StandardHost } else { $targetConfig.PrivateHost }

    if ([string]::IsNullOrWhiteSpace($hostName)) {
        throw "No hostname configured for target '$Target'."
    }

    # El acento grave (`) escapa el "?" para que PowerShell no lo interprete.
    "mongodb+srv://$hostName/$Database`?authSource=$script:MongoAtlasAuthSource&appName=$script:MongoAtlasAppName"
}

# Abre mongosh contra un alias (alias: mgo). --password sin valor hace que mongosh la pida
# de forma interactiva (no queda en el historial). --apiVersion 1 activa la Stable API.
function Connect-MongoAtlas {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [ValidateScript({ $script:MongoAtlasTargets.Contains($_) })]
        [string]$Target,

        [Parameter(Position = 1)]
        [string]$Database = "admin",

        [string]$User = $script:MongoAtlasDefaultUser,

        [switch]$Standard
    )

    $targetConfig = $script:MongoAtlasTargets[$Target]
    $hostName = if ($Standard) { $targetConfig.StandardHost } else { $targetConfig.PrivateHost }

    if ([string]::IsNullOrWhiteSpace($hostName)) {
        throw "No hostname configured for target '$Target'."
    }

    $uri = Get-MongoAtlasUri -Target $Target -Database $Database -Standard:$Standard

    Write-Host "Target:  $Target ($($targetConfig.Cluster))" -ForegroundColor Cyan
    Write-Host "Project: $($targetConfig.Project)" -ForegroundColor Cyan
    Write-Host "Host:    $hostName" -ForegroundColor Cyan
    Write-Host "DB:      $Database" -ForegroundColor Cyan
    Write-Host "User:    $User" -ForegroundColor Cyan

    mongosh $uri --apiVersion 1 --username $User --password
}

# Muestra el detalle de un alias (alias: mshow)
function Show-MongoAtlasTarget {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [ValidateScript({ $script:MongoAtlasTargets.Contains($_) })]
        [string]$Target
    )

    $targetConfig = $script:MongoAtlasTargets[$Target]
    [PSCustomObject]@{
        Alias = $Target
        Entity = $targetConfig.Entity
        Env = $targetConfig.Env
        Project = $targetConfig.Project
        Cluster = $targetConfig.Cluster
        PrivateHost = $targetConfig.PrivateHost
        StandardHost = $targetConfig.StandardHost
    }
}

Set-Alias mat Get-MongoAtlasTargets
Set-Alias muri Get-MongoAtlasUri
Set-Alias mgo Connect-MongoAtlas
Set-Alias mshow Show-MongoAtlasTarget
