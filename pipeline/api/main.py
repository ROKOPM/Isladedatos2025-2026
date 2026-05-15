"""
API REST — Isla de Datos Urbanos
Expone los datos del warehouse para integracion externa.

Endpoints:
  GET /health              — estado del servicio
  GET /api/stats           — KPIs generales del pipeline
  GET /api/hechos/latest   — ultimos N hechos
  GET /api/clusters        — patrones de actividad con frecuencia
  GET /api/alertas         — alertas activas segun umbrales configurados
  GET /api/calidad         — metricas de calidad IA

Variables de entorno:
  DATABASE_URL           — DSN de PostgreSQL
  ALERTA_UMBRAL_FUMADO   — % tasa fumado para disparar alerta (default 20)
  ALERTA_UMBRAL_PM10     — ug/m3 de PM10 para alerta (default 54)
  API_KEY                — clave simple para autenticacion (default: sin auth)
"""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import asyncpg
from fastapi import FastAPI, Query, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware

DB_DSN               = os.getenv("DATABASE_URL",
    "postgresql://postgres:postgres@isla_postgres:5432/postgres")
UMBRAL_FUMADO        = float(os.getenv("ALERTA_UMBRAL_FUMADO", "20"))
UMBRAL_PM10          = float(os.getenv("ALERTA_UMBRAL_PM10",   "54"))
API_KEY              = os.getenv("API_KEY", "")   # vacio = sin autenticacion

# CDMX = UTC-6 fijo (sin DST desde 2023)
CDMX_TZ = timezone(timedelta(hours=-6))

app = FastAPI(
    title="Isla de Datos Urbanos — API",
    description="API REST del observatorio de comportamiento urbano ESCOM IPN",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Pool de conexiones (creado al arrancar) ───────────────────
_pool: asyncpg.Pool | None = None


@app.on_event("startup")
async def startup():
    global _pool
    _pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=5)


@app.on_event("shutdown")
async def shutdown():
    if _pool:
        await _pool.close()


def _verificar_api_key(x_api_key: Optional[str]):
    """Verifica API key si esta configurada. Sin config = acceso libre."""
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="API key invalida")


def _ahora_cdmx() -> str:
    return datetime.now(CDMX_TZ).strftime("%Y-%m-%d %H:%M:%S CDMX")


# ── /health ───────────────────────────────────────────────────
@app.get("/health", tags=["Sistema"])
async def health():
    try:
        async with _pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "ok", "hora_cdmx": _ahora_cdmx(), "db": "conectada"}
    except Exception as e:
        return {"status": "error", "detalle": str(e)}


# ── /api/stats ────────────────────────────────────────────────
@app.get("/api/stats", tags=["Datos"])
async def stats(
    dias: int = Query(30, ge=1, le=3650, description="Ventana de dias hacia atras"),
    x_api_key: Optional[str] = Header(None)
):
    """KPIs generales del pipeline para el periodo solicitado."""
    _verificar_api_key(x_api_key)
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(f"""
            SELECT
                COUNT(*)                                                       AS total_eventos,
                COALESCE(SUM(h.conteo_personas), 0)                           AS total_personas,
                ROUND(100.0 * SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END)
                      / NULLIF(COUNT(*), 0), 2)                               AS tasa_fumado_pct,
                ROUND(AVG(h.nivel_pm10)::numeric, 2)                          AS pm10_promedio,
                COUNT(DISTINCT h.actividad)
                    FILTER (WHERE h.actividad IS NOT NULL
                              AND LOWER(h.actividad) NOT LIKE 'ausencia%%')   AS patrones_activos
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            WHERE t.fecha_completa >= CURRENT_DATE - INTERVAL '{dias} days'
        """)

        staging = await conn.fetchrow("""
            SELECT
                SUM(CASE WHEN estado_envio = 'pendiente'  THEN 1 ELSE 0 END) AS pendientes,
                SUM(CASE WHEN estado_envio = 'completado' THEN 1 ELSE 0 END) AS completados,
                SUM(CASE WHEN estado_envio LIKE 'error%%' THEN 1 ELSE 0 END) AS errores
            FROM staging.tabla_central
        """)

    return {
        "periodo_dias":    dias,
        "hora_cdmx":       _ahora_cdmx(),
        "warehouse": {
            "total_eventos":    int(row["total_eventos"] or 0),
            "total_personas":   int(row["total_personas"] or 0),
            "tasa_fumado_pct":  float(row["tasa_fumado_pct"] or 0),
            "pm10_promedio":    float(row["pm10_promedio"] or 0),
            "patrones_activos": int(row["patrones_activos"] or 0),
        },
        "pipeline": {
            "pendientes":  int(staging["pendientes"]  or 0),
            "completados": int(staging["completados"] or 0),
            "errores":     int(staging["errores"]     or 0),
        }
    }


# ── /api/hechos/latest ────────────────────────────────────────
@app.get("/api/hechos/latest", tags=["Datos"])
async def hechos_latest(
    limit: int = Query(20, ge=1, le=200),
    x_api_key: Optional[str] = Header(None)
):
    """Ultimos N hechos registrados."""
    _verificar_api_key(x_api_key)
    async with _pool.acquire() as conn:
        filas = await conn.fetch("""
            SELECT
                h.id_hecho,
                TO_CHAR(
                    make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0)
                    - INTERVAL '6 hours',
                    'YYYY-MM-DD HH24:MI'
                ) || ' CDMX'               AS timestamp_cdmx,
                h.actividad,
                h.postura_dominante,
                h.interaccion_social,
                h.esta_fumando,
                h.conteo_personas,
                h.nivel_riesgo_salud,
                ROUND(h.nivel_pm10::numeric, 1) AS pm10,
                h.resumen_semantico,
                h.smoking_source,
                h.yolo_cigarette_conf
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            ORDER BY h.id_hecho DESC
            LIMIT $1
        """, limit)

    return [dict(f) for f in filas]


# ── /api/clusters ─────────────────────────────────────────────
@app.get("/api/clusters", tags=["Datos"])
async def clusters(
    dias: int = Query(30, ge=1, le=3650),
    excluir_ausencia: bool = Query(True),
    x_api_key: Optional[str] = Header(None)
):
    """Patrones de actividad con frecuencia y metricas ambientales."""
    _verificar_api_key(x_api_key)
    filtro_ausencia = (
        "AND LOWER(h.actividad) NOT LIKE 'ausencia%%'"
        if excluir_ausencia else ""
    )
    async with _pool.acquire() as conn:
        filas = await conn.fetch(f"""
            SELECT
                h.actividad                                 AS nombre,
                COUNT(*)                                    AS frecuencia,
                ROUND(AVG(h.nivel_pm10)::numeric, 2)        AS pm10_avg,
                SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END) AS n_fumando
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            WHERE h.actividad IS NOT NULL
              AND t.fecha_completa >= CURRENT_DATE - INTERVAL '{dias} days'
              {filtro_ausencia}
            GROUP BY h.actividad
            ORDER BY frecuencia DESC
        """)

    return [dict(f) for f in filas]


# ── /api/alertas ──────────────────────────────────────────────
@app.get("/api/alertas", tags=["Alertas"])
async def alertas_activas(
    x_api_key: Optional[str] = Header(None)
):
    """
    Alertas activas basadas en la ultima hora de datos.
    Umbrales configurables via ALERTA_UMBRAL_FUMADO y ALERTA_UMBRAL_PM10.
    """
    _verificar_api_key(x_api_key)
    async with _pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                COUNT(*) AS n,
                ROUND(100.0 * SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END)
                      / NULLIF(COUNT(*), 0), 2) AS tasa_fumado,
                ROUND(AVG(h.nivel_pm10)::numeric, 2) AS pm10_avg
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            WHERE make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0)
                  >= NOW() - INTERVAL '1 hour'
        """)

    alertas = []
    tasa   = float(row["tasa_fumado"] or 0)
    pm10   = float(row["pm10_avg"]    or 0)
    n_obs  = int(row["n"]             or 0)

    if n_obs == 0:
        alertas.append({
            "nivel": "info",
            "tipo":  "sin_datos",
            "mensaje": "Sin observaciones en la ultima hora"
        })
    else:
        if tasa >= UMBRAL_FUMADO:
            alertas.append({
                "nivel":   "critico" if tasa >= UMBRAL_FUMADO * 1.5 else "advertencia",
                "tipo":    "tasa_fumado",
                "mensaje": f"Tasa de fumado {tasa:.1f}% supera umbral {UMBRAL_FUMADO:.0f}%",
                "valor":   tasa,
                "umbral":  UMBRAL_FUMADO
            })
        if pm10 >= UMBRAL_PM10:
            alertas.append({
                "nivel":   "critico" if pm10 >= 154 else "advertencia",
                "tipo":    "pm10",
                "mensaje": f"PM10 {pm10:.1f} ug/m3 supera umbral {UMBRAL_PM10:.0f} ug/m3",
                "valor":   pm10,
                "umbral":  UMBRAL_PM10
            })

    return {
        "hora_cdmx":       _ahora_cdmx(),
        "observaciones_1h": n_obs,
        "tasa_fumado_pct": tasa,
        "pm10_promedio":   pm10,
        "umbrales": {
            "fumado_pct": UMBRAL_FUMADO,
            "pm10_ugm3":  UMBRAL_PM10
        },
        "alertas": alertas,
        "estado":  "ok" if not any(a["nivel"] == "critico" for a in alertas) else "critico"
    }


# ── /api/calidad ──────────────────────────────────────────────
@app.get("/api/calidad", tags=["Calidad IA"])
async def calidad_ia(
    dias: int = Query(30, ge=1, le=3650),
    x_api_key: Optional[str] = Header(None)
):
    """Metricas de calidad del pipeline IA: smoking cross-val, vectorizacion."""
    _verificar_api_key(x_api_key)
    async with _pool.acquire() as conn:
        hechos = await conn.fetchrow(f"""
            SELECT
                COUNT(*)                                                            AS total,
                SUM(CASE WHEN h.smoking_source = 'confirmado_ambos'    THEN 1 ELSE 0 END) AS confirmado_ambos,
                SUM(CASE WHEN h.smoking_source = 'alucinacion_llava'   THEN 1 ELSE 0 END) AS alucinacion_llava,
                SUM(CASE WHEN h.smoking_source = 'solo_llava_sin_cigarro' THEN 1 ELSE 0 END) AS solo_llava,
                SUM(CASE WHEN h.smoking_source = 'sin_datos_yolo'      THEN 1 ELSE 0 END) AS sin_datos_yolo
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON h.id_tiempo = t.id_tiempo
            WHERE t.fecha_completa >= CURRENT_DATE - INTERVAL '{dias} days'
        """)

        vectores = await conn.fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE vector_habito IS NOT NULL) AS con_vector,
                COUNT(*) FILTER (WHERE umap_x IS NOT NULL)        AS con_umap
            FROM warehouse.hechos_vectores_descripcion_habitos
        """)

    total = int(hechos["total"] or 1)
    return {
        "periodo_dias": dias,
        "hechos": {
            "total": int(hechos["total"] or 0),
        },
        "smoking_cross_val": {
            "confirmado_ambos":    int(hechos["confirmado_ambos"]    or 0),
            "alucinacion_llava":   int(hechos["alucinacion_llava"]   or 0),
            "solo_llava_sin_cigarro": int(hechos["solo_llava"]       or 0),
            "sin_datos_yolo":      int(hechos["sin_datos_yolo"]      or 0),
        },
        "vectores": {
            "con_vector": int(vectores["con_vector"] or 0),
            "con_umap":   int(vectores["con_umap"]   or 0),
        }
    }
