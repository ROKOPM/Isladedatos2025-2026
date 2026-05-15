"""
rellamar_llava.py — Re-analiza con LLaVA las 4,561 capturas cuyo análisis visual falló,
luego las pasa por el Qwen enriquecido y actualiza warehouse manteniendo timestamps originales.

Ejecutar DESPUÉS de que reprocesar.py termine:
    docker exec isla_qwen python rellamar_llava.py

Flujo por registro:
  1. Leer imagen base64 desde datalake.capturas_crudas
  2. Enviar a LLaVA → obtener JSON visual real
  3. Actualizar vector_bruto->vision_llava en staging.tabla_central
  4. Llamar Qwen con el nuevo prompt enriquecido (con ts original)
  5. DELETE hecho antiguo (basado en visión vacía) + INSERT hecho nuevo
"""

import asyncio
import json
import logging
import os
import re
import sys
import time

import asyncpg
import httpx

from qwen_worker import (
    CAMARA, CAMPUS, CONFIANZA_FUMADO_UMBRAL, DB_DSN, OLLAMA_URL,
    QWEN_MODEL, ZONA,
    construir_prompt_qwen,
    detectar_baja_calidad_llava,
    llamar_qwen,
    normalizar_actividad,
    validar_coherencia,
    validar_fumado_cruzado,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [LLAVA-REPRO] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("rellamar_llava")

LLAVA_MODEL = os.getenv("LLM_MODEL", "llava:13b")

LLAVA_PROMPT = """Eres un sensor visual en campus universitario (ESCOM IPN). Analiza SOLO lo que ves en la imagen. Responde ÚNICAMENTE con JSON válido, sin markdown, sin texto extra.

ESQUEMA EXACTO:
{"conteo_personas":0,"postura_dominante":"sentado|parado|caminando|otro","interaccion_social":"solo|en_pareja|grupo_pequeno|grupo_grande|sin_personas","actividad":"verbo_contexto","fumando":false,"confianza_fumando":0.0,"objetos_detectados":["mochila","celular"],"zona":"exterior_jardin|exterior_acceso|corredor_cubierto|interior_aula|cafeteria|otro","nivel_actividad":"estatico|bajo|moderado|alto","resumen_semantico":"2 oraciones describiendo quien hace que y patron de comportamiento."}

FUMADO — busca evidencia visual en este orden:
true/0.95 = humo visible saliendo de boca/nariz, O cigarro encendido en mano o boca
true/0.80 = objeto cilíndrico delgado (cigarro/vaper) entre dedos o en labios
true/0.65 = gesto repetido de llevar objeto delgado a la boca
false/0.30 = postura ambigua, objeto no identificable
false/0.00 = ningún indicio de cigarro, humo o gesto de fumado
IMPORTANTE: Si ves un cigarro o vaper en la mano de alguien, fumando=true y ponlo en objetos_detectados.

Sin personas: {"conteo_personas":0,"postura_dominante":"N/A","interaccion_social":"sin_personas","actividad":"escena_vacia","fumando":false,"confianza_fumando":0.0,"objetos_detectados":[],"zona":"exterior_acceso","nivel_actividad":"estatico","resumen_semantico":"Sin presencia humana visible."}"""


def limpiar_json(texto: str) -> dict:
    limpio = re.sub(r"```(?:json)?\s*", "", texto, flags=re.IGNORECASE)
    limpio = limpio.replace("```", "").strip()
    try:
        return json.loads(limpio)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', limpio, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise


async def llamar_llava(client: httpx.AsyncClient, imagen_b64: str, max_intentos: int = 3) -> dict:
    for intento in range(max_intentos):
        payload = {
            "model":   LLAVA_MODEL,
            "prompt":  LLAVA_PROMPT,
            "images":  [imagen_b64],
            "stream":  False,
            "options": {"temperature": max(0.05, 0.1 - intento * 0.03)},
        }
        resp = await client.post(
            f"{OLLAMA_URL}/api/generate", json=payload, timeout=120
        )
        resp.raise_for_status()
        texto = resp.json().get("response", "")
        try:
            return limpiar_json(texto)
        except (json.JSONDecodeError, ValueError) as e:
            log.warning("LLaVA JSON inválido (intento %d/%d): %s", intento + 1, max_intentos, e)
            if intento < max_intentos - 1:
                await asyncio.sleep(2)
    raise ValueError("LLaVA no devolvió JSON válido tras 3 intentos")


def _calidad_aire(pm10):
    if pm10 is None:    return "sin_dato"
    elif pm10 < 54:     return "buena"
    elif pm10 < 154:    return "moderada"
    elif pm10 < 254:    return "insalubre_sensibles"
    else:               return "insalubre"


async def procesar_registro(
    conn: asyncpg.Connection,
    client: httpx.AsyncClient,
    id_central: int,
    id_captura: int,
    ts,
    vector_bruto: dict,
    idx: int,
    total: int,
) -> bool:
    # 1. Leer imagen desde datalake
    imagen_b64 = await conn.fetchval(
        "SELECT imagen_serial FROM datalake.capturas_crudas WHERE id_captura = $1",
        id_captura,
    )
    if not imagen_b64:
        log.warning("[%d/%d] id=%d sin imagen en datalake, omitiendo", idx, total, id_central)
        return False

    # 2. Llamar LLaVA con la imagen real
    try:
        vision_nueva = await llamar_llava(client, imagen_b64)
    except Exception as e:
        log.error("[%d/%d] id=%d LLaVA falló: %s", idx, total, id_central, e)
        return False

    log.info(
        "[%d/%d] id=%d LLaVA → actividad=%s fumando=%s personas=%d",
        idx, total, id_central,
        vision_nueva.get("actividad", "?"),
        vision_nueva.get("fumando"),
        vision_nueva.get("conteo_personas", 0),
    )

    # 3. Actualizar vector_bruto con la visión real en staging
    vector_actualizado = dict(vector_bruto)
    vector_actualizado["vision_llava"] = vision_nueva
    await conn.execute(
        "UPDATE staging.tabla_central SET vector_bruto = $1 WHERE id_central = $2",
        json.dumps(vector_actualizado),
        id_central,
    )

    # 4. Llamar Qwen con prompt enriquecido usando vector actualizado
    try:
        analisis = await llamar_qwen(client, construir_prompt_qwen(vector_actualizado, ts))
    except Exception as e:
        log.error("[%d/%d] id=%d Qwen falló: %s", idx, total, id_central, e)
        return False

    # 5. Validación y cross-val
    clima           = vector_bruto.get("clima_davis") or {}
    smoking_det     = vector_bruto.get("smoking_detection")
    baja_qwen, alertas_str = validar_coherencia(analisis, clima, id_central)
    smoking_source, yolo_conf = validar_fumado_cruzado(analisis, smoking_det)

    pm10 = clima.get("pm10") if clima else None
    temp = clima.get("temp") if clima else None
    hum  = clima.get("hum")  if clima else None
    calidad = _calidad_aire(pm10)

    # 6. Recuperar ids de dimensión (dim_tiempo ya existe con el ts original)
    id_tiempo = await conn.fetchval("""
        SELECT id_tiempo FROM warehouse.dim_tiempo
        WHERE fecha_completa = $1 AND hora = $2 AND minuto = $3
        LIMIT 1
    """, ts.date(), ts.hour, ts.minute)

    if not id_tiempo:
        id_tiempo = await conn.fetchval("""
            INSERT INTO warehouse.dim_tiempo
                (estampa_tiempo, fecha_completa, anio, mes, dia, dia_semana, hora, minuto, id_calendario)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                (SELECT id_calendario FROM warehouse.subcat_calendario
                 WHERE fecha_oficial = $2 LIMIT 1))
            ON CONFLICT (fecha_completa, hora, minuto) DO UPDATE
                SET anio = EXCLUDED.anio
            RETURNING id_tiempo
        """, ts, ts.date(), ts.year, ts.month, ts.day,
            ts.strftime("%A"), ts.hour, ts.minute)

    id_geo = await conn.fetchval(
        "SELECT id_geoespacial FROM warehouse.dim_geoespacial WHERE camara = $1 LIMIT 1",
        CAMARA,
    )
    if not id_geo:
        id_geo = await conn.fetchval(
            "INSERT INTO warehouse.dim_geoespacial (campus, zona, camara) VALUES ($1,$2,$3) RETURNING id_geoespacial",
            CAMPUS, ZONA, CAMARA,
        )

    # 7. Transacción: borrar hecho antiguo (visión vacía) + insertar hecho nuevo (visión real)
    async with conn.transaction():
        await conn.execute(
            "DELETE FROM warehouse.hechos_actividades_escenaurbana WHERE id_central_origen = $1",
            id_central,
        )
        await conn.fetchval("""
            INSERT INTO warehouse.hechos_actividades_escenaurbana
                (id_tiempo, id_geoespacial,
                 esta_fumando, actividad, postura_dominante, interaccion_social,
                 objetos_detectados, resumen_semantico,
                 presencia_humana, conteo_personas, nivel_riesgo_salud,
                 nivel_pm10, temperatura, humedad, calidad_aire_label,
                 id_central_origen, smoking_source, yolo_cigarette_conf)
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
            SET confianza_fumador = $1, fumador_valido = $2
            WHERE id_central = $3
        """, yolo_conf, bool(analisis.get("esta_fumando", False)), id_central)

    log.info(
        "[%d/%d] id=%d ✓ | actividad=%s | fumado=%s | riesgo=%s | alertas=%s",
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

    # Recuperar los registros con LLaVA fallido que tienen imagen en datalake
    async with pool.acquire() as conn:
        registros = await conn.fetch("""
            SELECT
                tc.id_central,
                tl.id_captura,
                tc.estampa_tiempo,
                tc.vector_bruto
            FROM staging.tabla_central tc
            JOIN staging.tabla_llava tl ON tl.id_llava = tc.id_llava
            WHERE tc.estado_envio = 'completado'
              AND COALESCE(TRIM(tc.vector_bruto -> 'vision_llava' ->> 'resumen_semantico'), '') = ''
            ORDER BY tc.estampa_tiempo ASC
        """)

    total = len(registros)
    log.info("Registros a re-analizar con LLaVA: %d", total)

    if total == 0:
        log.info("No hay registros pendientes. Nada que hacer.")
        await pool.close()
        return

    async with httpx.AsyncClient() as client:
        # Verificar LLaVA disponible
        for intento in range(10):
            try:
                r = await client.get(f"{OLLAMA_URL}/api/tags", timeout=5)
                modelos = [m["name"] for m in r.json().get("models", [])]
                if any(LLAVA_MODEL in m for m in modelos):
                    log.info("Modelo %s disponible.", LLAVA_MODEL)
                    break
                log.warning("Modelo LLaVA no disponible aún (%d/10)", intento + 1)
            except Exception as e:
                log.warning("Esperando Ollama (%d/10): %s", intento + 1, e)
            await asyncio.sleep(5)
        else:
            log.error("Ollama no disponible. Abortando.")
            sys.exit(1)

        ok = 0
        err = 0
        t0 = time.time()

        for idx, reg in enumerate(registros, start=1):
            id_central   = reg["id_central"]
            id_captura   = reg["id_captura"]
            ts           = reg["estampa_tiempo"]
            vector_bruto = reg["vector_bruto"]

            if isinstance(vector_bruto, str):
                try:
                    vector_bruto = json.loads(vector_bruto)
                except Exception:
                    vector_bruto = {}

            async with pool.acquire() as conn:
                exito = await procesar_registro(
                    conn, client,
                    id_central, id_captura, ts, vector_bruto,
                    idx, total,
                )

            if exito:
                ok += 1
            else:
                err += 1

            if idx % 50 == 0 or idx == total:
                elapsed   = time.time() - t0
                rate      = idx / elapsed if elapsed > 0 else 0
                restantes = total - idx
                eta_s     = int(restantes / rate) if rate > 0 else 0
                log.info(
                    "PROGRESO %d/%d (%.1f%%) | ok=%d err=%d | %.2f reg/s | ETA %dh%02dm",
                    idx, total, 100 * idx / total, ok, err, rate,
                    eta_s // 3600, (eta_s % 3600) // 60,
                )

    elapsed_total = time.time() - t0
    log.info(
        "FINALIZADO en %.1f min | ok=%d | err=%d | total=%d",
        elapsed_total / 60, ok, err, total,
    )
    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
