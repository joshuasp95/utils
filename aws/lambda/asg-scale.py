# asg-scale.py — Lambda que ajusta el tamaño (desired/min/max) de un Auto Scaling Group.
#
# Qué hace:     Llama a autoscaling:UpdateAutoScalingGroup con los valores DesiredCapacity,
#               MinSize y MaxSize indicados. Sustituye a dos Lambdas casi idénticas ("up" y
#               "down") que solo se diferenciaban en los números: ahora es una sola función y
#               cada despliegue/regla de EventBridge le pasa sus valores.
#               Típico: apagar nodos de un entorno de pruebas por la noche (0/0/1) y
#               encenderlos por la mañana (1/1/1).
# Requisitos:   Runtime Python 3.x de AWS Lambda (boto3 viene incluido en el runtime).
#               Rol de ejecución con permiso autoscaling:UpdateAutoScalingGroup sobre el ASG.
# Uso:          Handler: asg-scale.lambda_handler (o renombra el fichero a asg_scale.py si tu
#               herramienta de empaquetado exige un nombre de módulo importable).
#               - Valores fijos por variables de entorno de la Lambda (ver Variables).
#               - O un evento que los sobreescriba, p. ej. desde una regla programada de EventBridge:
#                   {"asg_name": "<ASG_NAME>", "desired_capacity": 0, "min_size": 0, "max_size": 1}
# Variables:    ASG_NAME          nombre del Auto Scaling Group (consola EC2 > Auto Scaling Groups,
#                                 o `aws autoscaling describe-auto-scaling-groups`). Obligatoria
#                                 salvo que venga en el evento.
#               DESIRED_CAPACITY  número de instancias deseado. Obligatoria salvo en el evento.
#               MIN_SIZE          mínimo de instancias. Obligatoria salvo en el evento.
#               MAX_SIZE          máximo de instancias. Obligatoria salvo en el evento.
#               Claves de evento equivalentes (tienen prioridad): asg_name, desired_capacity,
#               min_size, max_size.
# Efectos:      ESCRIBE: modifica la capacidad del ASG (puede lanzar o terminar instancias).
# Salida:       Devuelve un texto con el ASG y los valores aplicados (visible en CloudWatch Logs
#               y en la respuesta de la invocación).

import os

import boto3


def _param(event, event_key, env_key):
    """Devuelve el valor del evento si existe; si no, el de la variable de entorno."""
    if isinstance(event, dict) and event.get(event_key) is not None:
        return event[event_key]
    value = os.getenv(env_key)
    if value is None or value == "":
        raise ValueError(
            f"Falta '{event_key}' en el evento o la variable de entorno {env_key}"
        )
    return value


def lambda_handler(event, context):
    asg_name = str(_param(event, "asg_name", "ASG_NAME"))
    desired_capacity = int(_param(event, "desired_capacity", "DESIRED_CAPACITY"))
    min_size = int(_param(event, "min_size", "MIN_SIZE"))
    max_size = int(_param(event, "max_size", "MAX_SIZE"))

    client = boto3.client("autoscaling")
    # UpdateAutoScalingGroup: AWS valida que min <= desired <= max; si no, lanza ValidationError.
    client.update_auto_scaling_group(
        AutoScalingGroupName=asg_name,
        DesiredCapacity=desired_capacity,
        MinSize=min_size,
        MaxSize=max_size,
    )
    return (
        f"Auto Scaling Group updated: {asg_name} "
        f"(desired={desired_capacity}, min={min_size}, max={max_size})"
    )
