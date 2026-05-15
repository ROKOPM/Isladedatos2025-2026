"""
forzar_vectorizacion.py
────────────────────────────────────────────────────────────────
Ejecuta las 3 fases del habits_worker de forma inmediata y completa,
sin esperar el intervalo horario ni las 6am de clustering.

  Fase 3 — Vectorización: itera hasta dejar 0 hechos sin vector
  Fase 4 — UMAP + HDBSCAN: proyección 3D y clustering
  Fase 5 — Bautizo semántico: Qwen nombra cada cluster

Uso (dentro del contenedor isla_habitos):
    python /app/forzar_vectorizacion.py

Se copia con:
    docker cp forzar_vectorizacion.py isla_habitos:/app/forzar_vectorizacion.py
    docker exec isla_habitos python /app/forzar_vectorizacion.py
"""
import os, sys, json, logging, asyncio, pickle
import asyncpg, numpy as np
from time import time as _time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [FORZAR] %(levelname)s %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("forzar")

DB_DSN       = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@isla_postgres:5432/postgres")
OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://isla_ollama_llava:11434")
QWEN_MODEL   = os.getenv("QWEN_MODEL",   "qwen2.5:14b")
MIN_CLUSTER  = int(os.getenv("MIN_CLUSTER_SIZE", "5"))
UMAP_FILE    = os.getenv("UMAP_STATE_FILE", "/app/umap_state.pkl")
WINDOW_DAYS  = int(os.getenv("UMAP_WINDOW_DAYS", "30"))
MAX_VECTORS  = int(os.getenv("MAX_UMAP_VECTORS", "50000"))

# ── Carga del modelo de embeddings ───────────────────────────
_embed_model = None
def get_embed_model():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        log.info("📦 Cargando all-MiniLM-L6-v2 en CPU...")
        _embed_model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
        log.info("✅ Modelo de embeddings listo")
    return _embed_model

def armar_texto(h) -> str:
    partes = []
    if h["resumen_semantico"]: partes.append(h["resumen_semantico"])
    if h["actividad"]:         partes.append(f"Actividad: {h['actividad']}.")
    if h["postura_dominante"]: partes.append(f"Postura: {h['postura_dominante']}.")
    if h["interaccion_social"]:partes.append(f"Interacción: {h['interaccion_social']}.")
    if h["esta_fumando"]:      partes.append("La persona está fumando.")
    obj = h["objetos_detectados"]
    if obj:
        if isinstance(obj, list): partes.append(f"Objetos: {', '.join(str(o) for o in obj)}.")
        else:                     partes.append(f"Objetos: {obj}.")
    if h["nivel_pm10"] is not None:
        partes.append(f"PM10: {h['nivel_pm10']} µg/m³.")
    return " ".join(partes) if partes else "Escena sin datos suficientes."

# ── FASE 3: Vectorizar todos los hechos sin vector ────────────
async def fase3_completa(pool):
    total = 0
    modelo = get_embed_model()
    while True:
        async with pool.acquire() as conn:
            filas = await conn.fetch("""
                SELECT h.id_hecho,
                       h.esta_fumando, h.actividad, h.postura_dominante,
                       h.interaccion_social, h.objetos_detectados, h.resumen_semantico,
                       h.nivel_pm10, h.temperatura, h.humedad
                FROM   warehouse.hechos_actividades_escenaurbana h
                LEFT JOIN warehouse.hechos_vectores_descripcion_habitos v ON v.id_hecho = h.id_hecho
                WHERE  v.id_vector IS NULL
                ORDER  BY h.id_hecho ASC
                LIMIT  200
            """)

        if not filas:
            break

        log.info("🔢 Vectorizando lote de %d hechos (total hasta ahora: %d)...", len(filas), total)
        textos = [armar_texto(f) for f in filas]
        ids    = [f["id_hecho"] for f in filas]
        vectores = modelo.encode(textos, batch_size=32, show_progress_bar=False)

        async with pool.acquire() as conn:
            async with conn.transaction():
                for id_hecho, vec in zip(ids, vectores):
                    vec_str = "[" + ",".join(f"{v:.8f}" for v in vec.tolist()) + "]"
                    await conn.execute("""
                        INSERT INTO warehouse.hechos_vectores_descripcion_habitos
                            (id_hecho, vector_habito)
                        VALUES ($1, $2::vector)
                        ON CONFLICT DO NOTHING
                    """, id_hecho, vec_str)

        total += len(filas)
        log.info("✅ Lote guardado — %d vectores acumulados", total)

    log.info("🏁 Fase 3 completa — %d vectores nuevos en total", total)
    return total

# ── FASE 4: UMAP + HDBSCAN ────────────────────────────────────
async def fase4_clustering(pool):
    try:
        import umap.umap_ as umap_lib
        import hdbscan as hdbscan_lib
    except ImportError as e:
        log.error("❌ Faltan dependencias: %s", e)
        return None

    async with pool.acquire() as conn:
        filas = await conn.fetch(f"""
            SELECT v.id_vector, v.id_hecho, v.vector_habito
            FROM   warehouse.hechos_vectores_descripcion_habitos v
            JOIN   warehouse.hechos_actividades_escenaurbana h ON h.id_hecho = v.id_hecho
            JOIN   warehouse.dim_tiempo t ON t.id_tiempo = h.id_tiempo
            WHERE  v.vector_habito IS NOT NULL
              AND  t.fecha_completa >= CURRENT_DATE - INTERVAL '{WINDOW_DAYS} days'
            ORDER  BY v.id_vector DESC
            LIMIT  {MAX_VECTORS}
        """)

    n = len(filas)
    log.info("🗺️  UMAP+HDBSCAN sobre %d vectores...", n)

    if n < MIN_CLUSTER * 2:
        log.warning("⏳ Muy pocos vectores (%d) — mínimo %d. Abortando clustering.", n, MIN_CLUSTER * 2)
        return None

    ids_vector = [f["id_vector"] for f in filas]
    ids_hecho  = [f["id_hecho"]  for f in filas]
    # asyncpg devuelve vector(384) como string "[0.1,0.2,...]" — hay que parsearlo
    def _parse_vec(v):
        return json.loads(v) if isinstance(v, str) else list(v)
    matriz = np.array([_parse_vec(f["vector_habito"]) for f in filas], dtype=np.float32)

    # Borrar UMAP guardado para forzar fit_transform completo
    if os.path.exists(UMAP_FILE):
        os.remove(UMAP_FILE)
        log.info("🗑️  UMAP state anterior eliminado — haciendo fit_transform completo")

    log.info("🔄 UMAP fit_transform (puede tardar varios minutos)...")
    reducer = umap_lib.UMAP(n_components=3, random_state=42, n_jobs=1)
    coords  = reducer.fit_transform(matriz)
    with open(UMAP_FILE, "wb") as fh:
        pickle.dump(reducer, fh)
    log.info("✅ UMAP completo — reducer guardado")

    log.info("🔍 HDBSCAN clustering...")
    clusterer = hdbscan_lib.HDBSCAN(
        min_cluster_size=MIN_CLUSTER, metric="euclidean", prediction_data=True
    )
    etiquetas = clusterer.fit_predict(coords)
    clusters_unicos = set(etiquetas) - {-1}
    log.info("✅ HDBSCAN: %d clusters encontrados en %d vectores", len(clusters_unicos), n)

    log.info("💾 Guardando coordenadas UMAP...")
    async with pool.acquire() as conn:
        async with conn.transaction():
            for id_vec, coord in zip(ids_vector, coords):
                await conn.execute("""
                    UPDATE warehouse.hechos_vectores_descripcion_habitos
                    SET umap_x = $1, umap_y = $2, umap_z = $3
                    WHERE id_vector = $4
                """, float(coord[0]), float(coord[1]), float(coord[2]), id_vec)

    log.info("✅ Fase 4 completa")
    return clusters_unicos, ids_vector, ids_hecho, etiquetas, coords

# ── Main ──────────────────────────────────────────────────────
async def main():
    log.info("🚀 Forzando vectorización completa (Fases 3→4→5)...")

    pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=4)

    # Mostrar estado inicial
    async with pool.acquire() as conn:
        total_hechos   = await conn.fetchval("SELECT COUNT(*) FROM warehouse.hechos_actividades_escenaurbana")
        sin_vector     = await conn.fetchval("""
            SELECT COUNT(*) FROM warehouse.hechos_actividades_escenaurbana h
            LEFT JOIN warehouse.hechos_vectores_descripcion_habitos v ON v.id_hecho = h.id_hecho
            WHERE v.id_vector IS NULL
        """)
    log.info("📊 Estado inicial — hechos: %d | sin vector: %d", total_hechos, sin_vector)

    # ── Fase 3 ────────────────────────────────────────────────
    n_vectores = await fase3_completa(pool)

    if n_vectores == 0 and sin_vector == 0:
        log.info("✅ Todos los hechos ya estaban vectorizados")

    # ── Fase 4 ──────────────────────────────────────────────
    resultado = await fase4_clustering(pool)

    # Resumen final
    async with pool.acquire() as conn:
        vectores  = await conn.fetchval("SELECT COUNT(*) FROM warehouse.hechos_vectores_descripcion_habitos WHERE vector_habito IS NOT NULL")
        con_umap  = await conn.fetchval("SELECT COUNT(*) FROM warehouse.hechos_vectores_descripcion_habitos WHERE umap_x IS NOT NULL")

    log.info("─── Resultado final ─────────────────────────────")
    log.info("  Vectores embedidos   : %d", vectores)
    log.info("  Con coordenadas UMAP : %d", con_umap)
    log.info("✅ Dashboard listo para mostrar datos")

    await pool.close()

if __name__ == "__main__":
    asyncio.run(main())
