"""
reprocesar.py — Reprocesa todos los hechos del warehouse con el nuevo prompt Qwen enriquecido.
Mantiene los timestamps originales (dim_tiempo no cambia).
Ejecutar dentro del contenedor isla_qwen:
    docker exec isla_qwen python reprocesar.py

Flujo por registro:
  1. Leer vector_bruto + estampa_tiempo de staging.tabla_central (completado)
  2. Llamar Qwen con el nuevo prompt (incluye hora, día, franja horaria)
  3. En una transacción: DELETE hecho antiguo + INSERT hecho nuevo con los mismos ids de dimensión
  4. Actualizar staging con nueva confianza/fumador_valido
"""

import asyncio
import json
import logging
import os
import sys
import time

import asyncpg
import httpx

# qwen_worker.py está en el mismo /app — importar funciones reutilizables
from qwen_worker import (
    CAMARA, CAMPUS, CONFIANZA_FUMADO_UMBRAL, DB_DSN, OLLAMA_URL,
    QWEN_MODEL, ZONA,
    _calidad_aire,
    construir_prompt_qwen,
    detectar_baja_calidad_llava,
    llamar_qwen,
    normalizar_actividad,
    validar_coherencia,
    validar_fumado_cruzado,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [REPRO] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("reprocesar")

# Concurrencia: 1 llamada Qwen a la vez para no saturar la GPU
WORKERS = 1


async def reprocesar_registro(
    conn: asyncpg.Connection,
    client: httpx.AsyncClient,
    id_central: int,
    ts,
    vector_bruto: dict,
    idx: int,
    total: int,
):
    clima          = vector_bruto.get("clima_davis") or {}
    vision_original = vector_bruto.get("vision_llava") or {}
    if isinstance(vision_original, str):
        try:
            vision_original = json.loads(vision_original)
        except Exception:
            vision_original = {}

    smoking_det = vector_bruto.get("smoking_detection")

    # ── Llamar Qwen con el nuevo prompt ──────────────────────────
    try:
        prompt  = construir_prompt_qwen(vector_bruto, ts)
        analisis = await llamar_qwen(client, prompt)
    except Exception as e:
        log.error("[%d/%d] id=%d Qwen falló: %s", idx, total, id_central, e)
        return False

    # ── Validación coherencia + cross-val YOLO ───────────────────
    baja_llava              = detectar_baja_calidad_llava(vision_original)
    baja_qwen, alertas_str  = validar_coherencia(analisis, clima, id_central)
    smoking_source, yolo_conf = validar_fumado_cruzado(analisis, smoking_det)

    # ── Calidad de aire ──────────────────────────────────────────
    pm10 = clima.get("pm10") if clima else None
    temp = clima.get("temp") if clima else None
    hum  = clima.get("hum")  if clima else None

    if pm10 is None:        calidad = "sin_dato"
    elif pm10 < 54:         calidad = "buena"
    elif pm10 < 154:        calidad = "moderada"
    elif pm10 < 254:        calidad = "insalubre_sensibles"
    else:                   calidad = "insalubre"

    # ── Recuperar ids de dimensión existentes ────────────────────
    # dim_tiempo: ON CONFLICT en el worker ya lo creó con el ts original
    id_tiempo = await conn.fetchval("""
        SELECT id_tiempo FROM warehouse.dim_tiempo
        WHERE fecha_completa = $1 AND hora = $2 AND minuto = $3
        LIMIT 1
    """, ts.date(), ts.hour, ts.minute)

    if not id_tiempo:
        # En caso raro de que dim_tiempo no exista, lo creamos igual que el worker
        id_tiempo = await conn.fetchval("""
            INSERT INTO warehouse.dim_tiempo
                (estampa_tiempo, fecha_completa, anio, mes, dia, dia_semana, hora, minuto, id_calendario)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                (SELECT id_calendario FROM warehouse.subcat_calendario
                 WHERE fecha_oficial = $2 LIMIT 1))
            ON CONFLICT (fecha_completa, hora, minuto) DO UPDATE
                SET anio = EXCLUDED.anio
            RETURNING id_tiempo
        """,
            ts, ts.date(), ts.year, ts.month, ts.day,
            ts.strftime("%A"), ts.hour, ts.minute,
        )

    id_geo = await conn.fetchval("""
        SELECT id_geoespacial FROM warehouse.dim_geoespacial
        WHERE camara = $1 LIMIT 1
    """, CAMARA)
    if not id_geo:
        id_geo = await conn.fetchval("""
            INSERT INTO warehouse.dim_geoespacial (campus, zona, camara)
            VALUES ($1,$2,$3) RETURNING id_geoespacial
        """, CAMPUS, ZONA, CAMARA)

    # ── Transacción: borrar hecho viejo + insertar nuevo ─────────
    try:
        async with conn.transaction():
            await conn.execute("""
                DELETE FROM warehouse.hechos_actividades_escenaurbana
                WHERE id_central_origen = $1
            """, id_central)

            await conn.fetchval("""
                INSERT INTO warehouse.hechos_actividades_escenaurbana
                    (id_tiempo, id_geoespacial,
                     esta_fumando, actividad, postura_dominante, interaccion_social,
                     objetos_detectados, resumen_semantico,
                     presencia_humana, conteo_personas, nivel_riesgo_salud,
                     nivel_pm10, temperatura, humedad, calidad_aire_label,
                     id_central_origen,
                     smoking_source, yolo_cigarette_conf)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                RETURNING id_hecho
            """,
                id_tiempo, id_geo,
                analisis.get("esta_fumando", False),
                normalizar_actividad(analisis.get("actividad"), analisis),
                analisis.get("postura_dominante"),
                analisis.get("interaccion_social"),
                json.dumps(analisis.get("objetos_detectados", [])),
                analisis.get("resumen_semantico"),
                analisis.get("presencia_humana", False),
                analisis.get("conteo_personas", 0),
                analisis.get("nivel_riesgo_salud", "bajo"),
                pm10, temp, hum, calidad,
                id_central,
                smoking_source,
                yolo_conf,
            )

            await conn.execute("""
                UPDATE staging.tabla_central
                SET confianza_fumador = $1,
                    fumador_valido    = $2
                WHERE id_central = $3
            """, yolo_conf, bool(analisis.get("esta_fumando", False)), id_central)

    except Exception as e:
        # FK violation: el registro fue borrado de staging (irrecuperable eliminado)
        log.warning("[%d/%d] id=%d omitido — registro ya no existe en staging: %s",
                    idx, total, id_central, type(e).__name__)
        return False

    log.info(
        "[%d/%d] id=%d | %s | fumado=%s | riesgo=%s | alertas=%s",
        idx, total, id_central,
        analisis.get("actividad", "?")[:20],
        analisis.get("esta_fumando"),
        analisis.get("nivel_riesgo_salud", "?"),
        alertas_str or "ok",
    )
    return True


async def main():
    log.info("Conectando a PostgreSQL...")
    pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=3)
    log.info("Conectado.")

    # Recuperar todos los registros completados en orden cronológico
    async with pool.acquire() as conn:
        registros = await conn.fetch("""
            SELECT id_central, estampa_tiempo, vector_bruto
            FROM staging.tabla_central
            WHERE estado_envio = 'completado'
            ORDER BY estampa_tiempo ASC
        """)

    total = len(registros)
    log.info("Registros a reprocesar: %d", total)

    ok = 0
    err = 0
    t0 = time.time()

    async with httpx.AsyncClient() as client:
        # Verificar que Qwen está disponible
        for intento in range(10):
            try:
                r = await client.get(f"{OLLAMA_URL}/api/tags", timeout=5)
                modelos = [m["name"] for m in r.json().get("models", [])]
                if any(QWEN_MODEL in m for m in modelos):
                    log.info("Modelo %s disponible.", QWEN_MODEL)
                    break
                log.warning("Modelo no disponible aún (%d/10)", intento + 1)
            except Exception as e:
                log.warning("Esperando Ollama (%d/10): %s", intento + 1, e)
            await asyncio.sleep(5)
        else:
            log.error("Ollama no disponible tras 10 intentos. Abortando.")
            sys.exit(1)

        for idx, reg in enumerate(registros, start=1):
            id_central   = reg["id_central"]
            ts           = reg["estampa_tiempo"]
            vector_bruto = reg["vector_bruto"]

            if isinstance(vector_bruto, str):
                try:
                    vector_bruto = json.loads(vector_bruto)
                except Exception:
                    vector_bruto = {}

            async with pool.acquire() as conn:
                exito = await reprocesar_registro(
                    conn, client, id_central, ts, vector_bruto, idx, total
                )

            if exito:
                ok += 1
            else:
                err += 1

            # Progreso + ETA cada 50 registros
            if idx % 50 == 0 or idx == total:
                elapsed  = time.time() - t0
                rate     = idx / elapsed if elapsed > 0 else 0
                restantes = total - idx
                eta_s    = int(restantes / rate) if rate > 0 else 0
                eta_h    = eta_s // 3600
                eta_m    = (eta_s % 3600) // 60
                log.info(
                    "PROGRESO %d/%d (%.1f%%) | ok=%d err=%d | %.2f reg/s | ETA %dh%02dm",
                    idx, total, 100 * idx / total, ok, err, rate, eta_h, eta_m,
                )

    elapsed_total = time.time() - t0
    log.info(
        "FINALIZADO en %.1f min | ok=%d | err=%d | total=%d",
        elapsed_total / 60, ok, err, total,
    )
    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
