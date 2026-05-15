"""
Fuerza el pipeline completo: features → PCA → UMAP 2D → KMeans → bautizo → dedup → meta.
Actualiza coordenadas UMAP en BD y escribe /app/cluster_labels.json.
v5: PCA 31→10 elimina ruido, UMAP 10→2 (n=200) para estructura global.
Ejecutar dentro del contenedor isla_habitos.
"""
import asyncio
import json
import os
import sys
import numpy as np
import asyncpg
import httpx
from collections import Counter, defaultdict
from umap import UMAP
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

sys.path.insert(0, "/app")
import importlib.util
spec = importlib.util.spec_from_file_location("habits_worker", "/app/habits_worker.py")
hw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hw)
armar_vector = hw.armar_vector

import semantic_utils

DB_DSN              = os.getenv("DATABASE_URL",       "postgresql://postgres:postgres@isla_postgres:5432/postgres")
OLLAMA_URL          = os.getenv("OLLAMA_URL",         "http://isla_ollama_llava:11434")
QWEN_MODEL          = os.getenv("QWEN_MODEL",         "qwen2.5:14b")
CLUSTER_LABELS_FILE = os.getenv("CLUSTER_LABELS_FILE","/app/cluster_labels.json")
UMAP_WINDOW_DAYS    = int(os.getenv("UMAP_WINDOW_DAYS", "30"))
KMEANS_K            = 8
PCA_N_COMPONENTS    = 10


async def main():
    pool = await asyncpg.create_pool(DB_DSN)

    async with pool.acquire() as conn:
        filas = await conn.fetch(f"""
            SELECT v.id_hecho, v.id_vector,
                   h.actividad, h.postura_dominante, h.interaccion_social,
                   h.esta_fumando, h.presencia_humana, h.conteo_personas,
                   h.nivel_pm10, h.temperatura, h.humedad, h.nivel_riesgo_salud,
                   t.hora
            FROM   warehouse.hechos_vectores_descripcion_habitos v
            JOIN   warehouse.hechos_actividades_escenaurbana h ON h.id_hecho = v.id_hecho
            JOIN   warehouse.dim_tiempo t ON t.id_tiempo = h.id_tiempo
            WHERE  v.id_hecho IS NOT NULL
              AND  h.actividad IS NOT NULL
              AND  h.actividad != 'escena_vacia'
              AND  LOWER(h.actividad) NOT LIKE 'ausencia%'
              AND  t.fecha_completa >= CURRENT_DATE - INTERVAL '{UMAP_WINDOW_DAYS} days'
            ORDER  BY v.id_vector DESC
            LIMIT  50000
        """)

    if not filas:
        print("Sin datos en BD.")
        return

    ids_hecho = [f["id_hecho"] for f in filas]
    ids_vector = [f["id_vector"] for f in filas]

    print(f"Construyendo vectores de features ({len(filas)} registros)...")
    matriz = np.array([armar_vector(dict(f)) for f in filas], dtype=np.float32)
    print(f"  Dimensiones: {matriz.shape[1]}")

    # Ponderación: actividad ×3 (primeras 8 dims), fumando ×5 (dima 22)
    matriz[:, :8] *= 3.0
    matriz[:, 22] *= 5.0
    print("  Pesos: actividad×3, fumando×5")

    # PCA 31→10 (elimina varianza residual)
    print(f"PCA {matriz.shape[1]}→{PCA_N_COMPONENTS}...")
    pca = PCA(n_components=PCA_N_COMPONENTS, random_state=42)
    matriz_pca = pca.fit_transform(matriz)
    var_exp = pca.explained_variance_ratio_.sum()
    print(f"  Varianza explicada: {var_exp:.3f} ({var_exp*100:.1f}%)")

    # UMAP 10→2 (global: n_neighbors=200, min_dist=0.1)
    print(f"UMAP {PCA_N_COMPONENTS}→2 (n_neighbors=200, min_dist=0.1)...")
    reducer = UMAP(n_components=2, n_neighbors=200,
                   min_dist=0.1, random_state=42, n_jobs=1)
    coords = reducer.fit_transform(matriz_pca)
    print(f"  UMAP completo — {len(coords)} puntos")

    # Guardar coordenadas en BD
    print("Actualizando coordenadas UMAP en BD...")
    async with pool.acquire() as conn:
        for i, hid in enumerate(ids_hecho):
            await conn.execute("""
                UPDATE warehouse.hechos_vectores_descripcion_habitos
                SET umap_x = $1, umap_y = $2, umap_z = 0
                WHERE id_hecho = $3
            """, float(coords[i, 0]), float(coords[i, 1]), hid)
    print(f"  {len(ids_hecho)} filas actualizadas (umap_z=0)")

    # KMeans sobre UMAP 2D
    print(f"KMeans(k={KMEANS_K}) sobre UMAP 2D...")
    kmeans = KMeans(n_clusters=KMEANS_K, random_state=42, n_init="auto")
    labels = kmeans.fit_predict(coords)

    conteos = Counter(labels)
    print(f"Clusters: {len(conteos)} | Ruido: 0 (0%)")
    for cid, cnt in sorted(conteos.items()):
        print(f"  cluster_{cid}: {cnt} obs ({100*cnt/len(labels):.1f}%)")

    cluster_indices: dict[int, list[int]] = defaultdict(list)
    for i, lbl in enumerate(labels):
        if lbl != -1:
            cluster_indices[int(lbl)].append(i)

    if not cluster_indices:
        print("Sin clusters.")
        return

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

            if not rows_near:
                bautizos[cid] = f"Cluster {cid}"
                nombres_asignados.append(f"Cluster {cid}")
                continue

            # Atajo para clusters vacíos
            if float(stats["pct_escena_vacia"] or 0) > 60:
                dia_es = semantic_utils.DIAS_ES.get(
                    stats["dia_top"] or "", (stats["dia_top"] or "").lower())
                hora   = int(stats["hora_cdmx_prom"] or 0)
                turno  = "mañana" if hora < 12 else ("tarde" if hora < 18 else "noche")
                etiqueta = f"Campus vacío {dia_es} {turno}"
                bautizos[cid] = etiqueta
                nombres_asignados.append(etiqueta)
                print(f"  cluster_{cid} ({len(indices)} obs) → '{etiqueta}'  [atajo vacío]")
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
                raw      = resp.json().get("response", "").strip()
                etiqueta = semantic_utils.limpiar_respuesta_qwen(raw, cid)
                bautizos[cid] = etiqueta
                nombres_asignados.append(etiqueta)
                print(f"  cluster_{cid} ({len(indices)} obs) → '{etiqueta}'")
            except Exception as e:
                print(f"  cluster_{cid} fallo: {e}")
                fb = f"Cluster {cid}"
                bautizos[cid] = fb
                nombres_asignados.append(fb)

    # Dedup semántico
    print("Dedup semántico...")
    bautizos, merge_map = await semantic_utils.dedup_semantico(
        bautizos, labels, ids_hecho, pool, OLLAMA_URL, QWEN_MODEL)

    # Construir asignaciones con merge_map
    asignaciones = {}
    for i, lbl in enumerate(labels):
        cid = int(lbl)
        if cid != -1:
            cid_final = merge_map.get(cid, cid)
            if cid_final in bautizos:
                asignaciones[ids_hecho[i]] = cid_final
    payload = {"labels": bautizos, "assignments": asignaciones}

    # Meta-clustering SEMÁNTICO
    if len(bautizos) >= 2:
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
        print("Solo 1 cluster — se omite meta-clustering.")

    # Guardar
    with open(CLUSTER_LABELS_FILE, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    n_meta = len(payload.get("meta_labels", {}))
    print(f"\nGuardado: {CLUSTER_LABELS_FILE}  ({len(bautizos)} clusters, "
          f"{len(asignaciones)} asignaciones, {n_meta} meta-hábitos)")

asyncio.run(main())
