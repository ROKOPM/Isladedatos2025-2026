"""
reprocesar_timeouts.py
─────────────────────
Lee los registros con estado_llava = 'timeout' de datalake.capturas_crudas
y los reenvía directamente a LLaVA (sin pasar por el endpoint HTTP),
actualizando staging.tabla_llava y estado en datalake.

Uso:
    pip install asyncpg httpx
    python reprocesar_timeouts.py

Variables de entorno opcionales:
    POSTGRES_DSN  (default: postgresql://postgres:postgres@localhost:5432/postgres)
    OLLAMA_URL    (default: http://localhost:11434)
    LLM_MODEL     (default: llava:13b)
    BATCH_SIZE    (default: 5  — cuántas imágenes procesar en paralelo)
    PROMPT        (default: el prompt estándar del sistema)
"""

import os
import re
import json
import httpx
import asyncpg
import asyncio
from datetime import datetime, timezone

# ─── Config ───────────────────────────────────────────────────────────────────
POSTGRES_DSN = os.environ.get(
    "POSTGRES_DSN",
    "postgresql://postgres:postgres@localhost:5432/postgres"
)
OLLAMA_URL  = os.environ.get("OLLAMA_URL",  "http://localhost:11434")
LLM_MODEL   = os.environ.get("LLM_MODEL",   "llava:13b")
BATCH_SIZE  = int(os.environ.get("BATCH_SIZE", "5"))
PROMPT      = os.environ.get(
    "PROMPT",
    "Describe en JSON lo que observas en la imagen urbana: personas, vehículos, condiciones."
)

# ─── Helpers ──────────────────────────────────────────────────────────────────
def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def limpiar_respuesta_llava(texto: str) -> str:
    limpio = re.sub(r"```(?:json)?\s*", "", texto).replace("```", "").strip()
    try:
        obj = json.loads(limpio)
        return json.dumps(obj, ensure_ascii=False)
    except json.JSONDecodeError:
        return json.dumps({"descripcion": limpio}, ensure_ascii=False)

# ─── Procesar un registro ─────────────────────────────────────────────────────
async def procesar(conn, client: httpx.AsyncClient, row: dict) -> None:
    id_captura   = row["id_captura"]
    imagen_b64   = row["imagen_serial"]
    t_start      = utcnow()

    print(f"  ▶ Procesando id_captura={id_captura} ...")

    # Marcar como procesando
    await conn.execute(
        "UPDATE datalake.capturas_crudas SET estado_llava='procesando' WHERE id_captura=$1",
        id_captura
    )

    # Llamar a Ollama
    payload = {
        "model":  LLM_MODEL,
        "prompt": PROMPT,
        "images": [imagen_b64],
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 512}
    }

    try:
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
        resp.raise_for_status()
        llava_raw = resp.json().get("response", "Sin respuesta")
    except Exception as e:
        print(f"  ✗ id_captura={id_captura} — Error Ollama: {e}")
        await conn.execute(
            "UPDATE datalake.capturas_crudas SET estado_llava='error' WHERE id_captura=$1",
            id_captura
        )
        return

    duration_ms = int((utcnow() - t_start).total_seconds() * 1000)
    llava_json  = limpiar_respuesta_llava(llava_raw)

    # Guardar en staging (solo si no existe ya)
    try:
        existing = await conn.fetchval(
            "SELECT id_llava FROM staging.tabla_llava WHERE id_captura=$1",
            id_captura
        )
        if existing is None:
            await conn.execute("""
                INSERT INTO staging.tabla_llava (id_captura, metadatos_json, estampa_tiempo)
                VALUES ($1, $2, $3)
            """, id_captura, llava_json, t_start)

        await conn.execute(
            "UPDATE datalake.capturas_crudas SET estado_llava='completado' WHERE id_captura=$1",
            id_captura
        )
        print(f"  ✅ id_captura={id_captura} — completado en {duration_ms}ms")

    except Exception as e:
        print(f"  ✗ id_captura={id_captura} — Error BD: {e}")
        await conn.execute(
            "UPDATE datalake.capturas_crudas SET estado_llava='error' WHERE id_captura=$1",
            id_captura
        )

# ─── Main ─────────────────────────────────────────────────────────────────────
async def main():
    print("🔌 Conectando a PostgreSQL...")
    pool = await asyncpg.create_pool(POSTGRES_DSN, min_size=1, max_size=BATCH_SIZE)

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            "SELECT COUNT(*) FROM datalake.capturas_crudas WHERE estado_llava='timeout'"
        )

    print(f"📦 Registros con estado 'timeout': {total}")
    if total == 0:
        print("✅ Nada que reprocesar.")
        await pool.close()
        return

    procesados = 0
    errores    = 0

    # Timeout generoso: LLaVA 13b tarda ~15-30s por imagen
    async with httpx.AsyncClient(timeout=180) as client:
        while True:
            async with pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT id_captura, imagen_serial
                    FROM datalake.capturas_crudas
                    WHERE estado_llava = 'timeout'
                    ORDER BY estampa_tiempo ASC
                    LIMIT $1
                """, BATCH_SIZE)

            if not rows:
                break

            print(f"\n🔄 Procesando lote de {len(rows)} imágenes...")

            # Procesar de una en una para no saturar la GPU
            for row in rows:
                async with pool.acquire() as conn:
                    await procesar(conn, client, row)
                    procesados += 1

            print(f"   Progreso: {procesados}/{total}")

    print(f"\n🏁 Reprocesamiento terminado.")
    print(f"   ✅ Completados : {procesados}")
    print(f"   ✗  Errores     : {errores}")
    await pool.close()

if __name__ == "__main__":
    asyncio.run(main())
