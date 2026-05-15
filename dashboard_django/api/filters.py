import re
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo


CDMX_TZ = ZoneInfo("America/Mexico_City")

INTERVALO_RE = re.compile(r"^\d+\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)$")


def _sanitizar_intervalo(valor: str) -> str:
    if not INTERVALO_RE.match(valor):
        return "3650 days"
    return valor


def _sanitizar_fecha(valor: str) -> str:
    if re.match(r"^\d{4}-\d{2}-\d{2}$", valor):
        return valor
    raise ValueError(f"Fecha invalida: {valor}")


def _sanitizar_lista_numerica(valor: str, max_val: int = 24) -> str:
    partes = [p.strip() for p in valor.split(",")]
    validos = []
    for p in partes:
        if not re.match(r"^\d+$", p):
            continue
        n = int(p)
        if 1 <= n <= max_val:
            validos.append(str(n))
    return ",".join(validos) if validos else ""


def ahora_cdmx() -> datetime:
    return datetime.now(CDMX_TZ)


def filtro_fecha(request) -> str:
    desde = request.query_params.get("desde")
    hasta = request.query_params.get("hasta")
    intervalo = request.query_params.get("intervalo", "3650 days")
    dias_semana = request.query_params.get("dias_semana", "")
    horas = request.query_params.get("horas", "")

    SQL_TIMESTAMP = """
        (make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0) AT TIME ZONE 'UTC'
         AT TIME ZONE 'America/Mexico_City')
    """
    SQL_FECHA = f"({SQL_TIMESTAMP})::date"

    if desde or hasta:
        partes = []
        if desde:
            desde = _sanitizar_fecha(desde)
            partes.append(f"{SQL_FECHA} >= '{desde}'")
        if hasta:
            hasta = _sanitizar_fecha(hasta)
            partes.append(f"{SQL_FECHA} <= '{hasta}'")
        elif desde:
            # Only desde given: treat as single-day filter
            partes.append(f"{SQL_FECHA} <= '{desde}'")
        clausula = " AND ".join(partes)
    else:
        intervalo = _sanitizar_intervalo(intervalo)
        clausula = f"{SQL_FECHA} >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date - INTERVAL '{intervalo}'"

    if dias_semana:
        lista_dias = _sanitizar_lista_numerica(dias_semana, max_val=7)
        if lista_dias:
            clausula += f" AND EXTRACT(ISODOW FROM {SQL_TIMESTAMP}) IN ({lista_dias})"

    if horas:
        lista_horas = _sanitizar_lista_numerica(horas, max_val=23)
        if lista_horas:
            clausula += f" AND EXTRACT(HOUR FROM {SQL_TIMESTAMP}) IN ({lista_horas})"

    return clausula


def filtro_fecha_utc(request, col: str = "estampa_tiempo") -> str:
    """
    Genera WHERE para columnas UTC brutas (staging.tabla_davis, datalake.capturas_crudas).
    Convierte las fechas CDMX del frontend a rango UTC equivalente.
    """
    desde = request.query_params.get("desde")
    hasta = request.query_params.get("hasta")
    intervalo = request.query_params.get("intervalo", "30 days")

    if desde or hasta:
        partes = []
        if desde:
            desde = _sanitizar_fecha(desde)
            partes.append(f"({col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date >= '{desde}'")
        if hasta:
            hasta = _sanitizar_fecha(hasta)
            partes.append(f"({col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date <= '{hasta}'")
        elif desde:
            partes.append(f"({col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date <= '{desde}'")
        clausula = " AND ".join(partes)
    else:
        intervalo = _sanitizar_intervalo(intervalo)
        clausula = f"{col} >= NOW() - INTERVAL '{intervalo}'"

    return clausula


def filtro_fumando(request) -> str:
    val = request.query_params.get("fumando", "all")
    smoking_mode = request.query_params.get("smoking_mode")
    if smoking_mode == "true" or val == "true":
        return "h.esta_fumando = TRUE"
    if val == "false":
        return "h.esta_fumando = FALSE"
    return "TRUE"


def filtro_camaras(request) -> str:
    camaras = request.query_params.get("camaras", "")
    zonas = request.query_params.get("zonas", "")
    campus = request.query_params.get("campus", "")

    partes = []
    if camaras:
        lista = ",".join(f"'{c.strip()}'" for c in camaras.split(",") if c.strip())
        if lista:
            partes.append(f"g.camara IN ({lista})")
    if zonas:
        lista = ",".join(f"'{z.strip()}'" for z in zonas.split(",") if z.strip())
        if lista:
            partes.append(f"g.zona IN ({lista})")
    if campus:
        lista = ",".join(f"'{p.strip()}'" for p in campus.split(",") if p.strip())
        if lista:
            partes.append(f"g.campus IN ({lista})")

    return " AND ".join(partes) if partes else "1=1"
