"""
Habits Worker — Fases 3, 4 y 5  (schema v3)
─────────────────────────────────────────────────────────────
Fase 3 (cada hora, CPU):
  Hechos sin entrada en vectores → INSERT fila (vector_habito = NULL)
  Sin modelo de embeddings — los features se calculan en Fase 4 desde campos estructurados.

Fase 4 (batch diario, CPU):
  Lee campos estructurados de warehouse → matriz de features 31-dim → PCA 31→2 → KMeans
  UPDATE umap_x, umap_y, umap_z en tabla vectores (columnas legacy: contienen PCA 2D).
  cluster_id y etiquetas NO se persisten — el dashboard los calcula dinamicamente.
"""
import os
import json
import logging
import asyncio
import asyncpg
import httpx
import numpy as np
import re
import tempfile
import uuid
from datetime import datetime, timezone, timedelta
from time import time as _time

from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

import semantic_utils

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [HABITOS] %(levelname)s %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("habits_worker")

# ── Config ────────────────────────────────────────────────────
DB_DSN         = os.getenv("DATABASE_URL",
    "postgresql://postgres:postgres@isla_postgres:5432/postgres")
OLLAMA_URL     = os.getenv("OLLAMA_URL",    "http://isla_ollama_qwen:11434")
QWEN_MODEL     = os.getenv("QWEN_MODEL",    "qwen2.5:14b")
VECTORIZE_INTERVAL = int(os.getenv("VECTORIZE_INTERVAL", "3600"))
CLUSTER_HOUR       = int(os.getenv("CLUSTER_HOUR",   "6"))
MIN_CLUSTER_SIZE   = int(os.getenv("MIN_CLUSTER_SIZE", "300"))

CLUSTER_LABELS_FILE  = os.getenv("CLUSTER_LABELS_FILE",  "/app/cluster_labels.json")
CLUSTER_STATUS_FILE  = os.getenv("CLUSTER_STATUS_FILE",  "/app/cluster_job_status.json")
CLUSTER_REQUESTS_FILE = os.getenv("CLUSTER_RECOMPUTE_REQUESTS_FILE", "/app/cluster_recompute_requests.jsonl")
CLUSTER_LOCK_FILE    = os.getenv("CLUSTER_LOCK_FILE", "/app/cluster_job.lock")
UMAP_WINDOW_DAYS     = int(os.getenv("UMAP_WINDOW_DAYS", "30"))
MAX_UMAP_VECTORS     = int(os.getenv("MAX_UMAP_VECTORS", "50000"))
DATALAKE_RETAIN_DAYS = int(os.getenv("DATALAKE_RETAIN_DAYS", "30"))

CLUSTER_FEATURE_MASK = {
    "actividad": True, "postura": True, "interaccion": True, "riesgo": True,
    "fumando": True, "ambiental": True, "turno": True,
}
CLUSTERING_CONFIG = {
    "vector_dim": 31,
    "projection": "PCA(2)",
    "clusterer": "KMeans(k=8)",
    "random_state": 42,
    "pca_components": 2,
}

def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso_utc() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _canonical_json(data) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _cluster_query_hash(filters: dict | None = None, feature_mask: dict | None = None, config: dict | None = None) -> str:
    payload = {
        "filters": filters or {"intervalo": f"{UMAP_WINDOW_DAYS} days"},
        "feature_mask": feature_mask or CLUSTER_FEATURE_MASK,
        "dataset_version": "warehouse.hechos_actividades_escenaurbana",
        "clustering_config": config or CLUSTERING_CONFIG,
    }
    import hashlib
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def _atomic_write_json(path: str, payload: dict) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=os.path.basename(path) + ".", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)
            fh.flush()
            os.fsync(fh.fileno())
        with open(tmp_path, encoding="utf-8") as fh:
            json.load(fh)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


class ClusterJob:
    def __init__(self, job_id: str, query_hash: str, filters: dict | None = None):
        self.job_id = job_id
        self.query_hash = query_hash
        self.filters = filters or {"intervalo": f"{UMAP_WINDOW_DAYS} days"}
        self.started = _time()
        self.started_at = iso_utc()
        self.records_total = 0
        self.records_processed = 0

    def update(self, stage: str, progress: int, message: str, **extra):
        elapsed = int(_time() - self.started)
        payload = {
            "job_id": self.job_id,
            "started_at": self.started_at,
            "updated_at": iso_utc(),
            "stage": stage,
            "progress": max(0, min(100, int(progress))),
            "estimated_seconds_remaining": None,
            "elapsed_seconds": elapsed,
            "records_total": int(extra.pop("records_total", self.records_total) or 0),
            "records_processed": int(extra.pop("records_processed", self.records_processed) or 0),
            "cache_status": extra.pop("cache_status", "miss"),
            "message": message,
            "query_hash": self.query_hash,
            "filters": self.filters,
            "feature_mask": CLUSTER_FEATURE_MASK,
            "clustering_config": CLUSTERING_CONFIG,
            **extra,
        }
        _atomic_write_json(CLUSTER_STATUS_FILE, payload)
        log.info("[cluster_job:%s] %s %d%% | %s", self.job_id, stage, progress, message)


def _safe_csv(values, numeric=False, max_val=9999) -> str:
    if isinstance(values, str):
        values = [v.strip() for v in values.split(",") if v.strip()]
    result = []
    for value in values or []:
        item = str(value).strip()
        if numeric:
            if item.isdigit() and 0 <= int(item) <= max_val:
                result.append(item)
        elif re.match(r"^[\w .:-]+$", item, re.UNICODE):
            result.append("'" + item.replace("'", "''") + "'")
    return ",".join(result)


def _cluster_where_from_filters(filters: dict | None) -> str:
    filters = filters or {}
    parts = [
        "h.actividad IS NOT NULL",
        "h.actividad != 'escena_vacia'",
        "LOWER(h.actividad) NOT LIKE 'ausencia%'",
    ]
    if filters.get("desde") or filters.get("hasta"):
        sql_date = "(make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date"
        if re.match(r"^\d{4}-\d{2}-\d{2}$", str(filters.get("desde", ""))):
            parts.append(f"{sql_date} >= '{filters['desde']}'")
        if re.match(r"^\d{4}-\d{2}-\d{2}$", str(filters.get("hasta", ""))):
            parts.append(f"{sql_date} <= '{filters['hasta']}'")
    else:
        interval = str(filters.get("intervalo") or f"{UMAP_WINDOW_DAYS} days")
        if not re.match(r"^\d+\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)$", interval):
            interval = f"{UMAP_WINDOW_DAYS} days"
        parts.append(f"t.fecha_completa >= CURRENT_DATE - INTERVAL '{interval}'")
    for key, column in (("campus", "g.campus"), ("zonas", "g.zona"), ("camaras", "g.camara")):
        csv = _safe_csv(filters.get(key))
        if csv:
            parts.append(f"{column} IN ({csv})")
    csv = _safe_csv(filters.get("dias_semana"), numeric=True, max_val=7)
    if csv:
        parts.append(f"EXTRACT(ISODOW FROM (make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')) IN ({csv})")
    csv = _safe_csv(filters.get("horas"), numeric=True, max_val=23)
    if csv:
        parts.append(f"EXTRACT(HOUR FROM (make_timestamp(t.anio,t.mes,t.dia,t.hora,t.minuto,0) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')) IN ({csv})")
    if filters.get("smoking_mode") == "true" or filters.get("fumando") == "true" or filters.get("smokingMode") is True:
        parts.append("h.esta_fumando = TRUE")
    return " AND ".join(parts)


class FileLock:
    def __init__(self, path: str):
        self.path = path
        self.fd = None

    def __enter__(self):
        try:
            self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(self.fd, str(os.getpid()).encode("utf-8"))
            return self
        except FileExistsError:
            return None

    def __exit__(self, exc_type, exc, tb):
        if self.fd is not None:
            os.close(self.fd)
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass

# ── Vocabularios para one-hot encoding ───────────────────────
_ACTIVIDADES = ['caminar','comer','descansar','escena_vacia','estudiar','otro','reunion','usar_celular']
_POSTURAS    = ['caminando','otro','parado','recostado','sentado']
_SOCIALES    = ['en_grupo_grande','en_grupo_pequeno','en_pareja','sin_personas','solo']
_RIESGOS     = ['alto','bajo','critico','moderado']

# Dimensionalidad resultante: 8+5+5+4+9 = 31 dims
FEATURE_DIM  = len(_ACTIVIDADES) + len(_POSTURAS) + len(_SOCIALES) + len(_RIESGOS) + 9


def _onehot(valor: str | None, cats: list[str]) -> np.ndarray:
    v = np.zeros(len(cats), dtype=np.float32)
    key = str(valor or "").strip().lower()
    if key in cats:
        v[cats.index(key)] = 1.0
    return v


def armar_vector(h: dict) -> np.ndarray:
    """Convierte un hecho estructurado en un vector de 31 dimensiones interpretables."""
    hora  = int(h.get("hora") or 12)
    pm10  = float(h.get("nivel_pm10")  or 0)
    temp  = (min(max(float(h.get("temperatura") or 20.0), -10.0), 50.0) + 10.0) / 60.0
    hum   = min(float(h.get("humedad")     or 50.0), 100.0) / 100.0
    conteo = min(float(h.get("conteo_personas") or 0), 10.0) / 10.0

    # Hora como turno discreto (reduce peso en distancia euclídea)
    turno_manana = 1.0 if 6 <= hora < 12 else 0.0
    turno_tarde  = 1.0 if 12 <= hora < 18 else 0.0
    turno_noche  = 1.0 if hora >= 18 or hora < 6 else 0.0
    # PM10 como binario (smog sí/no)
    smog_alto = 1.0 if pm10 > 50 else 0.0

    return np.concatenate([
        _onehot(h.get("actividad"),          _ACTIVIDADES),   # 8
        _onehot(h.get("postura_dominante"),  _POSTURAS),      # 5
        _onehot(h.get("interaccion_social"), _SOCIALES),      # 5
        _onehot(h.get("nivel_riesgo_salud"), _RIESGOS),       # 4
        [
            1.0 if h.get("esta_fumando")    else 0.0,         # 1
            1.0 if h.get("presencia_humana") else 0.0,        # 1
            conteo,                                            # 1
            smog_alto,                                         # 1
            temp,                                              # 1
            hum,                                               # 1
            turno_manana,                                      # 1
            turno_tarde,                                       # 1
            turno_noche,                                       # 1
        ],
    ], dtype=np.float32)  # total: 31 dims

# ── FASE 3: Registro horario (sin embeddings) ─────────────────
async def fase3_vectorizar(pool: asyncpg.Pool):
    """
    Registra hechos nuevos en la tabla de vectores con vector_habito=NULL.
    Los features reales se calculan en Fase 4 directamente desde los campos
    estructurados del warehouse — sin modelo de embeddings externo.
    """
    async with pool.acquire() as conn:
        filas = await conn.fetch("""
            SELECT h.id_hecho
            FROM   warehouse.hechos_actividades_escenaurbana h
            LEFT JOIN warehouse.hechos_vectores_descripcion_habitos v
                   ON v.id_hecho = h.id_hecho
            WHERE  v.id_vector IS NULL
            ORDER  BY h.id_hecho ASC
            LIMIT  200
        """)

    if not filas:
        log.info("Sin hechos pendientes de registrar")
        return 0

    log.info("Registrando %d hechos en tabla de vectores...", len(filas))
    async with pool.acquire() as conn:
        async with conn.transaction():
            for fila in filas:
                await conn.execute("""
                    INSERT INTO warehouse.hechos_vectores_descripcion_habitos
                        (id_hecho)
                    VALUES ($1)
                    ON CONFLICT DO NOTHING
                """, fila["id_hecho"])

    log.info("%d hechos registrados", len(filas))
    return len(filas)


# ── Bautizo semántico de clusters con Qwen (v2 - prompt mejorado + dedup) ─
async def bautizar_clusters(labels: np.ndarray, coords: np.ndarray,
                            ids_hecho: list, pool: asyncpg.Pool) -> tuple[dict, dict]:
    from collections import defaultdict

    cluster_indices: dict[int, list[int]] = defaultdict(list)
    for i, lbl in enumerate(labels):
        if lbl != -1:
            cluster_indices[int(lbl)].append(i)

    if not cluster_indices:
        return {}, {}

    bautizos: dict[int, str] = {}
    nombres_asignados: list[str] = []

    async with httpx.AsyncClient() as client:
        for cid, indices in sorted(cluster_indices.items()):
            cluster_coords = coords[indices]
            centroid       = cluster_coords.mean(axis=0)
            dists          = np.linalg.norm(cluster_coords - centroid, axis=1)

            nearest_idx  = np.argsort(dists)[:10]
            outer_thresh = np.percentile(dists, 75)
            outer_idx    = np.where(dists >= outer_thresh)[0]
            rng          = np.random.default_rng(seed=cid)
            periph_idx   = rng.choice(outer_idx, size=min(5, len(outer_idx)), replace=False)

            hecho_ids_near   = [ids_hecho[indices[j]] for j in nearest_idx]
            hecho_ids_periph = [ids_hecho[indices[j]] for j in periph_idx]
            hecho_ids_all    = [ids_hecho[i] for i in indices]

            async with pool.acquire() as conn:
                rows_near = await conn.fetch("""
                    SELECT h.resumen_semantico
                    FROM   warehouse.hechos_actividades_escenaurbana h
                    WHERE  h.id_hecho = ANY($1)
                      AND  h.resumen_semantico IS NOT NULL
                """, hecho_ids_near)

                rows_periph = await conn.fetch("""
                    SELECT h.resumen_semantico
                    FROM   warehouse.hechos_actividades_escenaurbana h
                    WHERE  h.id_hecho = ANY($1)
                      AND  h.resumen_semantico IS NOT NULL
                """, hecho_ids_periph)

                stats = await conn.fetchrow("""
                    SELECT
                        ROUND(AVG(t.hora - 6)::numeric, 0)                           AS hora_cdmx_prom,
                        MIN(t.hora - 6) || 'h-' || MAX(t.hora - 6) || 'h'           AS hora_rango,
                        ROUND(100.0 * SUM(CASE WHEN h.esta_fumando THEN 1 ELSE 0 END)
                              / COUNT(*)::numeric, 1)                                 AS pct_fumadores,
                        ROUND(AVG(h.conteo_personas)::numeric, 1)                    AS prom_personas,
                        ROUND(100.0 * SUM(CASE WHEN h.conteo_personas = 0 THEN 1 ELSE 0 END)
                              / COUNT(*)::numeric, 1)                                 AS pct_escena_vacia,
                        ROUND(AVG(h.nivel_pm10)::numeric, 1)                         AS prom_pm10,
                        SUM(CASE WHEN h.nivel_pm10 IS NULL THEN 1 ELSE 0 END)        AS sin_pm10,
                        MODE() WITHIN GROUP (ORDER BY h.actividad)                   AS actividad_top,
                        MODE() WITHIN GROUP (ORDER BY h.interaccion_social)          AS social_top,
                        MODE() WITHIN GROUP (ORDER BY t.dia_semana)                  AS dia_top,
                        COUNT(*)                                                      AS n
                    FROM   warehouse.hechos_actividades_escenaurbana h
                    JOIN   warehouse.dim_tiempo t ON t.id_tiempo = h.id_tiempo
                    WHERE  h.id_hecho = ANY($1)
                """, hecho_ids_all)

            # Atajo para clusters vacíos
            if float(stats["pct_escena_vacia"] or 0) > 60:
                dia_es = semantic_utils.DIAS_ES.get(
                    stats["dia_top"] or "", (stats["dia_top"] or "").lower())
                hora   = int(stats["hora_cdmx_prom"] or 0)
                turno  = "mañana" if hora < 12 else ("tarde" if hora < 18 else "noche")
                etiqueta = f"Campus vacío {dia_es} {turno}"
                bautizos[cid] = etiqueta
                nombres_asignados.append(etiqueta)
                log.info("  cluster_%d (%d obs) → '%s'  [atajo vacío]", cid, len(indices), etiqueta)
                continue

            if not rows_near:
                fb_payload = semantic_utils.fallback_nombre_semantico(stats, cid, len(indices))
                etiqueta = fb_payload["name"]
                bautizos[cid] = etiqueta
                nombres_asignados.append(etiqueta)
                log.info("  cluster_%d (%d obs) → '%s' [fallback sin resumen_semantico]", cid, len(indices), etiqueta)
                continue

            prompt = semantic_utils.prompt_bautizo_mejorado(
                stats=stats,
                rows_near=rows_near,
                rows_periph=rows_periph,
                n_obs=len(indices),
                nombres_existentes=nombres_asignados[-10:] if nombres_asignados else None,
            )
            try:
                resp = await client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={"model": QWEN_MODEL, "prompt": prompt, "stream": False,
                          "options": {"temperature": 0.3, "num_predict": 40}},
                    timeout=120
                )
                resp.raise_for_status()
                raw = resp.json().get("response", "").strip()
                etiqueta = semantic_utils.limpiar_respuesta_qwen(raw, cid)
                if semantic_utils.es_nombre_generico(etiqueta):
                    fb_payload = semantic_utils.fallback_nombre_semantico(stats, cid, len(indices))
                    etiqueta = fb_payload["name"]
                    log.info("  cluster_%d respuesta generica de Qwen; usando fallback '%s'", cid, etiqueta)
                bautizos[cid] = etiqueta
                nombres_asignados.append(etiqueta)
                log.info("  cluster_%d (%d obs) → '%s'", cid, len(indices), etiqueta)
            except Exception as e:
                log.warning("Bautizo cluster_%d fallo: %s", cid, e)
                fb = semantic_utils.fallback_nombre_semantico(stats, cid, len(indices))["name"]
                bautizos[cid] = fb
                nombres_asignados.append(fb)

    # Des-duplicación SEMÁNTICA (no exacta)
    bautizos, merge_map = await semantic_utils.dedup_semantico(
        bautizos, labels, ids_hecho, pool, OLLAMA_URL, QWEN_MODEL)
    return bautizos, merge_map


# ── FASE 4: Clustering PCA + KMeans ─────────────────────────
async def fase4_clustering(pool: asyncpg.Pool, filters: dict | None = None, job_id: str | None = None, query_hash: str | None = None):
    filters = filters or {"intervalo": f"{UMAP_WINDOW_DAYS} days"}
    query_hash = query_hash or _cluster_query_hash(filters)
    job = ClusterJob(job_id or str(uuid.uuid4()), query_hash, filters)
    stage_times = {}
    total_started = _time()

    with FileLock(CLUSTER_LOCK_FILE) as lock:
        if lock is None:
            job.update("queued", 0, "Ya existe un job de clusters activo; se omite recomputacion simultanea.")
            return

        job.update("loading_data", 5, "Leyendo registros del warehouse.")

        t0 = _time()
        where_sql = _cluster_where_from_filters(filters)
        async with pool.acquire() as conn:
            filas = await conn.fetch(f"""
                SELECT
                    v.id_vector, v.id_hecho,
                    h.actividad, h.postura_dominante, h.interaccion_social,
                    h.esta_fumando, h.presencia_humana, h.conteo_personas,
                    h.nivel_pm10, h.temperatura, h.humedad, h.nivel_riesgo_salud,
                    t.hora
                FROM   warehouse.hechos_vectores_descripcion_habitos v
                JOIN   warehouse.hechos_actividades_escenaurbana h ON h.id_hecho = v.id_hecho
                JOIN   warehouse.dim_tiempo t ON t.id_tiempo = h.id_tiempo
                JOIN   warehouse.dim_geoespacial g ON g.id_geoespacial = h.id_geoespacial
                WHERE  {where_sql}
                ORDER  BY v.id_vector DESC
                LIMIT  {MAX_UMAP_VECTORS}
            """)
        stage_times["sql_seconds"] = round(_time() - t0, 3)
        job.records_total = len(filas)
        job.records_processed = len(filas)
        job.update("vectorizing", 15, f"{len(filas)} registros leidos; armando matriz de features.", records_total=len(filas), records_processed=len(filas), timings=stage_times)

        if len(filas) < MIN_CLUSTER_SIZE * 2:
            msg = f"Datos insuficientes para clustering estable: {len(filas)} registros, minimo {MIN_CLUSTER_SIZE * 2}."
            log.info(msg)
            job.update("failed", 100, msg, records_total=len(filas), records_processed=len(filas), error="insufficient_data", timings=stage_times)
            return

        log.info("PCA + KMeans | %d registros | %d dims | hash=%s",
                 len(filas), FEATURE_DIM, query_hash[:12])

        ids_vector = [f["id_vector"] for f in filas]
        ids_hecho  = [f["id_hecho"]  for f in filas]

        t0 = _time()
        matriz = np.array([
            armar_vector({
                "actividad":          f["actividad"],
                "postura_dominante":  f["postura_dominante"],
                "interaccion_social": f["interaccion_social"],
                "esta_fumando":       f["esta_fumando"],
                "presencia_humana":   f["presencia_humana"],
                "conteo_personas":    f["conteo_personas"],
                "nivel_pm10":         f["nivel_pm10"],
                "temperatura":        f["temperatura"],
                "humedad":            f["humedad"],
                "nivel_riesgo_salud": f["nivel_riesgo_salud"],
                "hora":               f["hora"],
            })
            for f in filas
        ], dtype=np.float32)

        # Ponderación: actividad ×3 (primeras 8 dims), fumando ×5 (dim 22)
        matriz[:, :8] *= 3.0
        matriz[:, 22] *= 5.0
        stage_times["vectorizing_seconds"] = round(_time() - t0, 3)
        log.info("Pesos aplicados: actividad×3, fumando×5")

        # ── PCA 2D reproducible ─────────────────────────────────
        job.update("pca", 30, "Calculando PCA 2D.", records_total=len(filas), records_processed=len(filas), timings=stage_times)
        t0 = _time()
        pca = PCA(n_components=2, random_state=42)
        coords = pca.fit_transform(matriz)
        explained = float(pca.explained_variance_ratio_.sum())
        stage_times["pca_seconds"] = round(_time() - t0, 3)
        log.info("PCA 31→2 completo | varianza explicada: %.1f%%", explained * 100)

        job.update("writing_results", 60, "Escribiendo coordenadas PCA en columnas legacy.", records_total=len(filas), records_processed=len(filas), timings=stage_times)
        t0 = _time()
        async with pool.acquire() as conn:
            async with conn.transaction():
                for id_vec, coord in zip(ids_vector, coords):
                    await conn.execute("""
                        UPDATE warehouse.hechos_vectores_descripcion_habitos
                        SET umap_x = $1,
                            umap_y = $2,
                            umap_z = 0
                        WHERE id_vector = $3
                    """, float(coord[0]), float(coord[1]), id_vec)
        stage_times["db_write_seconds"] = round(_time() - t0, 3)

        log.info("PCA 2D completado — %d vectores actualizados (umap_z=0 legacy)", len(filas))

        # ── KMeans sobre coordenadas PCA 2D + bautizo semántico ─────
        job.update("kmeans", 72, "Agrupando coordenadas con KMeans(k=8).", records_total=len(filas), records_processed=len(filas), timings=stage_times)
        t0 = _time()
        from collections import Counter
        kmeans = KMeans(n_clusters=8, random_state=42, n_init="auto")
        labels = kmeans.fit_predict(coords)
        n_clusters = len(set(labels))
        stage_times["clustering_seconds"] = round(_time() - t0, 3)
        log.info("KMeans(k=8) completo — %d clusters | 0%% ruido", n_clusters)
        for cid, cnt in sorted(Counter(labels).items()):
            log.info("  cluster_%d: %d obs (%.1f%%)", cid, cnt, 100 * cnt / len(labels))

        if n_clusters > 0:
            job.update("labeling", 82, f"Bautizando {n_clusters} clusters con Qwen.", records_total=len(filas), records_processed=len(filas), timings=stage_times)
            t0 = _time()
            log.info("Bautizando %d clusters con Qwen...", n_clusters)
            bautizos, merge_map = await bautizar_clusters(labels, coords, ids_hecho, pool)
            stage_times["labeling_seconds"] = round(_time() - t0, 3)

            # Construir asignaciones aplicando merge_map
            asignaciones = {}
            for i, lbl in enumerate(labels):
                cid = int(lbl)
                if cid != -1:
                    cid_final = merge_map.get(cid, cid)
                    if cid_final in bautizos:
                        asignaciones[ids_hecho[i]] = cid_final
            payload = {
                "labels": bautizos,
                "assignments": asignaciones,
                "metadata": {
                    "job_id": job.job_id,
                    "query_hash": query_hash,
                    "filters": filters,
                    "feature_mask": CLUSTER_FEATURE_MASK,
                    "clustering_config": CLUSTERING_CONFIG,
                    "records_total": len(filas),
                    "created_at": iso_utc(),
                    "pca_explained_variance": round(explained, 4),
                }
            }

            # Meta-clustering SEMÁNTICO con merge_map aplicado
            if len(bautizos) >= 2:
                job.update("meta_habits", 90, "Generando meta-habitos semanticos.", records_total=len(filas), records_processed=len(filas), timings=stage_times)
                merged_labels = labels.copy()
                for i, lbl in enumerate(labels):
                    cid = int(lbl)
                    if cid != -1:
                        merged_labels[i] = merge_map.get(cid, cid)
                meta_labels_dict, meta_assignments, cluster_to_meta = \
                    await semantic_utils.meta_clustering_semantico(
                        bautizos, merged_labels, ids_hecho, pool, OLLAMA_URL, QWEN_MODEL)
                payload["meta_labels"] = meta_labels_dict
                payload["meta_assignments"] = meta_assignments
                payload["cluster_to_meta"] = cluster_to_meta
            else:
                meta_labels_dict, meta_assignments, cluster_to_meta = semantic_utils.fallback_meta_habitos(bautizos, labels, ids_hecho)
                payload["meta_labels"] = meta_labels_dict
                payload["meta_assignments"] = meta_assignments
                payload["cluster_to_meta"] = cluster_to_meta

            payload["metadata"]["timings"] = stage_times
            payload["metadata"]["total_seconds"] = round(_time() - total_started, 3)
            _atomic_write_json(CLUSTER_LABELS_FILE, payload)
            job.update("ready", 100, "Clusters listos y etiquetas escritas atomically.", records_total=len(filas), records_processed=len(filas), cache_status="hit", timings=stage_times, duration_seconds=payload["metadata"]["total_seconds"])
            log.info("Bautizos guardados → %s (%d clusters, %d asignaciones)",
                     CLUSTER_LABELS_FILE, len(bautizos), len(asignaciones))




# ── Limpieza automatica del datalake ─────────────────────────
async def limpiar_datalake(pool: asyncpg.Pool):
    """
    Elimina capturas_crudas procesadas mas antiguas de DATALAKE_RETAIN_DAYS dias.
    Solo afecta estados 'procesado' y 'completado' — nunca toca pendientes ni errores.
    Corre una vez al dia despues del clustering.
    """
    async with pool.acquire() as conn:
        # Contar antes de borrar
        n_candidatos = await conn.fetchval(f"""
            SELECT COUNT(*) FROM datalake.capturas_crudas
            WHERE estado_llava IN ('procesado', 'completado')
              AND estampa_tiempo < NOW() - INTERVAL '{DATALAKE_RETAIN_DAYS} days'
        """)

        if n_candidatos == 0:
            log.info("Limpieza datalake: nada que eliminar (< %dd procesadas)", DATALAKE_RETAIN_DAYS)
            return 0

        resultado = await conn.execute(f"""
            DELETE FROM datalake.capturas_crudas
            WHERE estado_llava IN ('procesado', 'completado')
              AND estampa_tiempo < NOW() - INTERVAL '{DATALAKE_RETAIN_DAYS} days'
        """)
        n_borradas = int(resultado.split()[-1])

        # Resumen del datalake post-limpieza
        resumen = await conn.fetch("""
            SELECT estado_llava, COUNT(*) AS n
            FROM datalake.capturas_crudas
            GROUP BY estado_llava ORDER BY n DESC
        """)
        log.info("Limpieza datalake completa: %d capturas eliminadas (> %dd)",
                 n_borradas, DATALAKE_RETAIN_DAYS)
        for row in resumen:
            log.info("  datalake [%s]: %d", row["estado_llava"], row["n"])

    return n_borradas


# ── Ciclos ────────────────────────────────────────────────────
async def ciclo_vectorizacion(pool: asyncpg.Pool):
    while True:
        log.info("[Fase 3] Vectorizacion horaria...")
        try:
            n = await fase3_vectorizar(pool)
            if n > 0:
                log.info("Fase 3 completa — %d vectores nuevos", n)
        except Exception as e:
            log.error("Error en fase 3: %s", e)
        await asyncio.sleep(VECTORIZE_INTERVAL)


async def ciclo_clustering(pool: asyncpg.Pool):
    while True:
        ahora  = utcnow()
        target = ahora.replace(hour=CLUSTER_HOUR, minute=0, second=0, microsecond=0)
        if ahora >= target:
            target = target + timedelta(days=1)
        espera = (target - ahora).total_seconds()

        log.info("[Fase 4] Proximo clustering PCA/KMeans a las %02d:00 UTC (en %.0fmin)",
                 CLUSTER_HOUR, espera / 60)
        await asyncio.sleep(espera)

        log.info("[Fase 4] PCA/KMeans iniciando...")
        try:
            await fase4_clustering(pool)
        except Exception as e:
            log.error("Error en fase 4: %s", e)

        # Limpieza datalake despues del clustering (una vez al dia)
        try:
            await limpiar_datalake(pool)
        except Exception as e:
            log.error("Error en limpieza datalake: %s", e)


def _pop_recompute_request() -> dict | None:
    if not os.path.exists(CLUSTER_REQUESTS_FILE):
        return None
    try:
        with open(CLUSTER_REQUESTS_FILE, encoding="utf-8") as fh:
            lines = [line for line in fh.readlines() if line.strip()]
        if not lines:
            return None
        first, rest = lines[0], lines[1:]
        directory = os.path.dirname(CLUSTER_REQUESTS_FILE) or "."
        os.makedirs(directory, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(prefix="cluster_recompute_requests.", suffix=".tmp", dir=directory)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.writelines(rest)
        os.replace(tmp_path, CLUSTER_REQUESTS_FILE)
        return json.loads(first)
    except Exception as e:
        log.error("No se pudo leer solicitud de recomputo: %s", e)
        return None


async def ciclo_recompute_requests(pool: asyncpg.Pool):
    while True:
        req = _pop_recompute_request()
        if req:
            job_id = req.get("job_id") or str(uuid.uuid4())
            filters = req.get("filters") or {"intervalo": f"{UMAP_WINDOW_DAYS} days"}
            query_hash = req.get("query_hash") or _cluster_query_hash(filters)
            log.info("[Fase 4] Recomputo solicitado job=%s hash=%s", job_id, query_hash[:12])
            try:
                await fase4_clustering(pool, filters=filters, job_id=job_id, query_hash=query_hash)
            except Exception as e:
                job = ClusterJob(job_id, query_hash, filters)
                job.update("failed", 100, f"Error en recomputo: {e}", error=str(e))
                log.exception("Error en recomputo solicitado")
        await asyncio.sleep(2)


async def main():
    log.info("Habits Worker iniciando | vectorize=%ds | cluster_hour=%dh UTC",
             VECTORIZE_INTERVAL, CLUSTER_HOUR)

    for i in range(20):
        try:
            pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=5)
            log.info("PostgreSQL conectado")
            break
        except Exception as e:
            log.warning("Esperando postgres (%d/20): %s", i+1, e)
            await asyncio.sleep(5)
    else:
        raise RuntimeError("No se pudo conectar a PostgreSQL")

    await asyncio.gather(
        ciclo_vectorizacion(pool),
        ciclo_clustering(pool),
        ciclo_recompute_requests(pool)
    )


if __name__ == "__main__":
    asyncio.run(main())
