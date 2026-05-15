import csv
import hashlib
import io
import json
import math
import os
import tempfile
import time
import uuid
import numpy as np
from datetime import datetime, timezone as dt_timezone, timedelta
from django.conf import settings
from django.core.cache import cache as _cache
from django.http import HttpResponse
from functools import wraps
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .db import query
from .filters import filtro_fecha, filtro_fecha_utc, filtro_camaras, filtro_fumando, ahora_cdmx


CLUSTER_FEATURE_MASK = {
    "actividad": True,
    "postura": True,
    "interaccion": True,
    "riesgo": True,
    "fumando": True,
    "ambiental": True,
    "turno": True,
}
CLUSTERING_CONFIG = {
    "vector_dim": 31,
    "projection": "PCA(2)",
    "clusterer": "KMeans(k=8)",
    "random_state": 42,
    "pca_components": 2,
}


def api_cache(timeout=300):
    """
    Cachea la respuesta JSON en disco (FileBasedCache).
    La clave incluye la URL completa con query params para diferenciar filtros.
    Debe aplicarse DEBAJO de @api_view para recibir el DRF Request.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(request, *args, **kwargs):
            raw = request.get_full_path()
            if request.method == "POST" and request.body:
                raw += request.body.decode("utf-8", errors="replace")
            key = "idu_" + hashlib.md5(raw.encode()).hexdigest()
            hit = _cache.get(key)
            if hit is not None:
                return Response(hit)
            resp = fn(request, *args, **kwargs)
            if resp.status_code == 200:
                try:
                    _cache.set(key, resp.data, timeout)
                except Exception:
                    pass  # cache failure no debe romper la respuesta
            return resp
        return wrapper
    return decorator


def _canonical_json(data) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _request_cluster_filters(request) -> dict:
    keys = ("intervalo", "desde", "hasta", "campus", "zonas", "camaras", "dias_semana", "horas", "smoking_mode", "fumando")
    result = {}
    for key in keys:
        value = request.query_params.get(key)
        if value not in (None, ""):
            if key in ("campus", "zonas", "camaras", "dias_semana", "horas"):
                result[key] = sorted([v.strip() for v in value.split(",") if v.strip()])
            else:
                result[key] = value
    if "intervalo" not in result and not result.get("desde"):
        result["intervalo"] = "3650 days"
    return result


def _cluster_query_payload(filters: dict, feature_mask: dict | None = None, config: dict | None = None) -> dict:
    return {
        "filters": filters,
        "feature_mask": feature_mask or CLUSTER_FEATURE_MASK,
        "dataset_version": "warehouse.hechos_actividades_escenaurbana",
        "clustering_config": config or CLUSTERING_CONFIG,
    }


def _cluster_query_hash(filters: dict, feature_mask: dict | None = None, config: dict | None = None) -> str:
    return hashlib.sha256(_canonical_json(_cluster_query_payload(filters, feature_mask, config)).encode("utf-8")).hexdigest()


def _load_json_file(path: str) -> tuple[dict, str]:
    started = time.perf_counter()
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh), "hit"
    except FileNotFoundError:
        return {}, "miss"
    except Exception as exc:
        return {"stage": "failed", "message": f"No se pudo leer {os.path.basename(path)}: {exc}"}, "stale"
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000
        if elapsed_ms > 250:
            print(f"[CLUSTERS] lectura lenta {path}: {elapsed_ms:.1f}ms")


def _default_cluster_status(query_hash: str | None = None) -> dict:
    now = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    return {
        "job_id": "",
        "started_at": None,
        "updated_at": now,
        "stage": "queued",
        "progress": 0,
        "estimated_seconds_remaining": None,
        "elapsed_seconds": 0,
        "records_total": 0,
        "records_processed": 0,
        "cache_status": "miss",
        "message": "No hay estado persistente de clusters; espera al worker o solicita recomputo.",
        "query_hash": query_hash,
        "filters": {},
        "feature_mask": CLUSTER_FEATURE_MASK,
        "clustering_config": CLUSTERING_CONFIG,
    }


def _read_cluster_status(query_hash: str | None = None) -> dict:
    data, cache_status = _load_json_file(settings.CLUSTER_STATUS_FILE)
    if not data:
        return _default_cluster_status(query_hash)
    data.setdefault("cache_status", cache_status)
    data["feature_mask"] = CLUSTER_FEATURE_MASK
    if query_hash and data.get("query_hash") != query_hash:
        data["clustering_config"] = CLUSTERING_CONFIG
    else:
        data.setdefault("clustering_config", CLUSTERING_CONFIG)
    if query_hash:
        data["requested_query_hash"] = query_hash
        if data.get("query_hash") == query_hash and data.get("stage") == "ready":
            data["cache_status"] = "hit"
        elif data.get("stage") in ("queued", "loading_data", "vectorizing", "pca", "kmeans", "labeling", "meta_habits", "writing_results"):
            data["cache_status"] = "miss"
        else:
            data["cache_status"] = "stale"
            if data.get("query_hash") != query_hash and data.get("stage") == "failed":
                data["stage"] = "queued"
                data["progress"] = 0
                data["message"] = "El ultimo job fallido pertenece a otro filtro; los clusters del filtro activo estan stale o pendientes de recomputo."
                data.pop("error", None)
    return data


def _append_recompute_request(payload: dict) -> None:
    os.makedirs(os.path.dirname(settings.CLUSTER_RECOMPUTE_REQUESTS_FILE), exist_ok=True)
    line = _canonical_json(payload) + "\n"
    with open(settings.CLUSTER_RECOMPUTE_REQUESTS_FILE, "a", encoding="utf-8") as fh:
        fh.write(line)


# ── Health check (requerido por docker-compose) ───────────────
@api_view(["GET"])
def health(request):
    return Response({"status": "ok", "hora_cdmx": ahora_cdmx().strftime("%H:%M")})


# ── KPIs globales (tab Resumen) ───────────────────────────────
_SQL_HORA_CDMX = """
    EXTRACT(hour FROM (
        make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
        - INTERVAL '6 hours'
    ))::integer
"""

@api_view(["GET"])
@api_cache(timeout=180)
def kpis(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)

    # Main KPIs
    SQL_FECHA_CDMX = """
        (make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
         AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date
    """
    df = query(f"""
        SELECT
            ROUND(
                SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END)::numeric
                / NULLIF(COUNT(*), 0) * 100, 1
            )                                             AS tasa_fumado,
            COUNT(*) FILTER (WHERE h.nivel_riesgo_salud = 'alto')
                                                          AS eventos_riesgo,
            COUNT(DISTINCT h.actividad)
                FILTER (WHERE h.actividad IS NOT NULL
                          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia')
                                                          AS patrones_activos,
            ROUND(AVG(h.nivel_pm10)::numeric, 1)          AS pm10_promedio,
            COUNT(*)                                       AS total_registros,
            MIN({SQL_FECHA_CDMX})::text                   AS fecha_desde,
            MAX({SQL_FECHA_CDMX})::text                   AS fecha_hasta
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
    """)

    # Hora pico (hour with highest avg obs per day in CDMX timezone)
    df_hora = query(f"""
        SELECT hora_num, ROUND(AVG(n)) AS n
        FROM (
            SELECT {_SQL_HORA_CDMX} AS hora_num,
                   {SQL_FECHA_CDMX} AS fecha,
                   COUNT(*) AS n
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
            JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
            WHERE {ff} AND {fc} AND {ffum}
              AND h.actividad IS NOT NULL
              AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
            GROUP BY 1, 2
        ) sub
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1
    """)

    # Delta tasa_fumado vs previous equivalent period
    intervalo = request.query_params.get("intervalo", "3650 days")
    df_prev = query(f"""
        WITH current_period AS (
            SELECT SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END)::float
                   / NULLIF(COUNT(*), 0) * 100 AS tasa
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
            WHERE {ff} AND {fc} AND {ffum}
              AND h.actividad IS NOT NULL AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        ),
        prev_period AS (
            SELECT SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END)::float
                   / NULLIF(COUNT(*), 0) * 100 AS tasa
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
            WHERE (make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0) - INTERVAL '6 hours')::date
                  < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date - INTERVAL '{intervalo}'
              AND (make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0) - INTERVAL '6 hours')::date
                  >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date - INTERVAL '{intervalo}' - INTERVAL '{intervalo}'
              AND {fc} AND {ffum}
              AND h.actividad IS NOT NULL AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        )
        SELECT
            ROUND((current_period.tasa - prev_period.tasa)::numeric, 1) AS delta
        FROM current_period, prev_period
    """)

    if df.empty:
        return Response({})

    row = df.iloc[0]
    hora_pico = None
    hora_pico_n = None
    if not df_hora.empty:
        h = int(df_hora.iloc[0]["hora_num"])
        hora_pico = f"{h:02d}h"
        hora_pico_n = int(df_hora.iloc[0]["n"])

    delta = None
    if not df_prev.empty and df_prev.iloc[0]["delta"] is not None:
        try:
            delta = float(df_prev.iloc[0]["delta"])
        except (TypeError, ValueError):
            delta = None

    return Response({
        "tasa_fumado":       float(row["tasa_fumado"] or 0),
        "tasa_fumado_delta": delta,
        "hora_pico":         hora_pico,
        "hora_pico_n":       hora_pico_n,
        "metodo_pico":       "Hora del día (CDMX) con el mayor número absoluto de observaciones conductuales en el período filtrado.",
        "metodo_incidencia": "Proporción de observaciones con fumado detectado por IA sobre el total de observaciones confirmadas (excluye ausencias y escena vacía).",
        "eventos_riesgo":    int(row["eventos_riesgo"] or 0),
        "patrones_activos":  int(row["patrones_activos"] or 0),
        "pm10_promedio":     float(row["pm10_promedio"] or 0),
        "total_registros":   int(row["total_registros"] or 0),
        "fecha_desde":       str(row["fecha_desde"]) if row.get("fecha_desde") else None,
        "fecha_hasta":       str(row["fecha_hasta"]) if row.get("fecha_hasta") else None,
    })


# ── Eventos por hora CDMX (gráfica de barras) ─────────────────
@api_view(["GET"])
@api_cache(timeout=180)
def eventos_por_hora(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)

    SQL_HORA = """
        EXTRACT(hour FROM (
            make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
            - INTERVAL '6 hours'
        ))::integer
    """

    df = query(f"""
        SELECT
            (make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
             AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date AS fecha,
            LPAD({SQL_HORA}::text, 2, '0') || 'h' AS hora,
            {SQL_HORA} AS hora_num,
            COUNT(*) AS total,
            SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END) AS fumadores
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        GROUP BY 1, 2, 3
        ORDER BY 1, 3
    """)

    # Formatear la fecha a string para el JSON
    if not df.empty:
        df['fecha'] = df['fecha'].astype(str)

    return Response(df.to_dict(orient="records") if not df.empty else [])


# ── Top actividades ───────────────────────────────────────────
@api_view(["GET"])
@api_cache(timeout=180)
def top_actividades(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)
    limit = int(request.query_params.get("limit", 10))

    df = query(f"""
        SELECT
            h.actividad,
            COUNT(*) AS conteo
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        GROUP BY h.actividad
        ORDER BY conteo DESC
    """)

    if df.empty:
        return Response([])

    df["actividad"] = df["actividad"].apply(_normalizar)
    agg = df.groupby("actividad")["conteo"].sum().reset_index()
    agg = agg.sort_values("conteo", ascending=False).head(limit)
    total = agg["conteo"].sum()
    agg["porcentaje"] = (agg["conteo"] / total * 100).round(1)

    return Response(agg[["actividad", "conteo", "porcentaje"]].to_dict(orient="records"))


# ── Mapa de calor día × hora ──────────────────────────────────
_DIAS = {1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 7: "Dom"}


@api_view(["GET"])
@api_cache(timeout=300)
def heatmap_dia_hora(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)

    SQL_HORA = """
        EXTRACT(hour FROM (
            make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
            - INTERVAL '6 hours'
        ))::integer
    """
    SQL_DOW = """
        EXTRACT(isodow FROM (
            make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
            - INTERVAL '6 hours'
        ))::integer
    """

    df = query(f"""
        SELECT {SQL_DOW} AS dia_semana, {SQL_HORA} AS hora, COUNT(*) AS n
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        GROUP BY 1, 2
        ORDER BY 1, 2
    """)

    if df.empty:
        return Response([])

    # Pivot to nested format: [{dia, horas: [{hora, valor}]}]
    counts = {}
    for _, row in df.iterrows():
        dow = int(row["dia_semana"])
        hora = int(row["hora"])
        n = int(row["n"])
        counts.setdefault(dow, {})[hora] = n

    result = []
    for dow in range(1, 8):
        horas = [{"hora": h, "valor": counts.get(dow, {}).get(h, 0)} for h in range(24)]
        result.append({"dia": _DIAS[dow], "horas": horas})

    return Response(result)


# ── Estado real del job de clusters ──────────────────────────
@api_view(["GET"])
def clusters_status(request):
    filters = _request_cluster_filters(request)
    query_hash = _cluster_query_hash(filters)
    return Response(_read_cluster_status(query_hash))


@api_view(["POST"])
def clusters_recompute(request):
    body = request.data or {}
    filters = body.get("filters") or _request_cluster_filters(request)
    feature_mask = body.get("feature_mask") or CLUSTER_FEATURE_MASK
    config = {**CLUSTERING_CONFIG, **(body.get("clustering_config") or {})}
    query_hash = _cluster_query_hash(filters, feature_mask, config)

    current = _read_cluster_status(query_hash)
    if current.get("job_id") and current.get("stage") not in (None, "", "ready", "failed") and current.get("query_hash") == query_hash:
        return Response(current, status=status.HTTP_409_CONFLICT)

    now = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    job = {
        "job_id": str(uuid.uuid4()),
        "requested_at": now,
        "filters": filters,
        "feature_mask": feature_mask,
        "clustering_config": config,
        "query_hash": query_hash,
    }
    try:
        _append_recompute_request(job)
    except Exception as exc:
        return Response({"error": f"No se pudo registrar recomputo: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    queued = {
        **_default_cluster_status(query_hash),
        **job,
        "started_at": now,
        "updated_at": now,
        "stage": "queued",
        "cache_status": "miss",
        "message": "Recomputo solicitado; el habits_worker tomara el job desde el volumen compartido.",
    }
    return Response(queued, status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
def clusters_job(request, job_id):
    status_payload = _read_cluster_status()
    if status_payload.get("job_id") != str(job_id):
        return Response({"error": "job no encontrado", "current_job_id": status_payload.get("job_id")}, status=status.HTTP_404_NOT_FOUND)
    return Response(status_payload)


# ── Clusters PCA/KMeans (espacio conductual 2D) ──────────────
@api_view(["GET"])
def clusters(request):
    started_total = time.perf_counter()
    filters = _request_cluster_filters(request)
    requested_hash = _cluster_query_hash(filters)
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)

    started_sql = time.perf_counter()
    df = query(f"""
        WITH filtered AS (
            SELECT v.id_hecho
            FROM warehouse.hechos_vectores_descripcion_habitos v
            JOIN warehouse.hechos_actividades_escenaurbana h ON v.id_hecho = h.id_hecho
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
            WHERE {ff} AND {fc} AND {ffum}
              AND v.umap_x IS NOT NULL
              AND h.actividad IS NOT NULL
              AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        ),
        sample AS (
            SELECT id_hecho
            FROM filtered
            ORDER BY MD5(id_hecho::text || '{requested_hash[:16]}')
            LIMIT 10000
        )
        SELECT
            v.id_hecho,
            v.umap_x, v.umap_y,
            h.actividad,
            h.esta_fumando                                         AS fumando,
            ROUND(h.nivel_pm10::numeric, 1)                        AS pm10,
            (EXTRACT(hour FROM (
                make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                - INTERVAL '6 hours'
            )))::integer                                           AS hora
        FROM sample s
        JOIN warehouse.hechos_vectores_descripcion_habitos    v ON s.id_hecho = v.id_hecho
        JOIN warehouse.hechos_actividades_escenaurbana        h ON v.id_hecho = h.id_hecho
        JOIN warehouse.dim_tiempo                             t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial                        g ON h.id_geoespacial = g.id_geoespacial
    """)
    sql_ms = round((time.perf_counter() - started_sql) * 1000, 1)

    if df.empty:
        status_payload = _read_cluster_status(requested_hash)
        return Response({"puntos": [], "status": status_payload, "metadata": {"query_hash": requested_hash, "filters": filters, "sql_ms": sql_ms}})

    labels_started = time.perf_counter()
    labels, assignments, meta_labels, meta_assignments, cluster_to_meta, labels_metadata = _leer_clusters()
    labels_ms = round((time.perf_counter() - labels_started) * 1000, 1)

    if assignments:
        # Camino rápido: lookup vectorizado id_hecho → cluster_id → nombre semántico.
        # Los nombres fueron calculados por el habits_worker sobre el dataset
        # filtrado; no hay que re-correr KMeans en la API.
        cluster_ids_series = df["id_hecho"].astype(int).map(assignments)
        df["cluster_id"]   = cluster_ids_series.fillna(-1).astype(int)
        df["etiqueta"]     = cluster_ids_series.map(labels).fillna(df["actividad"])
        if meta_labels and meta_assignments:
            meta_ids  = df["id_hecho"].astype(int).map(meta_assignments)
            df["meta_etiqueta"] = meta_ids.map(meta_labels).fillna(df["etiqueta"])
        else:
            df["meta_etiqueta"] = df["etiqueta"]
    else:
        # Sin archivo de clusters: no se ejecuta un algoritmo distinto en la API.
        # Mostrar actividad evita ocultar el problema y mantiene trazabilidad.
        df["cluster_id"]   = -1
        df["etiqueta"]     = df["actividad"]
        df["meta_etiqueta"] = df["etiqueta"]

    df["cluster_name"] = df["etiqueta"]
    df["habit_name"] = df["etiqueta"]
    df["meta_habit_name"] = df["meta_etiqueta"]

    puntos = df[[
        "id_hecho", "umap_x", "umap_y", "pm10", "cluster_id",
        "etiqueta", "cluster_name", "habit_name", "meta_etiqueta", "meta_habit_name",
        "actividad", "fumando", "hora",
    ]].copy()
    puntos = puntos.rename(columns={"id_hecho": "id"})
    puntos["fumando"]    = puntos["fumando"].fillna(False).astype(bool)
    puntos["pm10"]       = puntos["pm10"].fillna(0).astype(float)
    puntos["hora"]       = puntos["hora"].fillna(0).astype(int)
    puntos["cluster_id"] = puntos["cluster_id"].fillna(-1).astype(int)
    # Tasa de fumado por cluster (usa assignments + labels de _leer_clusters())
    df_fum = query(f"""
        SELECT
            v.id_hecho,
            h.esta_fumando
        FROM warehouse.hechos_vectores_descripcion_habitos v
        JOIN warehouse.hechos_actividades_escenaurbana h ON v.id_hecho = h.id_hecho
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo      = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND v.umap_x IS NOT NULL
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
    """)
    tasas_fumado = []
    if not df_fum.empty and assignments:
        df_fum["cluster_id"] = df_fum["id_hecho"].astype(int).map(assignments)
        df_fum = df_fum.dropna(subset=["cluster_id"])
        df_fum["cluster_id"] = df_fum["cluster_id"].astype(int)
        agg = (
            df_fum.groupby("cluster_id")
            .agg(total=("esta_fumando", "count"), fumando=("esta_fumando", "sum"))
            .reset_index()
        )
        agg["etiqueta"] = agg["cluster_id"].map(labels)
        agg["tasa"] = (agg["fumando"] / agg["total"] * 100).round(1)
        tasas_fumado = agg[["etiqueta", "total", "fumando", "tasa"]].to_dict(orient="records")

    status_payload = _read_cluster_status(requested_hash)
    labels_hash = labels_metadata.get("query_hash") or status_payload.get("query_hash")
    is_current = labels_hash == requested_hash and bool(assignments)
    elapsed_ms = round((time.perf_counter() - started_total) * 1000, 1)
    resp = {
        "puntos": puntos.to_dict(orient="records"),
        "tasas_fumado": tasas_fumado,
        "total_registros": len(df),
        "nota": "Los puntos se filtran por la consulta activa. Las etiquetas solo son actuales si metadata.is_current=true.",
        "status": status_payload,
        "metadata": {
            "query_hash": requested_hash,
            "filters": filters,
            "feature_mask": CLUSTER_FEATURE_MASK,
            "clustering_config": CLUSTERING_CONFIG,
            "labels_query_hash": labels_hash,
            "labels_metadata": labels_metadata,
            "is_current": is_current,
            "cache_status": status_payload.get("cache_status", "miss"),
            "sql_ms": sql_ms,
            "labels_ms": labels_ms,
            "total_ms": elapsed_ms,
            "points_returned": len(puntos),
        },
    }
    if meta_labels:
        resp["meta_labels"] = {str(k): v for k, v in meta_labels.items()}
    return Response(resp)


# ── Clusters personalizados (POST) — Laboratorio de Clusters ─────────
@api_view(["POST"])
def clusters_custom(request):
    """
    Endpoint POST que acepta pesos de features y filtros,
    construye vectores 31-dim personalizados, ejecuta PCA→KMeans
    y devuelve clusters en el mismo formato que GET /api/clusters/.
    """
    body = request.data or {}
    filters = body.get("filters", {})
    weights = body.get("weights", {})
    n_clusters = int(body.get("n_clusters", 8))

    # Construir WHERE a partir del dict de filtros (evita dependencia de query_params)
    where_parts = []
    camaras = filters.get("camaras", [])
    zonas = filters.get("zonas", [])
    campus = filters.get("campus", [])
    if camaras:
        lista = ",".join(f"'{c.strip()}'" for c in camaras if c.strip())
        if lista:
            where_parts.append(f"g.camara IN ({lista})")
    if zonas:
        lista = ",".join(f"'{z.strip()}'" for z in zonas if z.strip())
        if lista:
            where_parts.append(f"g.zona IN ({lista})")
    if campus:
        lista = ",".join(f"'{p.strip()}'" for p in campus if p.strip())
        if lista:
            where_parts.append(f"g.campus IN ({lista})")
    if filters.get("smokingMode"):
        where_parts.append("h.esta_fumando = TRUE")
    if filters.get("desde") or filters.get("hasta"):
        sql_date = "(make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date"
        desde = filters.get("desde")
        hasta = filters.get("hasta")
        if desde and re.match(r"^\d{4}-\d{2}-\d{2}$", str(desde)):
            where_parts.append(f"{sql_date} >= '{desde}'")
        if hasta and re.match(r"^\d{4}-\d{2}-\d{2}$", str(hasta)):
            where_parts.append(f"{sql_date} <= '{hasta}'")
        elif desde and re.match(r"^\d{4}-\d{2}-\d{2}$", str(desde)):
            where_parts.append(f"{sql_date} <= '{desde}'")
    dias = filters.get("dias_semana") or []
    if dias:
        valid = ",".join(str(int(d)) for d in dias if str(d).isdigit() and 1 <= int(d) <= 7)
        if valid:
            where_parts.append(f"EXTRACT(ISODOW FROM (make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')) IN ({valid})")
    horas = filters.get("horas") or []
    if horas:
        valid = ",".join(str(int(h)) for h in horas if str(h).isdigit() and 0 <= int(h) <= 23)
        if valid:
            where_parts.append(f"EXTRACT(HOUR FROM (make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')) IN ({valid})")
    where_sql = " AND ".join(where_parts) if where_parts else "1=1"

    from .clustering_utils import (
        build_feature_vector, apply_weights, run_clustering, hash_config,
        semantic_label_from_rows, meta_labels_from_cluster_profiles,
    )

    w = {
        "actividad":   float(weights.get("actividad", 3.0)),
        "postura":     float(weights.get("postura", 1.0)),
        "interaccion": float(weights.get("interaccion", 1.0)),
        "riesgo":      float(weights.get("riesgo", 1.0)),
        "fumando":     float(weights.get("fumando", 5.0)),
        "ambiental":   float(weights.get("ambiental", 1.0)),
        "turno":       float(weights.get("turno", 0.5)),
    }
    relevant_filters = {k: v for k, v in filters.items() if k in ("camaras", "zonas", "campus", "smokingMode", "desde", "hasta", "dias_semana", "horas")}
    relevant_filters["n_clusters"] = n_clusters
    config_hash = hash_config(relevant_filters, w)
    seed = config_hash[:16]
    random_state = int(config_hash[:8], 16)

    df = query(f"""
        SELECT
            h.id_hecho                                          AS id,
            h.actividad,
            h.esta_fumando,
            h.conteo_personas,
            h.nivel_pm10                                        AS pm10,
            (EXTRACT(hour FROM (
                make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                - INTERVAL '6 hours'
            )))::integer                                        AS hora,
            COALESCE(h.postura_dominante, '')                  AS postura_predominante,
            COALESCE(h.interaccion_social, '')                  AS interaccion_social,
            cd.temperatura                                      AS temperatura,
            cd.humedad                                          AS humedad
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo                             t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial                        g ON h.id_geoespacial = g.id_geoespacial
        LEFT JOIN LATERAL (
            SELECT temperatura, humedad
            FROM staging.tabla_davis
            WHERE estampa_tiempo <= make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
            ORDER BY estampa_tiempo DESC
            LIMIT 1
        ) cd ON TRUE
        WHERE {where_sql}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        ORDER BY MD5(id_hecho::text || '{seed}')
        LIMIT 10000
    """)

    if df.empty:
        return Response({"puntos": [], "tasas_fumado": [], "total_registros": 0, "nota": "Sin datos para los filtros activos"})
    if len(df) < max(20, n_clusters * 3):
        return Response({
            "puntos": [],
            "tasas_fumado": [],
            "total_registros": len(df),
            "nota": f"Datos insuficientes para clustering estable: N={len(df)}.",
            "warnings": ["Muestra insuficiente para PCA + KMeans con interpretación defendible."],
        }, status=status.HTTP_400_BAD_REQUEST)

    rows = df.to_dict(orient="records")
    vectors = np.array([build_feature_vector(r) for r in rows], dtype=np.float32)

    weighted = np.array([apply_weights(v, w) for v in vectors], dtype=np.float32)

    pca_x, pca_y, cluster_ids, _, quality_metrics = run_clustering(weighted, n_clusters=n_clusters, random_state=random_state)

    # Sanitize: PCA puede producir NaN/Inf con datos homogéneos
    finite_mask = np.isfinite(pca_x) & np.isfinite(pca_y)
    pca_x = pca_x[finite_mask]
    pca_y = pca_y[finite_mask]
    cluster_ids = cluster_ids[finite_mask]
    rows = [rows[i] for i in np.where(finite_mask)[0]]

    # Etiquetas semánticas determinísticas y meta-hábitos locales
    cluster_profiles = {}
    for cid in sorted(set(int(c) for c in cluster_ids)):
        mask = cluster_ids == cid
        cluster_rows = [rows[i] for i in np.where(mask)[0]]
        cluster_profiles[cid] = semantic_label_from_rows(cluster_rows, cid)
    labels = {cid: profile["cluster_name"] for cid, profile in cluster_profiles.items()}
    meta_labels, cluster_to_meta = meta_labels_from_cluster_profiles(cluster_profiles)

    puntos = []
    def _sf(v: float) -> float:
        """Sanitiza float para JSON: reemplaza NaN/Inf por 0."""
        try:
            return 0.0 if not math.isfinite(v) else float(v)
        except (TypeError, ValueError):
            return 0.0

    for i, r in enumerate(rows):
        puntos.append({
            "id": int(r["id"]),
            "umap_x": _sf(pca_x[i]),
            "umap_y": _sf(pca_y[i]),
            "pm10": _sf(r.get("pm10")),
            "cluster_id": int(cluster_ids[i]),
            "etiqueta": labels[int(cluster_ids[i])],
            "cluster_name": labels[int(cluster_ids[i])],
            "habit_name": cluster_profiles[int(cluster_ids[i])]["habit_name"],
            "meta_etiqueta": meta_labels.get(cluster_to_meta.get(int(cluster_ids[i]), -1), cluster_profiles[int(cluster_ids[i])]["meta_habit_name"]),
            "meta_habit_name": meta_labels.get(cluster_to_meta.get(int(cluster_ids[i]), -1), cluster_profiles[int(cluster_ids[i])]["meta_habit_name"]),
            "description": cluster_profiles[int(cluster_ids[i])]["description"],
            "dominant_features": cluster_profiles[int(cluster_ids[i])]["dominant_features"],
            "warnings": cluster_profiles[int(cluster_ids[i])]["warnings"],
            "actividad": r["actividad"] or "",
            "fumando": bool(r.get("esta_fumando") or False),
            "hora": int(r.get("hora") or 0),
        })

    # Tasas de fumado por cluster
    tasas_fumado = []
    for cid in sorted(labels):
        mask = cluster_ids == cid
        cluster_rows = [rows[i] for i in np.where(mask)[0]]
        total = len(cluster_rows)
        fumando = sum(1 for r in cluster_rows if r.get("esta_fumando"))
        tasa = round(fumando / total * 100, 1) if total > 0 else 0
        tasas_fumado.append({
            "etiqueta": labels[cid],
            "total": total,
            "fumando": fumando,
            "tasa": _sf(tasa),
        })

    resp = {
        "puntos": puntos,
        "tasas_fumado": tasas_fumado,
        "total_registros": len(puntos),
        "nota": "Clusters generados on-demand con pesos personalizados. No persisten en BD. Coordenadas 2D por PCA; grupos por KMeans.",
        "meta_labels": {str(k): v for k, v in meta_labels.items()},
        "cluster_profiles": {str(k): v for k, v in cluster_profiles.items()},
        "quality_metrics": quality_metrics,
        "custom_config": {
            "weights": {k: float(v) for k, v in w.items()},
            "n_clusters": n_clusters,
            "projection": "PCA(2)",
            "clusterer": "KMeans",
            "query_hash": config_hash,
        },
    }
    return Response(resp)


def _leer_clusters() -> tuple[dict, dict, dict, dict, dict, dict]:
    """
    Devuelve (labels, assignments, meta_labels, meta_assignments, cluster_to_meta, metadata)
    del cluster_labels.json del habits_worker.
    labels:      {cluster_id: nombre_semántico}
    assignments: {id_hecho: cluster_id}
    meta_labels: {meta_id: nombre_meta_hábito}
    meta_assignments: {id_hecho: meta_id}
    cluster_to_meta: {cluster_id: meta_id}
    Todos vacíos si el archivo no existe todavía.
    """
    try:
        with open(settings.CLUSTER_LABELS_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
        labels           = {int(k): v for k, v in data.get("labels", {}).items()}
        assignments      = {int(k): int(v) for k, v in data.get("assignments", {}).items()}
        meta_labels      = {int(k): v for k, v in data.get("meta_labels", {}).items()}
        meta_assignments = {int(k): int(v) for k, v in data.get("meta_assignments", {}).items()}
        cluster_to_meta  = {int(k): int(v) for k, v in data.get("cluster_to_meta", {}).items()}
        metadata         = data.get("metadata", {}) if isinstance(data.get("metadata", {}), dict) else {}
        return labels, assignments, meta_labels, meta_assignments, cluster_to_meta, metadata
    except Exception:
        return {}, {}, {}, {}, {}, {}


# ── Alertas (antes en FastAPI :8502) ─────────────────────────
@api_view(["GET"])
def alertas(request):
    """
    Endpoint externo — requiere API_KEY si está configurada.
    Equivale al /alertas de FastAPI :8502.
    """
    api_key = settings.API_KEY
    if api_key and request.headers.get("X-API-Key") != api_key:
        return Response({"error": "no autorizado"}, status=status.HTTP_401_UNAUTHORIZED)

    df = query("""
        SELECT
            h.esta_fumando,
            h.yolo_cigarette_conf,
            h.nivel_pm10,
            h.temperatura,
            h.calidad_aire_label,
            g.camara, g.zona, g.campus,
            make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                - INTERVAL '6 hours' AS timestamp_cdmx
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
              >= NOW() - INTERVAL '1 hour'
        ORDER BY t.id_tiempo DESC
        LIMIT 100
    """)

    umbral_fumado = settings.ALERTA_UMBRAL_FUMADO
    umbral_pm10   = settings.ALERTA_UMBRAL_PM10

    alertas_activas = []
    if not df.empty:
        pct_fumado = df["esta_fumando"].mean() * 100
        pm10_max   = df["nivel_pm10"].max()

        if pct_fumado >= umbral_fumado:
            alertas_activas.append({
                "tipo": "fumado",
                "valor": round(pct_fumado, 1),
                "umbral": umbral_fumado,
                "unidad": "%",
            })
        if pm10_max >= umbral_pm10:
            alertas_activas.append({
                "tipo": "pm10",
                "valor": round(float(pm10_max), 1),
                "umbral": umbral_pm10,
                "unidad": "ug/m3",
            })

    return Response({
        "alertas": alertas_activas,
        "registros_ultima_hora": len(df),
    })


# ── Calidad IA (tab Auditoría) ────────────────────────────────
@api_view(["GET"])
@api_cache(timeout=300)
def calidad_ia(request):
    ff = filtro_fecha(request)
    ffum = filtro_fumando(request)

    df = query(f"""
        SELECT
            COUNT(*) AS total,
            SUM(CASE
                WHEN LENGTH(COALESCE(h.resumen_semantico,'')) -
                     LENGTH(REPLACE(COALESCE(h.resumen_semantico,''),' ','')) < 4
                THEN 1 ELSE 0 END
            ) AS resumen_corto
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
        WHERE {ff} AND {ffum}
    """)

    if df.empty:
        return Response({})

    row   = df.iloc[0]
    total = int(row["total"] or 1)
    cortos = int(row["resumen_corto"] or 0)

    return Response({
        "total":           total,
        "resumen_corto":   cortos,
        "pct_corto":       round(cortos / total * 100, 1),
        "pct_valido":      round((total - cortos) / total * 100, 1),
    })


# ── Opciones de filtros (sidebar) ────────────────────────────
@api_view(["GET"])
@api_cache(timeout=1800)
def opciones_filtros(request):
    geo = query("""
        SELECT DISTINCT camara, zona, campus
        FROM warehouse.dim_geoespacial
        ORDER BY campus, zona, camara
    """)
    habitos = query("""
        SELECT DISTINCT actividad
        FROM warehouse.hechos_actividades_escenaurbana
        WHERE actividad IS NOT NULL
          AND LOWER(actividad) NOT LIKE 'ausencia%%' AND actividad != 'escena_vacia'
        ORDER BY actividad
        LIMIT 60
    """)

    return Response({
        "geo":      geo.to_dict(orient="records") if not geo.empty else [],
        "habitos":  habitos["actividad"].tolist() if not habitos.empty else [],
    })


# ── Calendario escolar (warehouse.subcat_calendario) ─────────
@api_view(["GET"])
@api_cache(timeout=3600)
def calendario(request):
    anio = request.query_params.get("anio")
    mes  = request.query_params.get("mes")

    where_parts = []
    if anio:
        where_parts.append(f"EXTRACT(year FROM c.fecha_oficial) = {int(anio)}")
    if mes:
        where_parts.append(f"EXTRACT(month FROM c.fecha_oficial) = {int(mes)}")
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    df = query(f"""
        SELECT
            c.fecha_oficial::text AS fecha,
            CASE
                WHEN c.tipo_dia LIKE '%%Evaluacion%%' OR c.evaluacion THEN 'examenes'
                WHEN c.tipo_dia LIKE 'Vacaciones%%'                   THEN 'vacaciones'
                WHEN c.tipo_dia LIKE 'Descanso%%'                     THEN 'asueto'
                WHEN c.tipo_dia IN ('Fin de clases','Fin de semestre') THEN 'intersemestral'
                ELSE 'clases'
            END AS tipo_periodo,
            c.tipo_dia AS nombre_periodo
        FROM warehouse.subcat_calendario c
        {where}
        ORDER BY c.fecha_oficial
    """)

    return Response(df.to_dict(orient="records") if not df.empty else [])


# ── Duración de Hábitos ───────────────────────────────────────
@api_view(["GET"])
# @api_cache(timeout=300) # Comentado temporalmente para forzar que sirva los datos mock
def duracion_habitos(request):
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)
    fcc = filtro_fecha_utc(request, col="cc.estampa_tiempo")

    df = query(f"""
        WITH frames AS (
            SELECT
                h.actividad,
                cc.estampa_tiempo AS tiempo_captura,
                MAX(h.conteo_personas) AS conteo_personas
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN staging.tabla_central sc ON sc.id_central = h.id_central_origen
            JOIN staging.tabla_llava sl ON sl.id_llava = sc.id_llava
            JOIN datalake.capturas_crudas cc ON cc.id_captura = sl.id_captura
            JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
            WHERE h.actividad IS NOT NULL
              AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
              AND {fcc}
              AND {fc} AND {ffum}
            GROUP BY h.actividad, cc.estampa_tiempo
        ),
        islas AS (
            SELECT
                actividad, tiempo_captura, conteo_personas,
                ROW_NUMBER() OVER (ORDER BY tiempo_captura) AS rn_global,
                ROW_NUMBER() OVER (PARTITION BY actividad ORDER BY tiempo_captura) AS rn_actividad
            FROM frames
        ),
        sesiones AS (
            SELECT
                actividad,
                MIN(tiempo_captura) AS inicio,
                MAX(tiempo_captura) AS fin,
                COUNT(*) AS capturas,
                ROUND(AVG(conteo_personas))::integer AS personas_promedio
            FROM islas
            GROUP BY actividad, (rn_global - rn_actividad)
        )
        SELECT
            actividad,
            inicio, fin,
            capturas,
            personas_promedio,
            ROUND(EXTRACT(EPOCH FROM (fin - inicio)) / 60.0, 1) AS duracion_minutos
        FROM sesiones
        WHERE EXTRACT(EPOCH FROM (fin - inicio)) >= 60
          AND EXTRACT(EPOCH FROM (fin - inicio)) <= 7200
        ORDER BY inicio DESC
        LIMIT 200
    """)

    if df.empty:
        # Datos mock solicitados en caso de no tener datos reales en la BD
        return Response({
            "sesiones": [
                {
                    "actividad": "Estudio solitario",
                    "inicio": "2026-05-09 10:15:00",
                    "fin": "2026-05-09 11:45:00",
                    "capturas": 18,
                    "personas_promedio": 1,
                    "duracion_minutos": 90.0
                },
                {
                    "actividad": "Ocio / socialización",
                    "inicio": "2026-05-09 14:00:00",
                    "fin": "2026-05-09 14:45:00",
                    "capturas": 9,
                    "personas_promedio": 4,
                    "duracion_minutos": 45.0
                },
                {
                    "actividad": "Uso de celular",
                    "inicio": "2026-05-09 16:30:00",
                    "fin": "2026-05-09 16:45:00",
                    "capturas": 3,
                    "personas_promedio": 2,
                    "duracion_minutos": 15.0
                },
                {
                    "actividad": "Estudio con tecnología",
                    "inicio": "2026-05-09 09:00:00",
                    "fin": "2026-05-09 11:00:00",
                    "capturas": 24,
                    "personas_promedio": 3,
                    "duracion_minutos": 120.0
                },
                {
                    "actividad": "Ocio / socialización",
                    "inicio": "2026-05-08 12:00:00",
                    "fin": "2026-05-08 13:30:00",
                    "capturas": 18,
                    "personas_promedio": 5,
                    "duracion_minutos": 90.0
                }
            ],
            "resumen": {
                "mediana_global": 90.0,
                "actividad_mas_larga": "Estudio con tecnología",
                "duracion_mas_larga": 120.0,
                "actividad_mas_frecuente": "Ocio / socialización",
                "frecuencia_max": 2,
            },
        })

    df["inicio"] = df["inicio"].astype(str)
    df["fin"] = df["fin"].astype(str)

    duraciones = df["duracion_minutos"].dropna()
    mediana = float(duraciones.median()) if not duraciones.empty else 0

    por_actividad = df.groupby("actividad")["duracion_minutos"]
    max_por_act = por_actividad.max()
    frec_por_act = df.groupby("actividad").size()

    act_mas_larga = max_por_act.idxmax() if not max_por_act.empty else "—"
    dur_mas_larga = float(max_por_act.max()) if not max_por_act.empty else 0
    act_mas_frec = frec_por_act.idxmax() if not frec_por_act.empty else "—"
    frec_max = int(frec_por_act.max()) if not frec_por_act.empty else 0

    return Response({
        "sesiones": df.to_dict(orient="records"),
        "resumen": {
            "mediana_global":        round(mediana, 1),
            "actividad_mas_larga":   act_mas_larga,
            "duracion_mas_larga":    round(dur_mas_larga, 1),
            "actividad_mas_frecuente": act_mas_frec,
            "frecuencia_max":        frec_max,
        },
    })


# ── Calidad del Aire ──────────────────────────────────────────
def _safe(v):
    """Convierte NaN/numpy tipos a float o None para serialización JSON."""
    try:
        f = float(v)
        return None if f != f else f  # NaN != NaN en IEEE 754
    except (TypeError, ValueError):
        return None


@api_view(["GET"])
@api_cache(timeout=180)
def calidad_aire(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)
    fd = filtro_fecha_utc(request, col="d.estampa_tiempo")
    fd_raw = filtro_fecha_utc(request, col="estampa_tiempo")

    # Timeline PM10, temperatura, humedad del sensor Davis
    df_ambi = query(f"""
        SELECT
            DATE_TRUNC('hour', d.estampa_tiempo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') AS hora_cdmx,
            EXTRACT(hour FROM d.estampa_tiempo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::int AS hora_num,
            ROUND(AVG(d.pm10)::numeric, 1)                   AS pm10,
            ROUND(AVG(d.temperatura)::numeric, 1)            AS temperatura,
            ROUND(AVG(d.humedad)::numeric, 1)                AS humedad
        FROM staging.tabla_davis d
        WHERE {fd}
        GROUP BY 1, 2
        ORDER BY 1
    """)

    # Eventos de fumado por hora (para overlay en gráfica) — aplica filtros geo
    df_fuma = query(f"""
        SELECT
            DATE_TRUNC('hour', (
                MAKE_TIMESTAMP(t.anio, t.mes, t.dia, t.hora, t.minuto, 0) AT TIME ZONE 'UTC'
                AT TIME ZONE 'America/Mexico_City'
            )) AS hora_cdmx,
            EXTRACT(hour FROM (
                MAKE_TIMESTAMP(t.anio, t.mes, t.dia, t.hora, t.minuto, 0) AT TIME ZONE 'UTC'
                AT TIME ZONE 'America/Mexico_City'
            ))::int AS hora_num,
            COUNT(*) AS eventos_fumando
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE h.esta_fumando = TRUE
          AND {ff} AND {fc} AND {ffum}
        GROUP BY 1, 2
        ORDER BY 1
    """)

    # Correlación PM10 vs tasa de fumado — aplica filtros geo
    # fumado_hora convierte UTC→CDMX vía AT TIME ZONE (respeta DST) para que el JOIN con Davis sea correcto
    # NOTA: NO aplicamos {ffum} aquí porque necesitamos TODAS las actividades para
    #       calcular correctamente tasa_fumado (% de personas fumando sobre el total).
    #       Si filtráramos solo fumando=true, tasa_fumado siempre sería 100% y perderíamos
    #       el grupo de contraste "sin fumadores".
    df_corr = query(f"""
        WITH fumado_hora AS (
            SELECT
                EXTRACT(year  FROM (make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS anio,
                EXTRACT(month FROM (make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS mes,
                EXTRACT(day   FROM (make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS dia,
                EXTRACT(hour  FROM (make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS hora,
                ROUND(
                    100.0 * SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END)
                    / NULLIF(COUNT(*), 0), 1
                ) AS tasa_fumado,
                SUM(h.conteo_personas) AS personas
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
            WHERE {ff} AND {fc}
            GROUP BY 1, 2, 3, 4
        ),
        davis_hora AS (
            SELECT
                EXTRACT(year  FROM estampa_tiempo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::int AS anio,
                EXTRACT(month FROM estampa_tiempo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::int AS mes,
                EXTRACT(day   FROM estampa_tiempo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::int AS dia,
                EXTRACT(hour  FROM estampa_tiempo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::int AS hora,
                ROUND(AVG(pm10)::numeric, 1) AS pm10
            FROM staging.tabla_davis
            WHERE {fd_raw}
            GROUP BY 1, 2, 3, 4
        )
        SELECT
            f.hora,
            f.tasa_fumado,
            d.pm10,
            f.personas
        FROM fumado_hora f
        JOIN davis_hora d
            ON f.anio = d.anio AND f.mes = d.mes
           AND f.dia  = d.dia  AND f.hora = d.hora
        WHERE d.pm10 IS NOT NULL AND f.personas > 0
        ORDER BY d.pm10
    """)

    # Construir timeline con nombres de campo que espera el frontend
    timeline = []
    if not df_ambi.empty:
        df_ambi["hora_cdmx"] = df_ambi["hora_cdmx"].astype(str)
        for row in df_ambi.to_dict(orient="records"):
            timeline.append({
                "timestamp":   row["hora_cdmx"],
                "pm10":        _safe(row["pm10"]),
                "temperatura": _safe(row["temperatura"]),
                "humedad":     _safe(row["humedad"]),
            })

    # Construir actual (último registro de la timeline)
    actual = {"pm10": None, "temperatura": None, "humedad": None, "calidad_aire_label": None}
    if timeline:
        last = timeline[-1]
        pm10_val = last["pm10"]
        actual = {
            "pm10":        pm10_val,
            "temperatura": last["temperatura"],
            "humedad":     last["humedad"],
            "calidad_aire_label": (
                "Buena"                if pm10_val is not None and pm10_val < 54
                else "Moderada"        if pm10_val is not None and pm10_val < 154
                else "Insalubre (sensibles)" if pm10_val is not None and pm10_val < 254
                else "Insalubre"       if pm10_val is not None
                else None
            ),
        }

    # Construir fumado (overlay en gráfica)
    fumado = []
    if not df_fuma.empty:
        df_fuma["hora_cdmx"] = df_fuma["hora_cdmx"].astype(str)
        for row in df_fuma.to_dict(orient="records"):
            fumado.append({"hora_utc": row["hora_cdmx"], "eventos_fumando": int(row["eventos_fumando"])})

    # Construir correlacion
    correlacion = []
    if not df_corr.empty:
        for row in df_corr.to_dict(orient="records"):
            correlacion.append({
                "hora":        int(row["hora"]) if row["hora"] is not None else None,
                "tasa_fumado": _safe(row["tasa_fumado"]),
                "pm10":        _safe(row["pm10"]),
                "personas":    int(row["personas"]) if row["personas"] is not None else None,
            })

    # Construir resumen_franjas agrupando por franja horaria (hora CDMX)
    franjas_def = [
        ("Madrugada (0-6h)", 0, 6),
        ("Mañana (6-12h)",   6, 12),
        ("Tarde (12-18h)",  12, 18),
        ("Noche (18-24h)",  18, 24),
    ]
    resumen_franjas = []
    for franja_name, h_start, h_end in franjas_def:
        pm10_prom = temp_prom = hum_prom = 0
        if not df_ambi.empty:
            sub = df_ambi[(df_ambi["hora_num"] >= h_start) & (df_ambi["hora_num"] < h_end)]
            if not sub.empty:
                pm10_col = sub["pm10"].dropna()
                temp_col = sub["temperatura"].dropna()
                hum_col  = sub["humedad"].dropna()
                pm10_prom = round(float(pm10_col.mean()), 1) if not pm10_col.empty else 0
                temp_prom = round(float(temp_col.mean()), 1) if not temp_col.empty else 0
                hum_prom  = round(float(hum_col.mean()),  1) if not hum_col.empty else 0

        eventos_fuma = 0
        if not df_fuma.empty:
            sub_f = df_fuma[(df_fuma["hora_num"] >= h_start) & (df_fuma["hora_num"] < h_end)]
            eventos_fuma = int(sub_f["eventos_fumando"].sum())

        resumen_franjas.append({
            "franja":               franja_name,
            "pm10_promedio":        pm10_prom,
            "temperatura_promedio": temp_prom,
            "humedad_promedio":     hum_prom,
            "eventos_fumado":       eventos_fuma,
        })

    return Response({
        "actual":          actual,
        "timeline":        timeline,
        "fumado":          fumado,
        "correlacion":     correlacion,
        "resumen_franjas": resumen_franjas,
    })


# ── Sistema ───────────────────────────────────────────────────
@api_view(["GET"])
@api_cache(timeout=120)
def sistema(request):
    # Estado del pipeline por capa
    df_pipeline = query("""
        SELECT 'Capturas crudas' AS nombre,
            COUNT(*) AS total,
            SUM(CASE WHEN estado_llava IN ('procesado', 'completado') THEN 1 ELSE 0 END) AS completados,
            SUM(CASE WHEN estado_llava = 'pendiente' THEN 1 ELSE 0 END) AS pendientes
        FROM datalake.capturas_crudas
        UNION ALL
        SELECT 'Staging → Warehouse',
            COUNT(*),
            SUM(CASE WHEN estado_envio = 'completado' THEN 1 ELSE 0 END),
            SUM(CASE WHEN estado_envio IN ('pendiente', 'procesando') THEN 1 ELSE 0 END)
        FROM staging.tabla_central
        UNION ALL
        SELECT 'Hechos vectorizados',
            COUNT(*),
            SUM(CASE WHEN v.id_vector IS NOT NULL THEN 1 ELSE 0 END),
            SUM(CASE WHEN v.id_vector IS NULL THEN 1 ELSE 0 END)
        FROM warehouse.hechos_actividades_escenaurbana h
        LEFT JOIN warehouse.hechos_vectores_descripcion_habitos v
            ON v.id_hecho = h.id_hecho
    """)

    # Últimas 10 lecturas Davis raw
    df_davis = query("""
        SELECT
            TO_CHAR(estampa_tiempo, 'HH24:MI:SS') AS timestamp,
            ROUND(pm10::numeric, 2)        AS pm10,
            ROUND(temperatura::numeric, 1) AS temperatura,
            ROUND(humedad::numeric, 1)     AS humedad,
            NULL::numeric                  AS presion,
            NULL::numeric                  AS viento
        FROM staging.tabla_davis
        ORDER BY estampa_tiempo DESC
        LIMIT 10
    """)

    # Últimos 20 hechos
    df_hechos = query("""
        SELECT
            h.id_hecho AS id,
            TO_CHAR(t.fecha_completa, 'YYYY-MM-DD') || ' ' ||
                LPAD(t.hora::text,2,'0') || ':' || LPAD(t.minuto::text,2,'0') AS timestamp,
            h.conteo_personas,
            h.esta_fumando AS fumando,
            h.actividad,
            '—' AS patron_ia,
            h.nivel_riesgo_salud AS nivel_riesgo,
            ROUND(h.nivel_pm10::numeric, 1) AS pm10
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
        LEFT JOIN warehouse.hechos_vectores_descripcion_habitos v
            ON v.id_hecho = h.id_hecho
        ORDER BY h.id_hecho DESC
        LIMIT 20
    """)

    import math
    def _clean(df):
        records = df.to_dict(orient="records")
        return [
            {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in row.items()}
            for row in records
        ]

    return Response({
        "capas":          _clean(df_pipeline) if not df_pipeline.empty else [],
        "lecturas_davis": _clean(df_davis)    if not df_davis.empty    else [],
        "hechos_recientes": _clean(df_hechos) if not df_hechos.empty   else [],
        "info_pipeline":  "Pipeline LLaVA → Staging → Warehouse activo",
    })


# ── Normalización de etiquetas de actividad ───────────────────
_CATEGORIA_EXACTA = {
    "usar_celular":  "Uso de celular",
    "estudiar":      "Estudio solitario",
    "escena_vacia":  "Campus vacío",
    "comer":         "Alimentación",
    "descansar":     "Ocio / socialización",
    "reunion":       "Ocio / socialización",
    "caminar":       "Ocio / socialización",
    "socializar":    "Ocio / socialización",
    "jugar":         "Ocio / socialización",
}

_NORM_RULES = [
    (["campus vacío", "campus vacio", "vacio", "vacío", "empty"],      "Campus vacío"),
    (["laptop", "computadora"],                                        "Estudio con tecnología"),
    (["celular", "teléfono", "telefono", "smartphone"],                "Uso de celular"),
    (["comiendo", "almorzando", "desayunando", "comida", "comer"],     "Alimentación"),
    (["pareja", "grupo", "jugando", "cartas", "jardín", "jardin",
      "conversa", "socializ", "recreo", "caminar", "descansar",
      "reunión", "reunion"],                                           "Ocio / socialización"),
    (["estudi"],                                                       "Estudio solitario"),
    (["cluster", "patrón", "patron"],                                  "Sin clasificar"),
    # Dimensiones sin soporte en la base de datos actual → excluir del análisis
    (["interacci", "social", "salud", "postura", "gesto",
      "emocion", "emoción", "sentiment"],                              "Sin clasificar"),
]


def _normalizar(etiqueta: str) -> str:
    low = etiqueta.lower().strip()
    if low in _CATEGORIA_EXACTA:
        return _CATEGORIA_EXACTA[low]

    # Alimentación y ocio tienen prioridad sobre dispositivos:
    # "comiendo con celular" debe clasificarse como Alimentación, no Uso de celular.
    _ALIMENTO = ("comiendo", "almorzando", "desayunando", "comida", "comer", "almuerzo")
    _OCIO     = ("descansando", "descansar", "jugando", "cartas",
                 "socializ", "recreo", "reunión", "reunion")
    if any(k in low for k in _ALIMENTO):
        return "Alimentación"
    if any(k in low for k in _OCIO):
        return "Ocio / socialización"

    # Vacío del campus
    if any(k in low for k in ("campus vacío", "campus vacio", "vacio", "vacío", "empty")):
        return "Campus vacío"

    # Dispositivos: laptop > estudio con tecnología; celular solo > uso de celular
    es_estudiando = "estudiando" in low or "estudiar" in low
    es_estudiante = "estudiante" in low or "estudiantes" in low
    tiene_laptop  = any(k in low for k in ("laptop", "computadora"))
    tiene_celular = any(k in low for k in ("celular", "teléfono", "telefono", "smartphone"))

    # Si menciona interacción social grupal, no clasificar como "solitario"
    es_grupal = any(k in low for k in ("en grupo", "en pareja", "varios estudiantes", "grupo pequeño", "grupo grande", "dos estudiantes"))

    if es_estudiando and (tiene_laptop or tiene_celular) and not es_grupal:
        return "Estudio con tecnología"
    if (tiene_laptop or tiene_celular) and not es_grupal:
        return "Uso de celular"
    if (es_estudiando or es_estudiante) and not es_grupal:
        return "Estudio solitario"
    if es_grupal:
        return "Ocio / socialización"

    for keywords, categoria in _NORM_RULES:
        if any(k in low for k in keywords):
            return categoria
    return "Sin clasificar"


# ── Firma Temporal ────────────────────────────────────────────
@api_view(["GET"])
@api_cache(timeout=300)
def firma_temporal(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)

    df = query(f"""
        SELECT
            (make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
             AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date AS fecha,
            (EXTRACT(hour FROM (
                make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                - INTERVAL '6 hours'
            )))::integer AS hora,
            h.actividad,
            COUNT(*) AS frecuencia
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        GROUP BY 1, 2, 3
    """)

    if df.empty:
        return Response([])

    df["actividad"] = df["actividad"].apply(_normalizar)
    df["fecha"] = df["fecha"].astype(str)
    
    agrupado = df[df["actividad"] != "Campus vacío"].copy()
    agrupado["patron_ia"] = agrupado["actividad"]

    return Response(agrupado.to_dict(orient="records"))


# ── Patrones Raw ──────────────────────────────────────────────
@api_view(["GET"])
@api_cache(timeout=300)
def patrones_raw(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)

    df = query(f"""
        SELECT
            h.id_hecho,
            h.actividad,
            (EXTRACT(hour FROM (
                make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                - INTERVAL '6 hours'
            )))::integer AS hora
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo      = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
    """)

    if df.empty:
        return Response({"patrones": [], "totales": []})

    labels, assignments, *_ = _leer_clusters()
    if assignments:
        cluster_ids    = df["id_hecho"].astype(int).map(assignments)
        df["etiqueta"] = cluster_ids.map(labels).fillna(df["actividad"])
    else:
        df["etiqueta"] = df["actividad"]

    df["categoria"] = df["etiqueta"]

    por_hora = (
        df.groupby(["etiqueta", "hora"])
        .size()
        .reset_index(name="frecuencia")
        .rename(columns={"etiqueta": "actividad"})
    )

    totales = (
        df.groupby(["etiqueta", "categoria"])
        .size()
        .reset_index(name="total")
        .sort_values("total", ascending=False)
        .rename(columns={"etiqueta": "actividad"})
    )

    return Response({
        "patrones": por_hora.to_dict(orient="records"),
        "totales":  totales.to_dict(orient="records"),
    })


# ── Eventos Paginados (Sprint 1) ──────────────────────────────────
@api_view(["GET"])
@api_cache(timeout=60)
def events_paginated(request):
    # Support both start/end (from the plan) and desde/hasta (from the rest of the app)
    # We will inject them into request query_params locally so that `filtro_fecha` works.
    # Note: request.query_params is immutable in DRF, so we use a mock request for filtro_fecha
    class MockRequest:
        def __init__(self, original_request):
            self.query_params = original_request.query_params.copy()
            if "start" in self.query_params:
                self.query_params["desde"] = self.query_params["start"]
            if "end" in self.query_params:
                self.query_params["hasta"] = self.query_params["end"]

    mock_req = MockRequest(request)
    ff = filtro_fecha(mock_req)
    fc = filtro_camaras(mock_req)
    ffum = filtro_fumando(mock_req)

    page = int(mock_req.query_params.get("page", 1))
    limit = int(mock_req.query_params.get("limit", 100))
    offset = (page - 1) * limit

    # Count total query
    count_sql = f"""
        SELECT COUNT(*) as total_events,
               SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END) as smoking_events
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
    """
    df_count = query(count_sql)
    
    total_events = 0
    smoking_events = 0
    if not df_count.empty:
        total_events = int(df_count.iloc[0]["total_events"] or 0)
        smoking_events = int(df_count.iloc[0]["smoking_events"] or 0)

    # Data query
    data_sql = f"""
        SELECT 
            h.id_hecho as id,
            TO_CHAR(
                make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0) - INTERVAL '6 hours',
                'YYYY-MM-DD HH24:MI:SS'
            ) as timestamp,
            h.actividad,
            h.esta_fumando as fumando,
            h.conteo_personas,
            h.nivel_riesgo_salud as riesgo,
            ROUND(h.nivel_pm10::numeric, 1) as pm10,
            g.camara, g.zona, g.campus
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        ORDER BY t.anio DESC, t.mes DESC, t.dia DESC, t.hora DESC, t.minuto DESC
        LIMIT {limit} OFFSET {offset}
    """
    df_data = query(data_sql)
    
    return Response({
        "data": df_data.to_dict(orient="records") if not df_data.empty else [],
        "total_events": total_events,
        "period": {
            "start": mock_req.query_params.get("start") or mock_req.query_params.get("desde"),
            "end": mock_req.query_params.get("end") or mock_req.query_params.get("hasta")
        },
        "metadata": {
            "smoking_events": smoking_events,
            "page": page,
            "limit": limit,
            "total_pages": (total_events + limit - 1) // limit if limit > 0 else 0
        }
    })

# ── Alertas panel (reemplaza mock wh() del frontend) ─────────
@api_view(["GET"])
@api_cache(timeout=90)
def alertas_panel(request):
    """
    Genera alertas reales a partir de datos recientes.
    Formato compatible con el componente Eh del frontend:
    [{id, level, title, description, timestamp, campus, zona, read}]
    """
    now_cdmx = ahora_cdmx()

    df_davis = query("""
        SELECT pm10, temperatura, humedad
        FROM staging.tabla_davis
        ORDER BY estampa_tiempo DESC LIMIT 1
    """)

    df_hora = query("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END) AS fumando,
            COUNT(*) FILTER (WHERE h.nivel_riesgo_salud = 'alto') AS riesgo_alto,
            g.campus, g.zona
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0)
              >= NOW() - INTERVAL '1 hour'
          AND h.actividad IS NOT NULL
        GROUP BY g.campus, g.zona
        ORDER BY fumando DESC, riesgo_alto DESC
        LIMIT 1
    """)

    alertas = []
    aid = 1

    def ts(mins_ago=0):
        return (now_cdmx - timedelta(minutes=mins_ago)).strftime("%H:%M")

    campus = "Campus Principal"
    zona   = "Acceso Norte"
    if not df_hora.empty:
        campus = str(df_hora.iloc[0]["campus"] or campus)
        zona   = str(df_hora.iloc[0]["zona"]   or zona)

    if not df_davis.empty:
        pm10 = float(df_davis.iloc[0]["pm10"] or 0)
        temp = float(df_davis.iloc[0]["temperatura"] or 0)

        if pm10 >= 150:
            alertas.append({
                "id": str(aid), "level": "critical",
                "title": "PM10 supera límite insalubre",
                "description": f"Concentración de {pm10:.1f} µg/m³ — supera umbral insalubre (150 µg/m³).",
                "timestamp": ts(2), "campus": campus, "zona": zona, "read": False,
            }); aid += 1
        elif pm10 >= 54:
            alertas.append({
                "id": str(aid), "level": "warning",
                "title": "PM10 en nivel moderado",
                "description": f"Concentración actual de {pm10:.1f} µg/m³ — supera límite OMS (54 µg/m³).",
                "timestamp": ts(3), "campus": campus, "zona": zona, "read": False,
            }); aid += 1
        else:
            alertas.append({
                "id": str(aid), "level": "info",
                "title": "Calidad del aire: Buena",
                "description": f"PM10 en {pm10:.1f} µg/m³ — dentro de parámetros. Temp: {temp:.1f}°C.",
                "timestamp": ts(5), "campus": campus, "zona": zona, "read": True,
            }); aid += 1

    if not df_hora.empty:
        row    = df_hora.iloc[0]
        total  = int(row["total"]       or 0)
        fumando    = int(row["fumando"]     or 0)
        riesgo_alto = int(row["riesgo_alto"] or 0)
        umbral = float(settings.ALERTA_UMBRAL_FUMADO)

        if total > 0:
            tasa = fumando / total * 100
            if tasa >= umbral:
                alertas.append({
                    "id": str(aid), "level": "critical" if tasa >= umbral * 2 else "warning",
                    "title": "Actividad de fumado elevada",
                    "description": f"{fumando} evento(s) de fumado en la última hora ({tasa:.1f}% del total observado).",
                    "timestamp": ts(8), "campus": campus, "zona": zona, "read": False,
                }); aid += 1
            elif fumando > 0:
                alertas.append({
                    "id": str(aid), "level": "info",
                    "title": "Eventos de fumado registrados",
                    "description": f"{fumando} evento(s) de fumado detectado(s) en la última hora.",
                    "timestamp": ts(10), "campus": campus, "zona": zona, "read": True,
                }); aid += 1

        if riesgo_alto > 0:
            alertas.append({
                "id": str(aid), "level": "warning",
                "title": "Eventos de riesgo alto detectados",
                "description": f"{riesgo_alto} evento(s) con nivel de riesgo alto en la última hora.",
                "timestamp": ts(15), "campus": campus, "zona": zona, "read": False,
            }); aid += 1

    if not alertas:
        alertas.append({
            "id": "0", "level": "info",
            "title": "Sistema operando normalmente",
            "description": "Sin incidencias detectadas en los últimos datos del sensor.",
            "timestamp": ts(0), "campus": campus, "zona": zona, "read": True,
        })

    return Response(alertas)


# ── Exportación CSV (datos reales del warehouse) ──────────────
@api_view(["GET"])
def export_csv(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)

    df = query(f"""
        SELECT
            TO_CHAR(
                make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                - INTERVAL '6 hours',
                'YYYY-MM-DD HH24:MI'
            )                                          AS timestamp_cdmx,
            g.campus,
            g.zona,
            g.camara,
            h.actividad,
            h.conteo_personas,
            CASE WHEN h.esta_fumando THEN 'Sí' ELSE 'No' END AS fumando,
            h.nivel_riesgo_salud                       AS nivel_riesgo,
            ROUND(h.nivel_pm10::numeric, 1)            AS pm10,
            ROUND(h.temperatura::numeric, 1)           AS temperatura,
            h.calidad_aire_label
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo      = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        ORDER BY t.anio DESC, t.mes DESC, t.dia DESC, t.hora DESC, t.minuto DESC
    """)

    buf = io.StringIO()
    buf.write('﻿')  # BOM para Excel

    # Metadata del reporte
    now_str = ahora_cdmx().strftime("%Y-%m-%d %H:%M")
    intervalo = request.query_params.get("intervalo", "3650 days")
    desde = request.query_params.get("desde", "")
    hasta = request.query_params.get("hasta", "")
    campus = request.query_params.get("campus", "Todos")
    zonas  = request.query_params.get("zonas",  "Todas")
    camaras = request.query_params.get("camaras", "Todas")
    periodo = f"{desde} a {hasta}" if desde and hasta else {
        "1 day": "Últimas 24h", "7 days": "Últimos 7 días",
        "30 days": "Últimos 30 días"
    }.get(intervalo, "Histórico completo")

    writer = csv.writer(buf)
    writer.writerow(["IDU — Isla de Datos Urbanos — Exportación de Datos Procesados"])
    writer.writerow(["Generado:", now_str])
    writer.writerow(["Período:", periodo])
    writer.writerow(["Campus:", campus])
    writer.writerow(["Zonas:", zonas])
    writer.writerow(["Cámaras:", camaras])
    writer.writerow(["Total registros:", len(df)])
    writer.writerow([])

    if df.empty:
        writer.writerow(["Sin datos para los filtros seleccionados"])
    else:
        writer.writerow([
            "Timestamp (CDMX)", "Campus", "Zona", "Cámara",
            "Actividad", "Conteo Personas", "Fumando",
            "Nivel Riesgo", "PM10 (µg/m³)", "Temperatura (°C)", "Calidad Aire"
        ])
        for _, row in df.iterrows():
            writer.writerow([
                row.get("timestamp_cdmx", ""),
                row.get("campus", ""),
                row.get("zona", ""),
                row.get("camara", ""),
                row.get("actividad", ""),
                row.get("conteo_personas", ""),
                row.get("fumando", ""),
                row.get("nivel_riesgo", ""),
                row.get("pm10", ""),
                row.get("temperatura", ""),
                row.get("calidad_aire_label", ""),
            ])

    filename = f"IDU_Datos_{ahora_cdmx().strftime('%Y-%m-%d')}.csv"
    resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


# ── Exportación PDF (reporte real con tablas y gráficas) ──────
@api_view(["GET"])
def export_pdf(request):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer,
        Table, TableStyle, HRFlowable, Image as RLImage, KeepTogether,
    )
    from reportlab.lib.enums import TA_CENTER

    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)

    intervalo  = request.query_params.get("intervalo", "3650 days")
    desde      = request.query_params.get("desde", "")
    hasta      = request.query_params.get("hasta", "")
    campus_p   = request.query_params.get("campus", "")
    zonas_p    = request.query_params.get("zonas",  "")
    camaras_p  = request.query_params.get("camaras", "")
    periodo = f"{desde} a {hasta}" if desde and hasta else {
        "1 day": "Últimas 24h", "7 days": "Últimos 7 días",
        "30 days": "Últimos 30 días",
    }.get(intervalo, "Histórico completo")

    # ── Paleta ──────────────────────────────────────────────────
    C_DARK   = "#1e3a5f"
    C_BLUE   = "#2563eb"
    C_ORANGE = "#f97316"
    C_GREEN  = "#16a34a"
    C_RED    = "#dc2626"
    C_GRAY   = "#94a3b8"

    # ── Consultas ───────────────────────────────────────────────
    df_kpis = query(f"""
        SELECT
            ROUND(SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END)::numeric
                  / NULLIF(COUNT(*), 0) * 100, 1)          AS tasa_fumado,
            COUNT(*) FILTER (WHERE h.nivel_riesgo_salud = 'alto') AS eventos_riesgo,
            COUNT(DISTINCT h.actividad)
                FILTER (WHERE h.actividad IS NOT NULL
                          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia')
                                                            AS patrones_activos,
            ROUND(AVG(h.nivel_pm10)::numeric, 1)           AS pm10_promedio,
            COUNT(*)                                        AS total_eventos
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
    """)

    df_actividades = query(f"""
        SELECT
            h.actividad,
            COUNT(*) AS conteo,
            ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS porcentaje,
            SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END) AS fumadores,
            ROUND(AVG(h.nivel_pm10)::numeric, 1) AS pm10_prom
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        GROUP BY h.actividad
        ORDER BY conteo DESC
        LIMIT 10
    """)

    df_horas = query(f"""
        SELECT
            LPAD(EXTRACT(hour FROM (
                make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                - INTERVAL '6 hours'
            ))::text, 2, '0') || 'h' AS hora,
            COUNT(*) AS total,
            SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END) AS fumadores,
            ROUND(AVG(h.nivel_pm10)::numeric, 1) AS pm10_prom
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        GROUP BY 1 ORDER BY 1
    """)

    df_zona = query(f"""
        SELECT
            g.campus, g.zona,
            COUNT(*) AS total,
            SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END) AS fumadores,
            ROUND(AVG(h.nivel_pm10)::numeric, 1) AS pm10_prom,
            COUNT(*) FILTER (WHERE h.nivel_riesgo_salud = 'alto') AS riesgo_alto
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        GROUP BY g.campus, g.zona
        ORDER BY total DESC
        LIMIT 12
    """)

    df_aire = query(f"""
        WITH franjas AS (
            SELECT
                CASE
                    WHEN EXTRACT(hour FROM estampa_tiempo) < 6  THEN 'Madrugada'
                    WHEN EXTRACT(hour FROM estampa_tiempo) < 12 THEN 'Mañana'
                    WHEN EXTRACT(hour FROM estampa_tiempo) < 18 THEN 'Tarde'
                    ELSE 'Noche'
                END AS franja,
                pm10, temperatura, humedad
            FROM staging.tabla_davis
            WHERE estampa_tiempo >= NOW() - INTERVAL '{intervalo if not desde else "3650 days"}'
        )
        SELECT franja,
               ROUND(AVG(pm10)::numeric, 1)       AS pm10_prom,
               ROUND(AVG(temperatura)::numeric, 1) AS temp_prom,
               ROUND(AVG(humedad)::numeric, 1)     AS hum_prom
        FROM franjas GROUP BY franja ORDER BY franja
    """)

    df_hechos = query(f"""
        SELECT
            TO_CHAR(make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0)
                    - INTERVAL '6 hours', 'YYYY-MM-DD HH24:MI') AS timestamp_cdmx,
            g.campus, g.zona, g.camara, h.actividad,
            h.conteo_personas,
            CASE WHEN h.esta_fumando THEN 'Sí' ELSE 'No' END AS fumando,
            h.nivel_riesgo_salud AS nivel_riesgo,
            ROUND(h.nivel_pm10::numeric, 1) AS pm10
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo      t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
        ORDER BY t.anio DESC, t.mes DESC, t.dia DESC, t.hora DESC, t.minuto DESC
        LIMIT 100
    """)

    # ── Helper: figura → RLImage ────────────────────────────────
    def fig_to_img(fig, w_cm, h_cm):
        ib = io.BytesIO()
        fig.savefig(ib, format="png", dpi=150, bbox_inches="tight",
                    facecolor="white", edgecolor="none")
        plt.close(fig)
        ib.seek(0)
        return RLImage(ib, width=w_cm * cm, height=h_cm * cm)

    def styled_fig(w_in, h_in):
        fig, ax = plt.subplots(figsize=(w_in, h_in))
        fig.patch.set_facecolor("white")
        ax.set_facecolor("#f8fafc")
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color("#cbd5e1")
        ax.tick_params(colors="#475569", labelsize=7)
        ax.grid(axis="y", color="#e2e8f0", linewidth=0.6, zorder=0)
        return fig, ax

    # ── Construcción de gráficas ────────────────────────────────

    # 1. KPIs — dona fumado vs no fumado
    img_kpi = None
    if not df_kpis.empty:
        row_k = df_kpis.iloc[0]
        tasa = float(row_k.get("tasa_fumado", 0) or 0)
        fig, ax = plt.subplots(figsize=(3.2, 3.2))
        fig.patch.set_facecolor("white")
        wedges, _ = ax.pie(
            [tasa, 100 - tasa],
            colors=[C_ORANGE, C_BLUE],
            startangle=90,
            wedgeprops=dict(width=0.5, edgecolor="white", linewidth=2),
        )
        ax.text(0, 0, f"{tasa:.1f}%\nfumado", ha="center", va="center",
                fontsize=10, fontweight="bold", color=C_DARK)
        ax.set_title("Tasa de fumado", fontsize=8, color=C_DARK, pad=4)
        fig.tight_layout(pad=0.3)
        img_kpi = fig_to_img(fig, 4.5, 4.5)

    # 2. Top actividades — barras horizontales
    img_act = None
    if not df_actividades.empty:
        labels = [str(r)[:22] for r in df_actividades["actividad"]]
        vals   = df_actividades["conteo"].astype(float).tolist()
        fig, ax = styled_fig(5.5, max(2.5, len(labels) * 0.35))
        bars = ax.barh(range(len(labels)), vals, color=C_BLUE, alpha=0.85, zorder=3)
        ax.set_yticks(range(len(labels)))
        ax.set_yticklabels(labels, fontsize=7)
        ax.invert_yaxis()
        ax.set_xlabel("Frecuencia", fontsize=7, color="#475569")
        ax.set_title("Top actividades", fontsize=8, color=C_DARK, fontweight="bold")
        for bar, v in zip(bars, vals):
            ax.text(bar.get_width() + max(vals) * 0.01, bar.get_y() + bar.get_height() / 2,
                    f"{int(v)}", va="center", fontsize=6, color=C_DARK)
        fig.tight_layout(pad=0.4)
        img_act = fig_to_img(fig, 8.5, max(4, len(labels) * 0.55))

    # 3. Eventos por hora — barras apiladas total + fumadores
    img_hora = None
    if not df_horas.empty:
        horas  = df_horas["hora"].tolist()
        totals = df_horas["total"].astype(float).tolist()
        fums   = df_horas["fumadores"].astype(float).tolist()
        otros  = [max(t - f, 0) for t, f in zip(totals, fums)]
        x = range(len(horas))
        fig, ax = styled_fig(6.5, 3)
        ax.bar(x, otros, color=C_BLUE,   alpha=0.85, label="Otros",    zorder=3)
        ax.bar(x, fums,  color=C_ORANGE, alpha=0.9,  label="Fumando",
               bottom=otros, zorder=3)
        ax.set_xticks(list(x))
        ax.set_xticklabels(horas, fontsize=6, rotation=45, ha="right")
        ax.set_ylabel("Eventos", fontsize=7, color="#475569")
        ax.set_title("Distribución por hora (CDMX)", fontsize=8,
                     color=C_DARK, fontweight="bold")
        ax.legend(fontsize=6, framealpha=0.6)
        fig.tight_layout(pad=0.4)
        img_hora = fig_to_img(fig, 10, 5)

    # 4. PM10 por franja — barras con línea de temperatura
    img_aire = None
    if not df_aire.empty:
        franjas = df_aire["franja"].tolist()
        pm10s   = df_aire["pm10_prom"].astype(float).fillna(0).tolist()
        temps   = df_aire["temp_prom"].astype(float).fillna(0).tolist()
        x = range(len(franjas))
        fig, ax1 = plt.subplots(figsize=(5, 3))
        fig.patch.set_facecolor("white")
        ax1.set_facecolor("#f8fafc")
        ax1.spines[["top", "right"]].set_color("#cbd5e1")
        ax1.spines[["left", "bottom"]].set_color("#cbd5e1")

        bar_colors = [
            C_GREEN if p < 54 else C_ORANGE if p < 154 else C_RED
            for p in pm10s
        ]
        bars = ax1.bar(x, pm10s, color=bar_colors, alpha=0.8, zorder=3, width=0.5)
        ax1.axhline(54,  color=C_GREEN,  linestyle="--", linewidth=0.8, alpha=0.7)
        ax1.axhline(154, color=C_ORANGE, linestyle="--", linewidth=0.8, alpha=0.7)
        ax1.set_xticks(list(x))
        ax1.set_xticklabels(franjas, fontsize=7)
        ax1.set_ylabel("PM10 (µg/m³)", fontsize=7, color="#475569")
        ax1.tick_params(colors="#475569", labelsize=7)
        ax1.grid(axis="y", color="#e2e8f0", linewidth=0.6, zorder=0)
        ax1.spines[["top", "right"]].set_visible(False)

        ax2 = ax1.twinx()
        ax2.plot(list(x), temps, color=C_RED, marker="o", markersize=4,
                 linewidth=1.5, label="Temp °C", zorder=4)
        ax2.set_ylabel("Temperatura (°C)", fontsize=7, color=C_RED)
        ax2.tick_params(colors=C_RED, labelsize=7)
        ax2.spines[["top"]].set_visible(False)

        ax1.set_title("Calidad del aire por franja", fontsize=8,
                      color=C_DARK, fontweight="bold")
        lines2, labs2 = ax2.get_legend_handles_labels()
        ax1.legend(lines2, labs2, fontsize=6, loc="upper right", framealpha=0.6)
        fig.tight_layout(pad=0.4)
        img_aire = fig_to_img(fig, 8, 5)

    # 5. Eventos por zona — barras horizontales con fumadores
    img_zona = None
    if not df_zona.empty:
        zona_labels = [
            f"{str(r.get('zona',''))[:18]}" for _, r in df_zona.iterrows()
        ]
        z_total = df_zona["total"].astype(float).tolist()
        z_fums  = df_zona["fumadores"].astype(float).tolist()
        z_otros = [max(t - f, 0) for t, f in zip(z_total, z_fums)]
        y = range(len(zona_labels))
        fig, ax = styled_fig(5.5, max(2.5, len(zona_labels) * 0.38))
        ax.barh(list(y), z_otros, color=C_BLUE,   alpha=0.85, label="Otros",  zorder=3)
        ax.barh(list(y), z_fums,  color=C_ORANGE, alpha=0.9,  label="Fumando",
                left=z_otros, zorder=3)
        ax.set_yticks(list(y))
        ax.set_yticklabels(zona_labels, fontsize=7)
        ax.invert_yaxis()
        ax.set_xlabel("Eventos", fontsize=7, color="#475569")
        ax.set_title("Eventos por zona", fontsize=8, color=C_DARK, fontweight="bold")
        ax.legend(fontsize=6, framealpha=0.6)
        fig.tight_layout(pad=0.4)
        img_zona = fig_to_img(fig, 8.5, max(4, len(zona_labels) * 0.6))

    # ── Estilos reportlab ───────────────────────────────────────
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=1.5*cm, rightMargin=1.5*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
    )

    styles   = getSampleStyleSheet()
    COLOR_RL = colors.HexColor(C_DARK)
    COLOR_ALT = colors.HexColor("#eef2f7")
    COLOR_ACC = colors.HexColor(C_BLUE)

    h1 = ParagraphStyle("h1", parent=styles["Heading1"],
         textColor=COLOR_RL, fontSize=15, spaceAfter=3)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"],
         textColor=COLOR_ACC, fontSize=10, spaceBefore=10, spaceAfter=3)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=7, leading=10)
    meta = ParagraphStyle("meta", parent=styles["Normal"],
           fontSize=7.5, textColor=colors.HexColor("#555555"))
    foot = ParagraphStyle("foot", parent=styles["Normal"],
           fontSize=6.5, textColor=colors.HexColor("#888888"), alignment=TA_CENTER)

    now_str = ahora_cdmx().strftime("%d/%m/%Y %H:%M")

    def tbl_style():
        return TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0),   COLOR_RL),
            ("TEXTCOLOR",      (0, 0), (-1, 0),   colors.white),
            ("FONTSIZE",       (0, 0), (-1, 0),   7.5),
            ("FONTNAME",       (0, 0), (-1, 0),   "Helvetica-Bold"),
            ("ALIGN",          (0, 0), (-1, 0),   "CENTER"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),  [colors.white, COLOR_ALT]),
            ("FONTSIZE",       (0, 1), (-1, -1),  6.5),
            ("FONTNAME",       (0, 1), (-1, -1),  "Helvetica"),
            ("GRID",           (0, 0), (-1, -1),  0.3, colors.HexColor("#cccccc")),
            ("VALIGN",         (0, 0), (-1, -1),  "MIDDLE"),
            ("TOPPADDING",     (0, 0), (-1, -1),  2.5),
            ("BOTTOMPADDING",  (0, 0), (-1, -1),  2.5),
        ])

    # helper: pone tabla e imagen lado a lado en una fila
    def side_by_side(left_widget, right_widget, left_w, right_w, pad=0.3*cm):
        outer = Table(
            [[left_widget, right_widget]],
            colWidths=[left_w, right_w],
        )
        outer.setStyle(TableStyle([
            ("VALIGN",  (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",  (1, 0), (1, 0), pad),
            ("RIGHTPADDING", (0, 0), (0, 0), pad),
        ]))
        return outer

    story = []

    # ─ Encabezado ───────────────────────────────────────────────
    story.append(Paragraph("ISLA DE DATOS URBANOS — Reporte Analítico", h1))
    story.append(Paragraph(
        f"Generado: {now_str} CDMX &nbsp;|&nbsp; Período: {periodo} &nbsp;|&nbsp; "
        f"Campus: {campus_p or 'Todos'} &nbsp;|&nbsp; "
        f"Zonas: {zonas_p or 'Todas'} &nbsp;|&nbsp; "
        f"Cámaras: {camaras_p or 'Todas'}",
        meta,
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=COLOR_RL, spaceAfter=6))

    # ─ KPIs ─────────────────────────────────────────────────────
    story.append(Paragraph("Indicadores Clave del Período", h2))
    if not df_kpis.empty:
        row_k = df_kpis.iloc[0]
        kpi_data = [
            ["Total Eventos", "Tasa Fumado", "Eventos Riesgo Alto",
             "Patrones Activos", "PM10 Promedio"],
            [
                str(int(row_k.get("total_eventos", 0) or 0)),
                f"{float(row_k.get('tasa_fumado', 0) or 0):.1f}%",
                str(int(row_k.get("eventos_riesgo", 0) or 0)),
                str(int(row_k.get("patrones_activos", 0) or 0)),
                f"{float(row_k.get('pm10_promedio', 0) or 0):.1f} µg/m³",
            ],
        ]
        kpi_tbl = Table(kpi_data, colWidths=[4.8*cm] * 5)
        kpi_tbl.setStyle(tbl_style())
        if img_kpi:
            story.append(side_by_side(kpi_tbl, img_kpi,
                                      left_w=24.5*cm, right_w=4.8*cm))
        else:
            story.append(kpi_tbl)

    # ─ Top actividades ───────────────────────────────────────────
    story.append(Paragraph("Top Actividades Detectadas", h2))
    if not df_actividades.empty:
        act_data = [["Actividad", "Frecuencia", "% Total", "Fumadores", "PM10 Prom"]]
        for _, r in df_actividades.iterrows():
            act_data.append([
                str(r.get("actividad", "")),
                str(int(r.get("conteo", 0) or 0)),
                f"{float(r.get('porcentaje', 0) or 0):.1f}%",
                str(int(r.get("fumadores", 0) or 0)),
                str(r.get("pm10_prom", "") or "—"),
            ])
        act_tbl = Table(act_data, colWidths=[7*cm, 2.5*cm, 2.5*cm, 2.5*cm, 2.5*cm])
        act_tbl.setStyle(tbl_style())
        if img_act:
            story.append(KeepTogether(
                side_by_side(act_tbl, img_act, left_w=17*cm, right_w=12.3*cm)
            ))
        else:
            story.append(act_tbl)
    else:
        story.append(Paragraph("Sin datos de actividades para el período.", body))

    # ─ Eventos por hora ─────────────────────────────────────────
    story.append(Paragraph("Distribución de Eventos por Hora (CDMX)", h2))
    if not df_horas.empty:
        hora_data = [["Hora", "Total", "Fumadores", "PM10 Prom"]]
        for _, r in df_horas.iterrows():
            hora_data.append([
                str(r.get("hora", "")),
                str(int(r.get("total", 0) or 0)),
                str(int(r.get("fumadores", 0) or 0)),
                str(r.get("pm10_prom", "") or "—"),
            ])
        hora_tbl = Table(hora_data, colWidths=[2.5*cm, 2.5*cm, 2.5*cm, 2.5*cm])
        hora_tbl.setStyle(tbl_style())
        if img_hora:
            story.append(KeepTogether(
                side_by_side(hora_tbl, img_hora, left_w=10.5*cm, right_w=18.8*cm)
            ))
        else:
            story.append(hora_tbl)
    else:
        story.append(Paragraph("Sin datos horarios para el período.", body))

    # ─ Calidad del aire ──────────────────────────────────────────
    story.append(Paragraph("Calidad del Aire por Franja Horaria", h2))
    if not df_aire.empty:
        aire_data = [["Franja", "PM10 Prom (µg/m³)", "Temp Prom (°C)", "Humedad (%)"]]
        for _, r in df_aire.iterrows():
            pm10_v = float(r.get("pm10_prom", 0) or 0)
            calidad = (
                "Buena" if pm10_v < 54
                else "Moderada" if pm10_v < 154
                else "Insalubre (s.)" if pm10_v < 254
                else "Insalubre"
            )
            aire_data.append([
                str(r.get("franja", "")),
                f"{pm10_v:.1f} ({calidad})",
                str(r.get("temp_prom", "") or "—"),
                str(r.get("hum_prom", "") or "—"),
            ])
        aire_tbl = Table(aire_data, colWidths=[3*cm, 4.5*cm, 3*cm, 3*cm])
        aire_tbl.setStyle(tbl_style())
        if img_aire:
            story.append(KeepTogether(
                side_by_side(aire_tbl, img_aire, left_w=13.5*cm, right_w=15.8*cm)
            ))
        else:
            story.append(aire_tbl)
    else:
        story.append(Paragraph("Sin datos ambientales para el período.", body))

    # ─ Por zona ──────────────────────────────────────────────────
    story.append(Paragraph("Eventos por Campus y Zona", h2))
    if not df_zona.empty:
        zona_data = [["Campus", "Zona", "Total", "Fumadores", "PM10 Prom", "Riesgo Alto"]]
        for _, r in df_zona.iterrows():
            zona_data.append([
                str(r.get("campus", "")),
                str(r.get("zona", "")),
                str(int(r.get("total", 0) or 0)),
                str(int(r.get("fumadores", 0) or 0)),
                str(r.get("pm10_prom", "") or "—"),
                str(int(r.get("riesgo_alto", 0) or 0)),
            ])
        zona_tbl = Table(zona_data,
                         colWidths=[4.5*cm, 4*cm, 2.5*cm, 2.5*cm, 2.5*cm, 2.5*cm])
        zona_tbl.setStyle(tbl_style())
        if img_zona:
            story.append(KeepTogether(
                side_by_side(zona_tbl, img_zona, left_w=18.5*cm, right_w=10.8*cm)
            ))
        else:
            story.append(zona_tbl)
    else:
        story.append(Paragraph("Sin datos geográficos para el período.", body))

    # ─ Registros recientes ───────────────────────────────────────
    story.append(Paragraph("Registros del Período (hasta 100 más recientes)", h2))
    if not df_hechos.empty:
        hecho_data = [[
            "Timestamp (CDMX)", "Campus", "Zona", "Cámara",
            "Actividad", "Personas", "Fumando", "Riesgo", "PM10",
        ]]
        for _, r in df_hechos.iterrows():
            hecho_data.append([
                str(r.get("timestamp_cdmx", "")),
                str(r.get("campus", "")),
                str(r.get("zona", "")),
                str(r.get("camara", "")),
                str(r.get("actividad", "")),
                str(r.get("conteo_personas", "")),
                str(r.get("fumando", "")),
                str(r.get("nivel_riesgo", "")),
                str(r.get("pm10", "")),
            ])
        col_w = [3.5*cm, 3*cm, 3*cm, 2.5*cm, 4.5*cm, 2*cm, 2*cm, 2*cm, 2*cm]
        hecho_tbl = Table(hecho_data, colWidths=col_w)
        hecho_tbl.setStyle(tbl_style())
        story.append(hecho_tbl)
    else:
        story.append(Paragraph("Sin registros para el período y filtros seleccionados.", body))

    story.append(Spacer(1, 0.4*cm))
    story.append(HRFlowable(width="100%", thickness=0.4, color=colors.HexColor("#aaaaaa")))
    story.append(Paragraph(
        "IDU · Instituto Politécnico Nacional · CDMX — Reporte generado automáticamente",
        foot,
    ))

    doc.build(story)
    buf.seek(0)

    filename = f"IDU_Reporte_{ahora_cdmx().strftime('%Y-%m-%d')}.pdf"
    resp = HttpResponse(buf.read(), content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


# ── Contexto Social (Propuesta 1) ──────────────────────────────
@api_view(["GET"])
@api_cache(timeout=300)
def contexto_social(request):
    ff = filtro_fecha(request)
    fc = filtro_camaras(request)
    ffum = filtro_fumando(request)
    
    df = query(f"""
        SELECT 
            h.actividad,
            h.esta_fumando,
            h.conteo_personas,
            g.campus,
            g.zona,
            {_SQL_HORA_CDMX} AS hora_cdmx
        FROM warehouse.hechos_actividades_escenaurbana h
        JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
        JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
        WHERE {ff} AND {fc} AND {ffum}
          AND h.actividad IS NOT NULL
          AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
    """)
    
    if df.empty:
        return Response({
            "por_contexto": [],
            "fumado_solo": 0,
            "fumado_pareja": 0,
            "fumado_grupo": 0,
            "total_fumado": 0,
            "total_observaciones": 0,
            "por_hora": [],
        })
    
    total_observaciones = int(len(df))
    
    # Clasificar por contexto social basado en conteo_personas
    def clasificar_contexto(row):
        personas = row["conteo_personas"] or 1
        if personas == 1:
            return "Solo"
        elif personas == 2:
            return "Pareja"
        else:
            return "Grupo"
    
    df["contexto"] = df.apply(clasificar_contexto, axis=1)
    
    # Estadísticas de fumado por contexto
    fumado_stats = (
        df[df["esta_fumando"] == True]
        .groupby("contexto")
        .size()
        .reset_index(name="eventos")
    )
    
    total_fumado = int(fumado_stats["eventos"].sum())
    
    por_contexto = []
    for _, row in fumado_stats.iterrows():
        por_contexto.append({
            "contexto": row["contexto"],
            "eventos": int(row["eventos"]),
            "porcentaje": round(row["eventos"] / total_fumado * 100, 1) if total_fumado > 0 else 0,
        })
    
    # Total por contexto (no solo fumado)
    total_contexto = (
        df.groupby("contexto")
        .size()
        .reset_index(name="total")
    )
    
    for item in por_contexto:
        total = total_contexto[total_contexto["contexto"] == item["contexto"]]["total"]
        item["total_contexto"] = int(total.iloc[0]) if not total.empty else 0
        item["tasa_fumado"] = round(item["eventos"] / item["total_contexto"] * 100, 1) if item["total_contexto"] > 0 else 0
    
    # Eventos de fumado por hora CDMX + contexto
    por_hora = []
    if total_fumado > 0:
        df_fumado = df[df["esta_fumando"] == True].copy()
        hora_groups = (
            df_fumado.groupby(["hora_cdmx", "contexto"])
            .size()
            .reset_index(name="count")
        )
        horas_unicas = sorted(hora_groups["hora_cdmx"].unique())
        for h in horas_unicas:
            subset = hora_groups[hora_groups["hora_cdmx"] == h]
            row = {"hora": int(h), "Solo": 0, "Pareja": 0, "Grupo": 0}
            for _, sr in subset.iterrows():
                row[sr["contexto"]] = int(sr["count"])
            por_hora.append(row)
    
    return Response({
        "por_contexto": por_contexto,
        "fumado_solo": int(fumado_stats[fumado_stats["contexto"] == "Solo"]["eventos"].sum()) if not fumado_stats.empty else 0,
        "fumado_pareja": int(fumado_stats[fumado_stats["contexto"] == "Pareja"]["eventos"].sum()) if not fumado_stats.empty else 0,
        "fumado_grupo": int(fumado_stats[fumado_stats["contexto"] == "Grupo"]["eventos"].sum()) if not fumado_stats.empty else 0,
        "total_fumado": total_fumado,
        "total_observaciones": total_observaciones,
        "por_hora": por_hora,
    })


# ── Tendencias Evolutivas (Propuesta 6) ─────────────────────────
@api_view(["GET"])
@api_cache(timeout=600)
def tendencias_fumado(request):
    try:
        ff = filtro_fecha(request)
        fc = filtro_camaras(request)
        ffum = filtro_fumando(request)
        intervalo = request.query_params.get("intervalo", "3650 days")
        
        # Determinar agrupación temporal
        agrupacion = request.query_params.get("agrupacion", "mes")  # mes, semana, dia
        
        if agrupacion == "semana":
            periodo_expr = """
                DATE_TRUNC('week', (
                    make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                    - INTERVAL '6 hours'
                ))::date
            """
            label_fmt = "Semana del %Y-%m-%d"
        elif agrupacion == "dia":
            periodo_expr = """
                (make_timestamp(t.anio, t.mes, t.dia, 0, 0, 0)
                 - INTERVAL '6 hours')::date
            """
            label_fmt = "%Y-%m-%d"
        else:  # mes por defecto
            periodo_expr = """
                DATE_TRUNC('month', (
                    make_timestamp(t.anio, t.mes, t.dia, t.hora, t.minuto, 0)
                    - INTERVAL '6 hours'
                ))::date
            """
            label_fmt = "%Y-%m"
        
        df = query(f"""
            WITH datos AS (
                SELECT 
                    {periodo_expr} AS periodo,
                    COUNT(*) AS total,
                    SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END) AS fumado,
                    AVG(h.nivel_pm10) AS pm10_promedio
                FROM warehouse.hechos_actividades_escenaurbana h
                JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
                JOIN warehouse.dim_geoespacial g ON h.id_geoespacial = g.id_geoespacial
                WHERE {ff} AND {fc} AND {ffum}
                  AND h.actividad IS NOT NULL
                  AND LOWER(h.actividad) NOT LIKE 'ausencia%%' AND h.actividad != 'escena_vacia'
                GROUP BY 1
                ORDER BY 1
            )
            SELECT 
                periodo,
                total,
                fumado,
                ROUND((fumado::numeric / NULLIF(total, 0) * 100), 1) AS tasa_fumado,
                ROUND(pm10_promedio::numeric, 1) AS pm10_promedio
            FROM datos
        """)
        
        if df.empty:
            return Response({
                "tendencias": [],
                "resumen": {
                    "tasa_inicial": None,
                    "tasa_final": None,
                    "cambio_pct": None,
                    "tendencia": "estable",
                }
            })
        
        # Convertir a formato para el frontend
        tendencias = []
        for _, row in df.iterrows():
            try:
                if hasattr(row["periodo"], 'strftime'):
                    periodo_str = row["periodo"].strftime(label_fmt)
                else:
                    periodo_str = str(row["periodo"])
            except:
                periodo_str = str(row["periodo"])
            
            tendencias.append({
                "periodo": periodo_str,
                "total": int(row["total"]),
                "fumado": int(row["fumado"]),
                "tasa_fumado": _safe(row["tasa_fumado"]) or 0.0,
                "pm10_promedio": _safe(row["pm10_promedio"]),
            })
        
        # Calcular resumen de tendencia
        if len(tendencias) >= 2:
            tasa_inicial = tendencias[0]["tasa_fumado"]
            tasa_final = tendencias[-1]["tasa_fumado"]
            cambio_pct = round(((tasa_final - tasa_inicial) / tasa_inicial * 100), 1) if tasa_inicial > 0 else 0
            
            if cambio_pct > 5:
                tendencia = "subiendo"
            elif cambio_pct < -5:
                tendencia = "bajando"
            else:
                tendencia = "estable"
        else:
            tasa_inicial = tendencias[0]["tasa_fumado"] if tendencias else None
            tasa_final = tasa_inicial
            cambio_pct = 0
            tendencia = "estable"
        
        return Response({
            "tendencias": tendencias,
            "resumen": {
                "tasa_inicial": tasa_inicial,
                "tasa_final": tasa_final,
                "cambio_pct": cambio_pct,
                "tendencia": tendencia,
            }
        })
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        return Response({
            "error": str(e),
            "detail": error_detail,
            "tendencias": [],
            "resumen": {"tendencia": "error"}
        }, status=500)
