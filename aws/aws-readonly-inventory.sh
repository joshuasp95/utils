#!/usr/bin/env bash
# aws-readonly-inventory.sh — inventario de AWS en SOLO LECTURA, emitido como un único JSON compacto.
#
# Qué hace:     Recoge el estado de una cuenta AWS que suelen necesitar las tareas de soporte:
#               identidad (cuenta/ARN), instancias RDS y su mantenimiento pendiente, backups/PITR
#               de RDS, configuración de backup de buckets S3, AWS Backup, certificados ACM,
#               servicios ECS, clusters EKS y estado del recorder de AWS Config.
#               Toda llamada pasa por aws_ro(), que RECHAZA cualquier operación cuyo verbo no sea
#               describe-/list-/get-/lookup- (defensa en profundidad ante ediciones futuras).
# Requisitos:   aws CLI v2, jq. Sesión/credenciales válidas en el perfil indicado
#               (p. ej. `aws sso login --profile <PERFIL>`); el script NO inicia sesión.
# Uso:          ./aws-readonly-inventory.sh --profile <PERFIL>
#               ./aws-readonly-inventory.sh --profile <PERFIL> --section identity,rds,acm | jq '.'
#               ./aws-readonly-inventory.sh --profile <PERFIL> --section identity,rds-backups,aws-backup --rds-instance <DB_ID>
#               ./aws-readonly-inventory.sh --profile <PERFIL> --dry-run
# Variables:    --profile        perfil de ~/.aws/config (lista: `aws configure list-profiles`). Obligatorio.
#               --region         región AWS; si se omite, la del perfil.
#               --section        lista separada por comas de secciones (ver --help).
#               --rds-instance   identificador de instancia RDS (repetible); necesario para rds-backups.
#               --s3-bucket      nombre de bucket (repetible); necesario para s3.
#               --dry-run        imprime las llamadas que haría y sale sin contactar con AWS.
# Efectos:      SOLO LECTURA. Solo escribe en un directorio temporal privado (mktemp -d) que se
#               borra al salir. No imprime credenciales, secretos ni tags.
# Salida:       Un JSON compacto por stdout: {"profile":..,"region":..,"sections":{...}}.
#               Avisos y errores por stderr.
#               Códigos de salida: 0 éxito · 1 error de uso · 2 falta dependencia o credenciales
#               no usables · 3 éxito parcial (alguna sección falló; el JSON se emite igualmente).

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"
ALL_SECTIONS=(identity rds rds-backups s3 aws-backup acm ecs eks config)
DEFAULT_SECTIONS=(identity rds acm ecs eks config)
# Expresión regular (ERE) con los verbos permitidos: la operación debe EMPEZAR por uno de ellos.
READONLY_VERBS='^(describe|list|get|lookup)-'

PROFILE=""
REGION=""
SECTIONS=""
DRY_RUN=0
PARTIAL=0
RDS_INSTANCES=()
S3_BUCKETS=()

usage() {
  cat <<EOF
$SCRIPT_NAME — read-only AWS inventory (JSON to stdout)

Usage:
  $SCRIPT_NAME --profile <aws-profile> [--region <region>] [--section <list>]
               [--rds-instance <id>] [--s3-bucket <name>] [--dry-run]

Options:
  --profile <name>   AWS CLI profile to use (required).
  --region <name>    AWS region. Defaults to the profile's configured region.
  --section <list>   Comma-separated subset of: ${ALL_SECTIONS[*]}
                     Default: ${DEFAULT_SECTIONS[*]}.
  --rds-instance <id>  Limit rds-backups/aws-backup to this DB instance.
                       Repeat for more than one instance.
  --s3-bucket <name>   Limit s3/aws-backup to this bucket.
                       Repeat for more than one bucket.
  --dry-run          Print the AWS commands that would run, and exit without calling AWS.
  -h, --help         Show this help.

Sections:
  identity  Caller identity — always run first so the output records which account
            the data came from. Guards against reading the wrong account.
  rds       DB instances (engine, version, class, multi-AZ) plus pending
            maintenance actions. Feeds upgrade planning.
  rds-backups  RDS retention/PITR window, automated backups and snapshots.
               Requires at least one --rds-instance.
  s3        Versioning, encryption, public access, lifecycle, replication,
            Object Lock and EventBridge metadata. Requires --s3-bucket.
  aws-backup  Recovery points for the selected RDS instances and S3 buckets.
  acm       Certificates with status, expiry and what is using them. An ISSUED
            certificate with an empty InUseBy is a known failure signature.
  ecs       Clusters, services and the task definition ARNs currently in use.
  eks       Clusters with Kubernetes version and status.
  config    AWS Config recorder status.

Safety:
  Only ${READONLY_VERBS//\\/} AWS subcommands are permitted; anything else is refused
  before execution. No credentials, secrets or tags are printed.

  List available profiles with: aws configure list-profiles

Examples:
  $SCRIPT_NAME --profile <profile>
  $SCRIPT_NAME --profile <profile> --section rds,acm
  $SCRIPT_NAME --profile <profile> --section identity,rds-backups,aws-backup \
    --rds-instance <db-id>
  $SCRIPT_NAME --profile <profile> --section identity,s3,aws-backup \
    --s3-bucket <bucket>
  $SCRIPT_NAME --profile <profile> --dry-run
EOF
}

die() { printf '%s: %s\n' "$SCRIPT_NAME" "$1" >&2; exit "${2:-1}"; }
warn() { printf '%s: warning: %s\n' "$SCRIPT_NAME" "$1" >&2; PARTIAL=1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) [ $# -ge 2 ] || die "--profile requires a value"; PROFILE="$2"; shift 2 ;;
    --region)  [ $# -ge 2 ] || die "--region requires a value";  REGION="$2";  shift 2 ;;
    --section) [ $# -ge 2 ] || die "--section requires a value"; SECTIONS="$2"; shift 2 ;;
    --rds-instance) [ $# -ge 2 ] || die "--rds-instance requires a value"; RDS_INSTANCES+=("$2"); shift 2 ;;
    --s3-bucket) [ $# -ge 2 ] || die "--s3-bucket requires a value"; S3_BUCKETS+=("$2"); shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

[ -n "$PROFILE" ] || { usage >&2; die "--profile is required" 1; }
command -v aws >/dev/null 2>&1 || die "aws CLI not found in PATH" 2
command -v jq  >/dev/null 2>&1 || die "jq not found in PATH" 2

# Resolve the section list.
if [ -z "$SECTIONS" ]; then
  REQUESTED=("${DEFAULT_SECTIONS[@]}")
else
  IFS=',' read -r -a REQUESTED <<< "$SECTIONS"
  for s in "${REQUESTED[@]}"; do
    found=0
    for known in "${ALL_SECTIONS[@]}"; do [ "$s" = "$known" ] && found=1 && break; done
    [ "$found" -eq 1 ] || die "unknown section: $s (valid: ${ALL_SECTIONS[*]})"
  done
fi

wants() {
  for s in "${REQUESTED[@]}"; do [ "$s" = "$1" ] && return 0; done
  return 1
}

if wants rds-backups && [ ${#RDS_INSTANCES[@]} -eq 0 ]; then
  die "rds-backups requires at least one --rds-instance"
fi
if wants s3 && [ ${#S3_BUCKETS[@]} -eq 0 ]; then
  die "s3 requires at least one --s3-bucket"
fi
if wants aws-backup && [ ${#RDS_INSTANCES[@]} -eq 0 ] && [ ${#S3_BUCKETS[@]} -eq 0 ]; then
  die "aws-backup requires --rds-instance and/or --s3-bucket"
fi

# Punto único por el que pasa TODA llamada a AWS: valida el verbo, añade --profile/--region,
# fuerza salida JSON (--output json) y desactiva el paginador interactivo (--no-cli-pager).
# The single choke point for every AWS call.
# $1 = service, $2 = operation (must be read-only), rest = arguments.
aws_ro() {
  local service="$1" operation="$2"; shift 2
  if ! printf '%s' "$operation" | grep -Eq "$READONLY_VERBS"; then
    warn "refused non-read-only operation: $service $operation"
    printf 'null\n'
    return 1
  fi
  local -a cmd=(aws "$service" "$operation" --profile "$PROFILE" --output json --no-cli-pager)
  [ -n "$REGION" ] && cmd+=(--region "$REGION")
  cmd+=("$@")

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%q ' "${cmd[@]}" >&2; printf '\n' >&2
    printf 'null\n'
    return 0
  fi

  local out
  if ! out="$("${cmd[@]}" 2>/dev/null)"; then
    warn "call failed: $service $operation"
    printf 'null\n'
    return 1
  fi
  printf '%s\n' "${out:-null}"
}

# Variante para llamadas S3 donde "no existe configuración" es un estado válido (p. ej. bucket
# sin lifecycle): esos errores concretos se traducen a null en vez de marcar fallo parcial.
# Read-only calls where an absent configuration is a valid state, not a failure.
aws_ro_optional() {
  local service="$1" operation="$2"; shift 2
  if ! printf '%s' "$operation" | grep -Eq "$READONLY_VERBS"; then
    warn "refused non-read-only operation: $service $operation"
    printf 'null\n'
    return 1
  fi
  local -a cmd=(aws "$service" "$operation" --profile "$PROFILE" --output json --no-cli-pager)
  [ -n "$REGION" ] && cmd+=(--region "$REGION")
  cmd+=("$@")

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%q ' "${cmd[@]}" >&2; printf '\n' >&2
    printf 'null\n'
    return 0
  fi

  local out
  if out="$("${cmd[@]}" 2>&1)"; then
    printf '%s\n' "${out:-null}"
    return 0
  fi
  if grep -Eq 'NoSuchLifecycleConfiguration|ReplicationConfigurationNotFoundError|ObjectLockConfigurationNotFoundError|NoSuchPublicAccessBlockConfiguration' <<< "$out"; then
    printf 'null\n'
    return 0
  fi
  warn "call failed: $service $operation"
  printf 'null\n'
  return 1
}

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s: dry run — the following AWS calls would be made:\n' "$SCRIPT_NAME" >&2
fi

# ---- sections -------------------------------------------------------------

sec_identity() {
  aws_ro sts get-caller-identity \
    | jq -c '{account: .Account, arn: .Arn}' 2>/dev/null || printf 'null\n'
}

# --query usa JMESPath (lenguaje de filtrado de JSON de la AWS CLI): DBInstances[].{alias:Campo}
# proyecta cada instancia a un objeto con solo los campos indicados.
sec_rds() {
  local instances pending
  instances="$(aws_ro rds describe-db-instances \
    --query 'DBInstances[].{id:DBInstanceIdentifier,engine:Engine,version:EngineVersion,class:DBInstanceClass,status:DBInstanceStatus,multiAz:MultiAZ,autoMinor:AutoMinorVersionUpgrade}')"
  pending="$(aws_ro rds describe-pending-maintenance-actions \
    --query 'PendingMaintenanceActions[].{resource:ResourceIdentifier,actions:PendingMaintenanceActionDetails[].{action:Action,autoAppliedAfter:AutoAppliedAfterDate,forcedApplyDate:ForcedApplyDate,description:Description}}')"
  jq -c -n --argjson i "${instances:-null}" --argjson p "${pending:-null}" \
    '{instances: $i, pendingMaintenance: $p}' 2>/dev/null || printf 'null\n'
}

sec_rds_backups() {
  local out=() id details retained automated manual backup_service item
  for id in "${RDS_INSTANCES[@]-}"; do
    [ -n "$id" ] || continue
    details="$(aws_ro rds describe-db-instances --db-instance-identifier "$id" \
      --query 'DBInstances[0].{id:DBInstanceIdentifier,arn:DBInstanceArn,resourceId:DbiResourceId,status:DBInstanceStatus,engine:Engine,version:EngineVersion,created:InstanceCreateTime,class:DBInstanceClass,endpointHost:Endpoint.Address,port:Endpoint.Port,databaseName:DBName,allocatedStorageGiB:AllocatedStorage,storageType:StorageType,encrypted:StorageEncrypted,kmsKeyId:KmsKeyId,publiclyAccessible:PubliclyAccessible,multiAz:MultiAZ,availabilityZone:AvailabilityZone,vpc:DBSubnetGroup.VpcId,subnetGroup:DBSubnetGroup.DBSubnetGroupName,securityGroups:VpcSecurityGroups[*].VpcSecurityGroupId,parameterGroups:DBParameterGroups[*].DBParameterGroupName,optionGroups:OptionGroupMemberships[*].OptionGroupName,deletionProtection:DeletionProtection,iamDatabaseAuthenticationEnabled:IAMDatabaseAuthenticationEnabled,masterUserSecretArn:MasterUserSecret.SecretArn,masterUserSecretStatus:MasterUserSecret.SecretStatus,masterUserSecretKmsKeyId:MasterUserSecret.KmsKeyId,performanceInsightsEnabled:PerformanceInsightsEnabled,performanceInsightsKmsKeyId:PerformanceInsightsKMSKeyId,caCertificateIdentifier:CACertificateIdentifier,readReplicaSource:ReadReplicaSourceDBInstanceIdentifier,readReplicas:ReadReplicaDBInstanceIdentifiers,retentionDays:BackupRetentionPeriod,backupWindow:PreferredBackupWindow,earliestRestorable:EarliestRestorableTime,latestRestorable:LatestRestorableTime,backupTarget:BackupTarget,copyTags:CopyTagsToSnapshot}')"
    retained="$(aws_ro rds describe-db-instance-automated-backups --db-instance-identifier "$id" \
      --query 'DBInstanceAutomatedBackups[].{arn:DBInstanceAutomatedBackupsArn,resourceId:DbiResourceId,status:Status,engine:Engine,version:EngineVersion,retentionDays:BackupRetentionPeriod,restoreWindow:RestoreWindow,encrypted:Encrypted,region:Region}')"
    automated="$(aws_ro rds describe-db-snapshots --db-instance-identifier "$id" --snapshot-type automated \
      --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[].{id:DBSnapshotIdentifier,type:SnapshotType,created:SnapshotCreateTime,status:Status,version:EngineVersion,encrypted:Encrypted,progress:PercentProgress}')"
    manual="$(aws_ro rds describe-db-snapshots --db-instance-identifier "$id" --snapshot-type manual \
      --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[].{id:DBSnapshotIdentifier,type:SnapshotType,created:SnapshotCreateTime,status:Status,version:EngineVersion,encrypted:Encrypted,progress:PercentProgress}')"
    backup_service="$(aws_ro rds describe-db-snapshots --db-instance-identifier "$id" --snapshot-type awsbackup \
      --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[].{id:DBSnapshotIdentifier,type:SnapshotType,created:SnapshotCreateTime,status:Status,version:EngineVersion,encrypted:Encrypted,progress:PercentProgress}')"
    item="$(jq -c -n --arg id "$id" \
      --argjson d "${details:-null}" --argjson r "${retained:-null}" \
      --argjson a "${automated:-null}" --argjson m "${manual:-null}" \
      --argjson b "${backup_service:-null}" \
      '{id:$id,configuration:$d,automatedBackupMetadata:$r,systemSnapshots:$a,manualSnapshots:$m,backupServiceSnapshots:$b}' 2>/dev/null)"
    [ -n "$item" ] && out+=("$item")
  done
  if [ ${#out[@]} -eq 0 ]; then printf '[]\n'; else printf '%s\n' "${out[@]}" | jq -c -s '.'; fi
}

sec_s3() {
  local out=() bucket raw location versioning encryption public lifecycle replication object_lock notifications item
  for bucket in "${S3_BUCKETS[@]}"; do
    raw="$(aws_ro s3api get-bucket-location --bucket "$bucket")"
    location="$(jq -c '.LocationConstraint // "us-east-1"' <<< "$raw" 2>/dev/null || printf 'null')"
    raw="$(aws_ro s3api get-bucket-versioning --bucket "$bucket")"
    versioning="$(jq -c '{status:(.Status // "Disabled"),mfaDelete:(.MFADelete // "Disabled")}' <<< "$raw" 2>/dev/null || printf 'null')"
    raw="$(aws_ro s3api get-bucket-encryption --bucket "$bucket")"
    encryption="$(jq -c '[.ServerSideEncryptionConfiguration.Rules[]? | {algorithm:.ApplyServerSideEncryptionByDefault.SSEAlgorithm,bucketKey:(.BucketKeyEnabled // false)}]' <<< "$raw" 2>/dev/null || printf 'null')"
    raw="$(aws_ro_optional s3api get-public-access-block --bucket "$bucket")"
    public="$(jq -c '.PublicAccessBlockConfiguration // null' <<< "$raw" 2>/dev/null || printf 'null')"
    raw="$(aws_ro_optional s3api get-bucket-lifecycle-configuration --bucket "$bucket")"
    lifecycle="$(jq -c '[.Rules[]? | {id:ID,status:Status,expirationDays:Expiration.Days,noncurrentExpirationDays:NoncurrentVersionExpiration.NoncurrentDays,abortMultipartDays:AbortIncompleteMultipartUpload.DaysAfterInitiation}]' <<< "$raw" 2>/dev/null || printf 'null')"
    raw="$(aws_ro_optional s3api get-bucket-replication --bucket "$bucket")"
    replication="$(jq -c '[.ReplicationConfiguration.Rules[]? | {id:ID,status:Status,destination:.Destination.Bucket}]' <<< "$raw" 2>/dev/null || printf 'null')"
    raw="$(aws_ro_optional s3api get-object-lock-configuration --bucket "$bucket")"
    object_lock="$(jq -c '.ObjectLockConfiguration // null' <<< "$raw" 2>/dev/null || printf 'null')"
    raw="$(aws_ro s3api get-bucket-notification-configuration --bucket "$bucket")"
    notifications="$(jq -c '{eventBridge:(has("EventBridgeConfiguration")),lambdaRules:([.LambdaFunctionConfigurations[]?]|length),queueRules:([.QueueConfigurations[]?]|length),topicRules:([.TopicConfigurations[]?]|length)}' <<< "$raw" 2>/dev/null || printf 'null')"
    item="$(jq -c -n --arg bucket "$bucket" \
      --argjson l "${location:-null}" --argjson v "${versioning:-null}" \
      --argjson e "${encryption:-null}" --argjson p "${public:-null}" \
      --argjson lc "${lifecycle:-null}" --argjson r "${replication:-null}" \
      --argjson o "${object_lock:-null}" --argjson n "${notifications:-null}" \
      '{bucket:$bucket,location:$l,versioning:$v,encryption:$e,publicAccessBlock:$p,lifecycle:$lc,replication:$r,objectLock:$o,notifications:$n}' 2>/dev/null)"
    [ -n "$item" ] && out+=("$item")
  done
  if [ ${#out[@]} -eq 0 ]; then printf '[]\n'; else printf '%s\n' "${out[@]}" | jq -c -s '.'; fi
}

sec_aws_backup() {
  local resource_items=() plan_items=() selection_items=() id arn points item plan_ids plan_id plan selection_ids selection_id selection
  for id in "${RDS_INSTANCES[@]-}"; do
    [ -n "$id" ] || continue
    arn="$(aws_ro rds describe-db-instances --db-instance-identifier "$id" --query 'DBInstances[0].DBInstanceArn' | jq -r '. // empty' 2>/dev/null)"
    [ -n "$arn" ] || continue
    points="$(aws_ro backup list-recovery-points-by-resource --resource-arn "$arn" \
      --query 'reverse(sort_by(RecoveryPoints,&CreationDate))[].{arn:RecoveryPointArn,status:Status,created:CreationDate,completion:CompletionDate,vault:BackupVaultName,type:ResourceType,sizeBytes:BackupSizeBytes,createdBy:CreatedBy,calculatedLifecycle:CalculatedLifecycle,parent:ParentRecoveryPointArn}')"
    item="$(jq -c -n --arg resource "$id" --arg arn "$arn" --argjson p "${points:-null}" '{resource:$resource,arn:$arn,recoveryPoints:$p}' 2>/dev/null)"
    [ -n "$item" ] && resource_items+=("$item")
  done
  for id in "${S3_BUCKETS[@]-}"; do
    [ -n "$id" ] || continue
    arn="arn:aws:s3:::$id"
    points="$(aws_ro backup list-recovery-points-by-resource --resource-arn "$arn" \
      --query 'reverse(sort_by(RecoveryPoints,&CreationDate))[].{arn:RecoveryPointArn,status:Status,created:CreationDate,completion:CompletionDate,vault:BackupVaultName,type:ResourceType,sizeBytes:BackupSizeBytes,createdBy:CreatedBy,calculatedLifecycle:CalculatedLifecycle,parent:ParentRecoveryPointArn}')"
    item="$(jq -c -n --arg resource "$id" --arg arn "$arn" --argjson p "${points:-null}" '{resource:$resource,arn:$arn,recoveryPoints:$p}' 2>/dev/null)"
    [ -n "$item" ] && resource_items+=("$item")
  done

  plan_ids="$(aws_ro backup list-backup-plans --query 'BackupPlansList[].BackupPlanId')"
  if [ "$DRY_RUN" -eq 0 ] && [ -n "$plan_ids" ] && [ "$plan_ids" != "null" ]; then
    while IFS= read -r plan_id; do
      [ -n "$plan_id" ] || continue
      plan="$(aws_ro backup get-backup-plan --backup-plan-id "$plan_id" \
        --query 'BackupPlan.{name:BackupPlanName,rules:Rules[].{name:RuleName,vault:TargetBackupVaultName,schedule:ScheduleExpression,startWindowMinutes:StartWindowMinutes,completionWindowMinutes:CompletionWindowMinutes,continuous:EnableContinuousBackup,lifecycle:Lifecycle,copyActions:CopyActions}}')"
      selection_items=()
      selection_ids="$(aws_ro backup list-backup-selections --backup-plan-id "$plan_id" --query 'BackupSelectionsList[].SelectionId')"
      while IFS= read -r selection_id; do
        [ -n "$selection_id" ] || continue
        selection="$(aws_ro backup get-backup-selection --backup-plan-id "$plan_id" --selection-id "$selection_id" \
          --query 'BackupSelection.{name:SelectionName,resources:Resources,notResources:NotResources,listOfTags:ListOfTags,conditions:Conditions}')"
        [ -n "$selection" ] && [ "$selection" != "null" ] && selection_items+=("$selection")
      done < <(printf '%s' "$selection_ids" | jq -r '.[]?' 2>/dev/null)
      item="$(jq -c -n --arg id "$plan_id" --argjson p "${plan:-null}" \
        --argjson s "$(if [ ${#selection_items[@]} -eq 0 ]; then printf '[]'; else printf '%s\n' "${selection_items[@]}" | jq -c -s '.'; fi)" \
        '{id:$id,plan:$p,selections:$s}' 2>/dev/null)"
      [ -n "$item" ] && plan_items+=("$item")
    done < <(printf '%s' "$plan_ids" | jq -r '.[]?' 2>/dev/null)
  fi

  jq -c -n \
    --argjson resources "$(if [ ${#resource_items[@]} -eq 0 ]; then printf '[]'; else printf '%s\n' "${resource_items[@]}" | jq -c -s '.'; fi)" \
    --argjson plans "$(if [ ${#plan_items[@]} -eq 0 ]; then printf '[]'; else printf '%s\n' "${plan_items[@]}" | jq -c -s '.'; fi)" \
    '{resources:$resources,plans:$plans}' 2>/dev/null || printf 'null\n'
}

sec_acm() {
  local arns summary=()
  arns="$(aws_ro acm list-certificates --query 'CertificateSummaryList[].CertificateArn')"
  if [ "$DRY_RUN" -eq 1 ] || [ -z "$arns" ] || [ "$arns" = "null" ]; then
    printf '%s\n' "${arns:-null}"; return
  fi
  local arn detail
  while IFS= read -r arn; do
    [ -n "$arn" ] || continue
    detail="$(aws_ro acm describe-certificate --certificate-arn "$arn" \
      --query 'Certificate.{arn:CertificateArn,domain:DomainName,status:Status,notAfter:NotAfter,inUseBy:InUseBy,sans:SubjectAlternativeNames}')"
    [ "$detail" != "null" ] && summary+=("$detail")
  done < <(printf '%s' "$arns" | jq -r '.[]?' 2>/dev/null)
  if [ ${#summary[@]} -eq 0 ]; then printf '[]\n'; else printf '%s\n' "${summary[@]}" | jq -c -s '.'; fi
}

sec_ecs() {
  local clusters out=()
  clusters="$(aws_ro ecs list-clusters --query 'clusterArns')"
  if [ "$DRY_RUN" -eq 1 ] || [ -z "$clusters" ] || [ "$clusters" = "null" ]; then
    printf '%s\n' "${clusters:-null}"; return
  fi
  local c svc detail
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    svc="$(aws_ro ecs list-services --cluster "$c" --query 'serviceArns')"
    detail="$(jq -c -n --arg cluster "$c" --argjson services "${svc:-null}" \
      '{cluster: $cluster, services: $services}' 2>/dev/null)"
    [ -n "$detail" ] && out+=("$detail")
  done < <(printf '%s' "$clusters" | jq -r '.[]?' 2>/dev/null)
  if [ ${#out[@]} -eq 0 ]; then printf '[]\n'; else printf '%s\n' "${out[@]}" | jq -c -s '.'; fi
}

sec_eks() {
  local names out=()
  names="$(aws_ro eks list-clusters --query 'clusters')"
  if [ "$DRY_RUN" -eq 1 ] || [ -z "$names" ] || [ "$names" = "null" ]; then
    printf '%s\n' "${names:-null}"; return
  fi
  local n detail
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    detail="$(aws_ro eks describe-cluster --name "$n" \
      --query 'cluster.{name:name,version:version,status:status,platformVersion:platformVersion}')"
    [ "$detail" != "null" ] && out+=("$detail")
  done < <(printf '%s' "$names" | jq -r '.[]?' 2>/dev/null)
  if [ ${#out[@]} -eq 0 ]; then printf '[]\n'; else printf '%s\n' "${out[@]}" | jq -c -s '.'; fi
}

sec_config() {
  aws_ro configservice describe-configuration-recorder-status \
    --query 'ConfigurationRecordersStatus[].{name:name,recording:recording,lastStatus:lastStatus}'
}

# ---- assemble -------------------------------------------------------------
# Cada sección se escribe en $TMP/<seccion>.json y al final se unen en un único objeto JSON.

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for s in "${REQUESTED[@]}"; do
  case "$s" in
    identity) sec_identity ;;
    rds)      sec_rds ;;
    rds-backups) sec_rds_backups ;;
    s3)       sec_s3 ;;
    aws-backup) sec_aws_backup ;;
    acm)      sec_acm ;;
    ecs)      sec_ecs ;;
    eks)      sec_eks ;;
    config)   sec_config ;;
  esac > "$TMP/$s.json"
done

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s: dry run complete — no AWS calls were made.\n' "$SCRIPT_NAME" >&2
  exit 0
fi

{
  printf '{"profile":%s,"region":%s,"sections":{' \
    "$(jq -Rn --arg v "$PROFILE" '$v')" \
    "$(jq -Rn --arg v "${REGION:-default}" '$v')"
  first=1
  for s in "${REQUESTED[@]}"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '%s:%s' "$(jq -Rn --arg v "$s" '$v')" "$(cat "$TMP/$s.json" 2>/dev/null || printf 'null')"
  done
  printf '}}'
} | jq -c '.' 2>/dev/null || {
  printf '%s: failed to assemble JSON output\n' "$SCRIPT_NAME" >&2
  exit 3
}

[ "$PARTIAL" -eq 1 ] && exit 3
exit 0
