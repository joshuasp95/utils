# aws

Scripts y funciones para AWS: un inventario de cuenta en solo lectura y una Lambda para escalar un
Auto Scaling Group (ASG).

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `aws-readonly-inventory.sh` | Inventario de la cuenta (identidad, RDS, backups de RDS, S3, AWS Backup, ACM, ECS, EKS, AWS Config) como un único JSON | SOLO LECTURA (solo escribe un temporal que borra al salir) |
| `lambda/asg-scale.py` | Lambda que fija `DesiredCapacity`/`MinSize`/`MaxSize` de un ASG. Une las antiguas Lambdas "up" y "down" en una sola parametrizada | ESCRIBE: cambia la capacidad del ASG |

## Requisitos

- `aws` CLI v2 y `jq` (para el inventario).
- Sesión AWS válida en el perfil que uses (p. ej. `aws sso login --profile <PERFIL>`). El script no
  inicia sesión: si ha caducado, falla con código 2 o 3.
- Lambda: runtime Python 3.x (trae `boto3`) y un rol con permiso `autoscaling:UpdateAutoScalingGroup`.

## Variables

### `aws-readonly-inventory.sh` (argumentos)

| Argumento | Obligatorio | Qué es | De dónde sacarlo |
|---|---|---|---|
| `--profile` | Sí | Perfil de la AWS CLI | `aws configure list-profiles` |
| `--region` | No | Región AWS (por defecto la del perfil) | `aws configure get region --profile <PERFIL>` |
| `--section` | No | Secciones a recoger, separadas por comas: `identity rds rds-backups s3 aws-backup acm ecs eks config` | Ver `--help` |
| `--rds-instance` | Para `rds-backups` | Id de la instancia RDS (repetible) | Sección `rds` del propio script |
| `--s3-bucket` | Para `s3` | Nombre del bucket (repetible) | `aws s3 ls --profile <PERFIL>` |
| `--dry-run` | No | Muestra las llamadas sin ejecutarlas | — |

Códigos de salida: `0` éxito · `1` error de uso · `2` falta dependencia o credenciales · `3` parcial
(alguna sección falló, el JSON sale igualmente).

### `lambda/asg-scale.py` (variables de entorno o claves del evento)

| Variable | Clave de evento | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|---|
| `ASG_NAME` | `asg_name` | Sí (en una de las dos) | Nombre del Auto Scaling Group | Consola EC2 > Auto Scaling Groups, o `aws autoscaling describe-auto-scaling-groups --query 'AutoScalingGroups[].AutoScalingGroupName'` |
| `DESIRED_CAPACITY` | `desired_capacity` | Sí | Instancias deseadas | Decisión operativa (0 = apagado) |
| `MIN_SIZE` | `min_size` | Sí | Mínimo de instancias | Debe cumplir `min <= desired <= max` |
| `MAX_SIZE` | `max_size` | Sí | Máximo de instancias | Ídem |

Si una clave viene en el evento, tiene prioridad sobre la variable de entorno.

## Ejemplos

```bash
# Quién soy y qué mantenimiento RDS hay pendiente
./aws-readonly-inventory.sh --profile <PERFIL> --section identity,rds | jq '.'

# Backups/PITR de una RDS y recovery points de AWS Backup
./aws-readonly-inventory.sh --profile <PERFIL> --region <REGION> \
  --section identity,rds-backups,aws-backup --rds-instance <DB_INSTANCE_ID> | jq '.'

# Certificados ACM emitidos que no está usando nada (InUseBy vacío)
./aws-readonly-inventory.sh --profile <PERFIL> --section acm \
  | jq '.sections.acm[] | select(.inUseBy | length == 0)'

# Ver qué llamadas haría, sin llamar a AWS
./aws-readonly-inventory.sh --profile <PERFIL> --dry-run
```

- `| jq '.'` formatea el JSON para leerlo; `jq '.sections.acm[] | select(...)'` recorre la lista de
  certificados y se queda con los que cumplen la condición.
- `--dry-run`: en secciones que primero listan y luego consultan cada elemento (ACM, ECS, EKS, planes
  de AWS Backup) solo puede mostrar la primera llamada; demuestra que no se contacta AWS, no es la lista
  completa de llamadas.

Probar la Lambda a mano (ESCRIBE: cambia el ASG):

```bash
aws lambda invoke --profile <PERFIL> --function-name <NOMBRE_LAMBDA> \
  --cli-binary-format raw-in-base64-out \
  --payload '{"desired_capacity": 0, "min_size": 0, "max_size": 1}' /dev/stdout
```

- `--function-name`: nombre de la Lambda desplegada.
- `--cli-binary-format raw-in-base64-out`: permite pasar el `--payload` como JSON plano (la CLI v2
  espera base64 por defecto).
- `--payload`: el evento; aquí sobreescribe capacidad y deja `ASG_NAME` de la variable de entorno.
- `/dev/stdout`: fichero donde la CLI escribe la respuesta de la función (aquí, la pantalla).

Para programarla, crea dos reglas de EventBridge Scheduler (p. ej. una de "apagar" y otra de
"encender") que invoquen la misma Lambda con distinto evento.
