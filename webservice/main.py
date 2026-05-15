import os
import re
import json
import httpx
import asyncpg
import asyncio

from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="Isla de Datos Urbanos — WebService Bronze Layer", version="3.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Config ───────────────────────────────────────────────────
OLLAMA_URL   = os.environ.get("OLLAMA_URL",   "http://isla_ollama_llava:11434")
POSTGRES_DSN = os.environ.get("POSTGRES_DSN", "postgresql://postgres:postgres@isla_postgres:5432/postgres")
LLM_MODEL    = os.environ.get("LLM_MODEL",    "llava:13b")

db_pool: asyncpg.Pool          = None
# Semáforo: LLaVA en GPU es secuencial. Limitar a 1 inferencia simultánea
# evita que peticiones concurrentes de la isla saturen la VRAM de la 4070S.
_ollama_semaphore: asyncio.Semaphore = None

def utcnow() -> datetime:
    """Timestamp UTC homologado con davis_poller y server.py"""
    return datetime.now(timezone.utc).replace(tzinfo=None)

def limpiar_respuesta_llava(texto: str) -> str:
    """
    Normaliza la respuesta cruda de LLaVA a JSON puro.

    LLaVA 13b produce tres tipos de respuesta problemática:
      A) JSON envuelto en markdown (```json ... ```)
      B) JSON válido seguido del texto del prompt (overflow de contexto):
           {"actividad_principal": "...", ... "niv. Personas detectadas: 0. Eres un sensor..."
      C) Texto libre (rechazo explícito o respuesta conversacional)

    Estrategia:
      1. Quitar markdown
      2. Parseo directo
      3. Truncar en el primer marcador de prompt conocido y reintentar
      4. Extraer el primer bloque {...} completo con regex
      5. Fallback: envolver como {"descripcion": "..."}
    """
    # 1. Quitar bloques markdown
    limpio = re.sub(r"```(?:json)?\s*", "", texto).replace("```", "").strip()

    # 2. Parseo directo
    try:
        return json.dumps(json.loads(limpio), ensure_ascii=False)
    except json.JSONDecodeError:
        pass

    # 3. LLaVA repite el prompt cuando el contexto se satura (overflow).
    #    Detectar el punto donde empieza el texto del prompt y truncar ahi.
    _MARKERS = [
        "Personas detectadas:", "Eres un sensor", "Eres un observador",
        "Analiza SOLO", "ESQUEMA EXACTO", "ESQUEMA (respeta", "REGLAS CRITICAS",
        "DETECCION DE FUMADO", "REGLAS DE FUMADO",
    ]
    for marker in _MARKERS:
        idx = limpio.find(marker)
        if idx > 10:  # asegurar que hay JSON antes del marcador
            limpio = limpio[:idx].strip().rstrip(",")
            break

    try:
        return json.dumps(json.loads(limpio), ensure_ascii=False)
    except json.JSONDecodeError:
        pass

    # 4. Extraer primer bloque JSON con regex (maneja JSON anidado un nivel)
    match = re.search(r'\{(?:[^{}]|\{[^{}]*\})*\}', limpio, re.DOTALL)
    if match:
        try:
            return json.dumps(json.loads(match.group()), ensure_ascii=False)
        except json.JSONDecodeError:
            pass

    # 5. Último recurso
    print(f"⚠️  LLaVA no devolvió JSON válido tras limpieza, envolviendo texto libre")
    return json.dumps({"descripcion": limpio[:400]}, ensure_ascii=False)

@app.on_event("startup")
async def startup():
    global db_pool, _ollama_semaphore
    _ollama_semaphore = asyncio.Semaphore(1)
    for retries in range(10):
        try:
            db_pool = await asyncpg.create_pool(POSTGRES_DSN, min_size=2, max_size=10)
            print("✅ Conexión a PostgreSQL establecida.")
            return
        except Exception as e:
            print(f"⏳ Esperando PostgreSQL... intento {retries+1}/10 ({e})")
            await asyncio.sleep(3)
    raise RuntimeError("❌ No se pudo conectar a PostgreSQL después de 10 intentos.")

@app.on_event("shutdown")
async def shutdown():
    if db_pool:
        await db_pool.close()

# ─── Modelos Pydantic ─────────────────────────────────────────

class LlavaRequest(BaseModel):
    file:               str
    model:              Optional[str]  = None
    prompt:             str
    images:             list[str]
    person_count:       Optional[int]   = 0
    nv_confz_global:    Optional[float] = 0.0
    location_data:      Optional[dict]  = {}
    context_data:       Optional[dict]  = {}
    # Datos de deteccion de fumadores desde la isla:
    #   yolo_available          — si el modelo YOLO smoking estaba activo
    #   yolo_cigarette_detected — YOLO detecto cigarro/humo en el frame
    #   yolo_cigarette_conf     — confianza maxima de la deteccion YOLO
    #   yolo_cigarette_boxes    — bounding boxes de los cigarros detectados
    #   thermal_available       — si la camara termica estaba activa
    #   thermal_hotspot         — detecto zona de alta temperatura (cigarro encendido)
    # El qwen_worker cruzara estos datos con la respuesta de LLaVA para
    # descartar alucinaciones y confirmar fumadores.
    smoking_detection:  Optional[dict]  = None

class LlavaResponse(BaseModel):
    response:    str
    model:       str
    record_id:   Optional[int] = None
    duration_ms: Optional[int] = None

# ─── Health ───────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}

# ─── Métricas del pipeline ────────────────────────────────────

@app.get("/metrics")
async def metrics():
    """
    Estado en tiempo real del pipeline (últimas 24h).
    Útil para detectar acumulación de errores o cuellos de botella
    sin entrar a la base de datos manualmente.
    """
    async with db_pool.acquire() as conn:
        caps = await conn.fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE estado_llava = 'pendiente')  AS pendientes,
                COUNT(*) FILTER (WHERE estado_llava = 'completado') AS completados,
                COUNT(*) FILTER (WHERE estado_llava = 'procesando') AS bloqueados
            FROM datalake.capturas_crudas
            WHERE estampa_tiempo >= NOW() - INTERVAL '24 hours'
        """)
        pipe = await conn.fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE estado_envio = 'pendiente')        AS pendientes,
                COUNT(*) FILTER (WHERE estado_envio = 'completado')       AS completados,
                COUNT(*) FILTER (WHERE estado_envio = 'procesando')       AS bloqueados,
                COUNT(*) FILTER (WHERE estado_envio LIKE 'error%')        AS errores
            FROM staging.tabla_central
            WHERE estampa_tiempo >= NOW() - INTERVAL '24 hours'
        """)
        hechos = await conn.fetchval("""
            SELECT COUNT(*)
            FROM warehouse.hechos_actividades_escenaurbana h
            JOIN warehouse.dim_tiempo t ON t.id_tiempo = h.id_tiempo
            WHERE t.estampa_tiempo >= NOW() - INTERVAL '24 hours'
        """)

    return {
        "capturas_24h":  dict(caps),
        "pipeline_24h":  dict(pipe),
        "warehouse_24h": {"hechos": hechos},
        "ollama":        {"inferencia_activa": _ollama_semaphore.locked()}
    }

# ─── Endpoint principal ───────────────────────────────────────

@app.post("/llava/", response_model=LlavaResponse)
async def analyze_image(req: LlavaRequest):
    model_to_use = req.model or LLM_MODEL
    t_start      = utcnow()
    image_base64 = req.images[0] if req.images else ""

    # ── 1. Datalake: guardar imagen cruda ─────────────────────
    # Estado inicial 'pendiente': si Ollama falla, el registro queda
    # recuperable (no bloqueado en 'procesando' indefinidamente).
    id_captura = None
    _confianza_yolo = None
    if req.smoking_detection:
        _conf = req.smoking_detection.get("yolo_cigarette_conf")
        if _conf is not None:
            _confianza_yolo = round(float(_conf), 3)
    try:
        async with db_pool.acquire() as conn:
            id_captura = await conn.fetchval("""
                INSERT INTO datalake.capturas_crudas
                    (imagen_serial, estampa_tiempo, estado_llava, confianza_yolo)
                VALUES ($1, $2, 'pendiente', $3)
                RETURNING id_captura
            """, image_base64, t_start, _confianza_yolo)
    except Exception as e:
        print(f"⚠️  Error guardando en datalake.capturas_crudas: {e}")

    # ── 2. Ollama: inferencia LLaVA ───────────────────────────
    # Semáforo(1): garantiza una sola inferencia activa a la vez en la GPU.
    # Las peticiones adicionales de la isla esperan en cola en lugar de
    # saturar la VRAM de la 4070S con peticiones concurrentes.
    ollama_payload = {
        "model":  model_to_use,
        "prompt": req.prompt,
        "images": req.images,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 800}
    }

    try:
        async with _ollama_semaphore:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(f"{OLLAMA_URL}/api/generate", json=ollama_payload)
                resp.raise_for_status()
                llava_raw = resp.json().get("response", "Sin respuesta")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Ollama timeout")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Ollama: {e}")

    duration_ms = int((utcnow() - t_start).total_seconds() * 1000)

    # ── Limpiar respuesta: quitar markdown, garantizar JSON válido ─
    llava_json = limpiar_respuesta_llava(llava_raw)

    # ── 3. Staging: guardar respuesta LLaVA (ATOMICO) ───────────
    # Transaccion unica: INSERT en tabla_llava dispara el trigger
    # fn_auto_llenado_central que construye vector_bruto en tabla_central.
    try:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("""
                    INSERT INTO staging.tabla_llava
                        (id_captura, metadatos_json, estampa_tiempo)
                    VALUES ($1, $2, $3)
                """, id_captura, llava_json, t_start)

                if id_captura:
                    await conn.execute("""
                        UPDATE datalake.capturas_crudas
                        SET estado_llava = 'completado'
                        WHERE id_captura = $1
                    """, id_captura)
    except Exception as e:
        print(f"⚠️  Error guardando en staging.tabla_llava: {e}")

    print(f"✅ LLaVA respondió en {duration_ms}ms | id_captura={id_captura}")

    return LlavaResponse(
        response    = llava_raw,   # devuelve texto original al edge
        model       = model_to_use,
        record_id   = id_captura,
        duration_ms = duration_ms
    )
