"""
Utilidades semánticas para clustering y bautizo de hábitos.
Compartidas entre habits_worker.py, forzar_bautizo.py y forzar_optimizacion.py
"""
import re
import json
import logging
import numpy as np
from collections import Counter, defaultdict

log = logging.getLogger("semantic_utils")

RE_GENERICO = re.compile(
    r"^(actividad|comportamiento|humano|normal|escena|individuo|"
    r"sujeto|accion|sin nombre|desconocido|patron|presencia|"
    r"sin_clasificar|no_determinado|undefined|unknown|cluster)\b",
    re.IGNORECASE
)

DIAS_ES = {"Monday":"lunes","Tuesday":"martes","Wednesday":"miércoles",
           "Thursday":"jueves","Friday":"viernes",
           "Saturday":"sábado","Sunday":"domingo"}


def limpiar_respuesta_qwen(raw: str, cid: int) -> str:
    """Limpia la respuesta cruda de Qwen: saltos, CJK, puntuacion."""
    etiqueta = raw.split("\n")[0].strip().strip('"').strip("'").rstrip(".")
    etiqueta = re.split(r"[一-鿿　-〿＀-￯]", etiqueta)[0].strip().rstrip(",").strip()
    etiqueta = re.sub(r'\s{2,}', ' ', etiqueta)
    if RE_GENERICO.match(etiqueta) or len(etiqueta) < 3:
        etiqueta = f"Cluster {cid}"
    return etiqueta


def es_nombre_generico(etiqueta: str | None) -> bool:
    """Detecta etiquetas no interpretables para activar fallback local."""
    if not etiqueta:
        return True
    return bool(RE_GENERICO.match(str(etiqueta).strip()))


def fallback_nombre_semantico(stats: dict | None, cid: int, n_obs: int = 0) -> dict:
    """
    Bautizo determinístico basado en estadísticos agregados del cluster.
    No usa LLM y evita nombres tipo "Actividad 1" cuando hay evidencia mínima.
    """
    stats = stats or {}

    def _float(key: str, default: float = 0.0) -> float:
        try:
            return float(stats.get(key) or default)
        except (TypeError, ValueError):
            return default

    actividad = str(stats.get("actividad_top") or "actividad variada").replace("_", " ").strip()
    social_raw = str(stats.get("social_top") or "").lower()
    hora = int(_float("hora_cdmx_prom", 12))
    pct_fuma = _float("pct_fumadores")
    prom_personas = _float("prom_personas")
    prom_pm10 = _float("prom_pm10")

    if "pareja" in social_raw or 1.5 <= prom_personas < 3:
        contexto = "en pareja"
    elif "grupo_grande" in social_raw or prom_personas >= 4:
        contexto = "grupal"
    elif "grupo" in social_raw or prom_personas >= 3:
        contexto = "en grupo pequeno"
    elif "solo" in social_raw or 0.5 <= prom_personas < 1.5:
        contexto = "individual"
    elif "sin_personas" in social_raw or prom_personas < 0.5:
        contexto = "sin presencia dominante"
    else:
        contexto = "social no determinado"

    if hora < 12:
        turno = "matutina"
    elif hora < 18:
        turno = "vespertina"
    else:
        turno = "nocturna"

    if pct_fuma >= 15:
        base = "Consumo"
        detalle = contexto
    elif actividad in ("descansar", "usar celular", "usar_celular"):
        base = "Pausa"
        detalle = contexto
    elif actividad in ("reunion", "estudiar"):
        base = "Convivencia" if "grupo" in contexto or "pareja" in contexto else "Actividad academica"
        detalle = contexto
    elif actividad == "caminar":
        base = "Transito"
        detalle = contexto
    else:
        base = actividad.capitalize() if actividad else "Patron conductual"
        detalle = contexto

    nombre = f"{base} {detalle} {turno}".strip()
    nombre = " ".join(nombre.split())
    nombre = nombre.replace("usar celular", "con celular")

    dominant = []
    if actividad:
        dominant.append(f"actividad:{actividad}")
    dominant.append(f"contexto:{contexto}")
    dominant.append(f"hora:{turno}")
    if pct_fuma >= 5:
        dominant.append(f"fumado:{pct_fuma:.1f}%")
    if prom_pm10 > 50:
        dominant.append(f"pm10:{prom_pm10:.1f}")

    warnings = []
    if n_obs and n_obs < 50:
        warnings.append("Muestra pequena: interpretacion exploratoria.")
    if actividad in ("otro", "actividad variada"):
        warnings.append("Actividad dominante poco especifica.")
    if contexto == "social no determinado":
        warnings.append("Contexto social debil o ausente.")

    description = (
        f"Cluster interpretado por actividad dominante '{actividad}', contexto {contexto}, "
        f"hora promedio {hora}h y {pct_fuma:.1f}% de escenas con fumado. "
        "Resultado descriptivo; no implica causalidad."
    )

    return {
        "name": nombre if not es_nombre_generico(nombre) else f"Patron conductual {cid}",
        "description": description,
        "dominant_features": dominant,
        "confidence": 0.55 if warnings else 0.7,
        "warnings": warnings,
        "source": "deterministic_fallback",
    }


def fallback_meta_habitos(bautizos: dict, labels: np.ndarray, ids_hecho: list) -> tuple[dict, dict, dict]:
    """Agrupa meta-hábitos localmente por intención semántica gruesa."""
    buckets: dict[str, list[int]] = defaultdict(list)
    for cid, nombre in bautizos.items():
        low = str(nombre).lower()
        if any(w in low for w in ("consumo", "fum", "tabaco")):
            key = "Consumo observado agregado"
        elif any(w in low for w in ("convivencia", "grupo", "pareja", "social")):
            key = "Interaccion social agregada"
        elif any(w in low for w in ("pausa", "descanso", "celular")):
            key = "Pausas de permanencia"
        elif any(w in low for w in ("transito", "caminar")):
            key = "Movilidad y transicion"
        elif any(w in low for w in ("academ", "estudi", "reunion")):
            key = "Actividad academica observada"
        else:
            key = "Patrones conductuales mixtos"
        buckets[key].append(int(cid))

    meta_labels = {}
    cluster_to_meta = {}
    for mid, (name, cids) in enumerate(sorted(buckets.items())):
        meta_labels[mid] = name
        for cid in cids:
            cluster_to_meta[cid] = mid

    meta_assignments = {
        hid: cluster_to_meta[int(lbl)]
        for hid, lbl in zip(ids_hecho, labels)
        if int(lbl) in cluster_to_meta
    }
    return meta_labels, meta_assignments, cluster_to_meta


def prompt_bautizo_mejorado(
    stats,
    rows_near: list,
    rows_periph: list,
    n_obs: int,
    nombres_existentes: list | None = None,
) -> str:
    """Prompt mejorado para bautizo:
    - Sin appending mecanico de tabaquismo (Qwen decide si integrarlo)
    - Reglas sociales explicitas
    - Anti-redundancia: recibe nombres ya usados para evitar repeticion
    - Prohibe patrones genericos
    """
    hora_prom = int(stats["hora_cdmx_prom"] or 0)
    turno = "mañana" if hora_prom < 12 else ("tarde" if hora_prom < 18 else "noche")
    dia_es = DIAS_ES.get(stats["dia_top"] or "", (stats["dia_top"] or "").lower())
    actividad = (stats["actividad_top"] or "variada").replace("_", " ")
    social = (stats["social_top"] or "no determinada").replace("_", " ")
    prom_personas = float(stats["prom_personas"] or 0)
    pct_fuma = float(stats["pct_fumadores"] or 0)
    tiene_pm10 = int(stats["sin_pm10"] or 0) < int(stats["n"] or 0) * 0.5
    pm10_val = float(stats["prom_pm10"] or 0)
    pm10_str = f"{pm10_val:.1f} µg/m³" if tiene_pm10 else "sin datos de sensor"

    ctx = (
        f"- Observaciones en el cluster: {n_obs}\n"
        f"- Horario: {stats['hora_rango']} CDMX, hora pico ~{hora_prom}h ({turno})\n"
        f"- Día más frecuente: {dia_es}\n"
        f"- Personas promedio por escena: {prom_personas:.1f}\n"
        f"- Actividad dominante: {actividad}\n"
        f"- Tipo de interacción social: {social}\n"
        f"- Fumadores detectados: {pct_fuma}% de las escenas\n"
        f"- Calidad del aire PM10: {pm10_str}\n"
    )

    textos_centro = "\n".join(f"  · {r['resumen_semantico']}" for r in rows_near)
    textos_periferia = "\n".join(f"  · {r['resumen_semantico']}" for r in rows_periph)

    reglas_sociales = ""
    if prom_personas >= 2:
        reglas_sociales += "NO uses 'solo' ni 'solitario' ni 'individual' - hay varias personas en escena.\n"
    if prom_personas >= 4:
        reglas_sociales += "Usa 'grupo', 'varios' o describe la interacción social directamente.\n"
    if prom_personas < 0.5:
        reglas_sociales += "Son escenas sin personas o con muy poca presencia humana.\n"

    reglas_tabaco = ""
    if pct_fuma >= 15:
        reglas_tabaco = "INTEGRA el tabaquismo naturalmente en la descripción (ej: 'fumando mientras conversan').\n"
    elif pct_fuma >= 5:
        reglas_tabaco = "El tabaquismo es visible pero NO es lo principal. Mencionalo solo si complementa la escena.\n"
    else:
        reglas_tabaco = "NO menciones tabaquismo - no es relevante en este grupo.\n"

    warning_redundancia = ""
    if nombres_existentes:
        warning_redundancia = (
            "EVITA repetir estos nombres que ya existen:\n" +
            "\n".join(f"  · '{n}'" for n in nombres_existentes[:8]) +
            "\n---\n"
        )

    prompt = (
        "Eres el vigilante de un campus universitario (ESCOM-IPN, CDMX). "
        "Describes en voz alta lo que ves, de forma natural y concreta.\n\n"
        f"DATOS DE LA ESCENA ({n_obs} observaciones):\n{ctx}\n"
        f"LO QUE SE VE EN EL CENTRO DEL GRUPO:\n{textos_centro}\n"
    )
    if textos_periferia:
        prompt += f"\nCASOS MÁS VARIADOS DEL MISMO GRUPO:\n{textos_periferia}\n"
    prompt += (
        f"\n{warning_redundancia}"
        f"{reglas_sociales}"
        f"{reglas_tabaco}"
        "Describe este patrón como lo describirías a un colega en 5 a 8 palabras.\n"
        "NO uses estos patrones genéricos:\n"
        "  - 'estudiante solo con celular' (demasiado genérico, sé específico)\n"
        "  - 'alumno solitario con laptop' (describe qué hace y dónde)\n"
        "  - 'chico estudiando con dispositivo' (muy ambiguo)\n\n"
        "ESTILO (solo como guía):\n"
        "  - 'pareja comiendo y conversando en áreas verdes'\n"
        "  - 'grupo de estudio con laptops en biblioteca'\n"
        "  - 'alumnos fumando en la entrada al atardecer'\n"
        "  - 'estudiantes descansando en bancas al mediodía con smog'\n"
        "  - 'campus vacío viernes por la tarde'\n\n"
        "REGLAS:\n"
        "  - Si PM10 > 50, menciónalo como 'con smog' o 'con aire pesado'\n"
        "  - Sé ESPECÍFICO: día si es distintivo, lugar si se infiere, actividad concreta\n"
        "  - NO añadas 'posible' ni 'posiblemente' - describe lo que ves\n"
        "Responde SOLO la descripción en ESPAÑOL, sin explicación ni puntuación final."
    )
    return prompt


async def dedup_semantico(
    bautizos: dict,
    labels: np.ndarray,
    ids_hecho: list,
    pool,
    ollama_url: str,
    qwen_model: str,
) -> tuple[dict, dict]:
    """
    Deduplicación SEMÁNTICA: agrupa clusters con nombres similares
    usando Qwen y los fusiona.

    Returns:
        (cleaned_bautizos, merge_map)
        - cleaned_bautizos: solo los clusters ganadores
        - merge_map: {old_cluster_id: winner_cluster_id}
    """
    import httpx

    if len(bautizos) < 2:
        return bautizos, {}

    cids = list(bautizos.keys())
    nombres = [bautizos[c].lower() for c in cids]

    grupos_fusion = []

    async with httpx.AsyncClient() as client:
        for i in range(0, len(cids), 8):
            batch_cids = cids[i:i+8]
            batch_nombres = "\n".join(
                f"  {j}. '{bautizos[c]}' ({int((labels == c).sum())} obs)"
                for j, c in enumerate(batch_cids)
            )
            prompt = (
                "Eres un analista de comportamiento en un campus universitario.\n"
                f"Tienes estos {len(batch_cids)} grupos con sus nombres y tamaños:\n\n"
                f"{batch_nombres}\n\n"
                "Identifica cuáles describen el MISMO comportamiento y deberían fusionarse.\n"
                "Dos grupos son el mismo comportamiento si la ACTIVIDAD y el CONTEXTO son equivalentes,\n"
                "aunque la hora o el día varíen.\n"
                "NO fusiones grupos con actividades diferentes (ej: 'comiendo' vs 'estudiando').\n\n"
                "Responde SOLO con JSON. Ejemplo:\n"
                '{"fusiones": [[0, 2], [1]]}\n'
                "Donde 0 y 2 (índices de la lista) se fusionan (se quedan con el nombre del más grande),\n"
                "y 1 se queda solo. Los números son los ÍNDICES de la lista (0, 1, 2...).\n"
                "Responde SOLO el JSON, sin explicación."
            )
            try:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": qwen_model, "prompt": prompt, "stream": False,
                          "options": {"temperature": 0.1, "num_predict": 200}},
                    timeout=120
                )
                resp.raise_for_status()
                raw = resp.json().get("response", "").strip()
                raw = raw.replace("```json", "").replace("```", "").strip()
                data = json.loads(raw)
                fusiones = data.get("fusiones", [])
                for grupo in fusiones:
                    if isinstance(grupo, list) and len(grupo) > 1:
                        grupo_cids = [batch_cids[idx] for idx in grupo if idx < len(batch_cids)]
                        if len(grupo_cids) > 1:
                            # Winner = largest cluster
                            sizes = [(c, int((labels == c).sum())) for c in grupo_cids]
                            winner = max(sizes, key=lambda x: x[1])[0]
                            grupos_fusion.append((winner, [c for c in grupo_cids if c != winner]))
            except Exception as e:
                log.warning("dedup_semantico batch %d fallo: %s", i // 8, e)
                continue

    if not grupos_fusion:
        return bautizos, {}

    merge_map = {}
    cleaned = dict(bautizos)
    for winner, perdidos in grupos_fusion:
        for p in perdidos:
            if p in cleaned:
                del cleaned[p]
                merge_map[p] = winner
                log.info("  Fusion: cluster_%d → cluster_%d ('%s')", p, winner, bautizos[winner])

    log.info("Dedup semantico: %d → %d clusters (fusionados %d)",
             len(bautizos), len(cleaned), len(merge_map))
    return cleaned, merge_map


async def meta_clustering_semantico(
    bautizos: dict,
    labels: np.ndarray,
    ids_hecho: list,
    pool,
    ollama_url: str,
    qwen_model: str,
) -> tuple[dict, dict, dict]:
    """
    Meta-clustering SEMÁNTICO: usa Qwen para agrupar clusters
    por similitud de NOMBRES (no por distancia UMAP 3D).
    Para > 80 clusters, usa agrupación por keywords como pre-procesamiento
    antes de la llamada a Qwen.

    Returns:
        (meta_labels_dict, meta_assignments, cluster_to_meta)
    """
    import httpx

    cids = sorted(bautizos.keys())
    if len(cids) < 2:
        mid = 0
        meta_labels = {mid: bautizos.get(cids[0], "Único hábito") if cids else "Sin datos"}
        cluster_to_meta = {cids[0]: mid} if cids else {}
        meta_assignments = {hid: mid for hid, c in zip(ids_hecho, labels) if int(c) in cids} if cids else {}
        return meta_labels, meta_assignments, cluster_to_meta

    # Para conjuntos grandes (> 80), hacer agrupación previa por keywords
    if len(cids) > 80:
        return _agrupar_por_keywords(bautizos, labels, ids_hecho)

    lista = "\n".join(
        f"  {j}. '{bautizos[c]}' ({int((labels == c).sum())} obs)"
        for j, c in enumerate(cids)
    )

    prompt_agrupar = (
        "Eres un analista de comportamiento urbano.\n"
        f"Tienes estos {len(cids)} comportamientos identificados en un campus universitario:\n\n"
        f"{lista}\n\n"
        "Agrúpalos en categorías generales (meta-hábitos) basándote en la SIMILITUD DEL COMPORTAMIENTO.\n"
        "Criterios:\n"
        "  - Misma actividad principal → mismo meta (ej: todos los 'comiendo' juntos)\n"
        "  - Mismo contexto social → mismo meta (ej: todos los 'en grupo' juntos)\n"
        "  - NO separes por hora/día a menos que el comportamiento sea claramente distinto\n"
        "  - Crea entre 5 y 15 grupos\n\n"
        "Responde SOLO con JSON:\n"
        '{"grupos": [{"nombre": "Descripción del meta", "indices": [0, 3, 7]}, ...]}\n'
        "Donde 'indices' son los números de la lista de arriba (0, 1, 2...).\n"
        "Responde SOLO el JSON."
    )

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": qwen_model, "prompt": prompt_agrupar, "stream": False,
                      "options": {"temperature": 0.2, "num_predict": 1000}},
                timeout=180
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "").strip()
            raw = raw.replace("```json", "").replace("```", "").strip()
            data = json.loads(raw)
            grupos = data.get("grupos", [])
        except Exception as e:
            log.warning("meta_clustering_semantico Qwen fallo: %s", e)
            return _agrupar_por_keywords(bautizos, labels, ids_hecho)

        if not grupos:
            return _agrupar_por_keywords(bautizos, labels, ids_hecho)

        meta_labels_dict = {}
        cluster_to_meta = {}
        mid = 0
        for grupo in grupos:
            nombre = grupo.get("nombre", f"Grupo {mid}")
            indices = grupo.get("indices", [])
            valid_indices = [idx for idx in indices if idx < len(cids)]
            if not valid_indices:
                continue
            for idx in valid_indices:
                cluster_to_meta[cids[idx]] = mid
            meta_labels_dict[mid] = nombre
            mid += 1

        if not cluster_to_meta:
            return _agrupar_por_keywords(bautizos, labels, ids_hecho)

        # Asignar clusters huérfanos al meta-grupo más cercano por solapamiento de palabras
        orfanos = [c for c in cids if c not in cluster_to_meta]
        if orfanos:
            meta_tokens = {}
            for mid, name in meta_labels_dict.items():
                meta_tokens[mid] = set(name.lower().split())
            for c in orfanos:
                c_tokens = set(bautizos[c].lower().split())
                best_mid = max(meta_tokens, key=lambda mid: len(c_tokens & meta_tokens[mid]))
                cluster_to_meta[c] = best_mid
                log.info("  cluster_%d huérfano → meta_%d (coincidencia léxica)", c, best_mid)

        meta_assignments = {}
        for i, lbl in enumerate(labels):
            cid = int(lbl)
            if cid in cluster_to_meta:
                meta_assignments[ids_hecho[i]] = cluster_to_meta[cid]

        log.info("Meta-clustering semántico: %d clusters → %d meta-hábitos",
                 len(cids), len(meta_labels_dict))
        for mid, name in sorted(meta_labels_dict.items()):
            miembros = [c for c, m in cluster_to_meta.items() if m == mid]
            log.info("  meta_%d '%s': clusters %s", mid, name, miembros)
        return meta_labels_dict, meta_assignments, cluster_to_meta


def _agrupar_por_keywords(bautizos, labels, ids_hecho):
    """Agrupa clusters por palabras clave en el nombre.
    Fallback cuando Qwen no puede procesar todos los clusters a la vez.
    """
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.cluster import KMeans

    cids = sorted(bautizos.keys())
    nombres = [bautizos[c].lower() for c in cids]

    # Extraer bigramas de palabras para capturar frases cortas
    nombres_proc = [n.replace("(", "").replace(")", "").replace(",", "") for n in nombres]

    try:
        vectorizer = TfidfVectorizer(
            analyzer="word", ngram_range=(1, 2),
            max_features=200, stop_words=["de", "la", "el", "en", "con", "por", "al", "del", "y",
                                          "los", "las", "un", "una", "que", "es", "se", "para"]
        )
        X = vectorizer.fit_transform(nombres_proc)

        n_clusters_meta = min(max(len(cids) // 10, 5), 15)
        km = KMeans(n_clusters=n_clusters_meta, random_state=42, n_init="auto")
        grupos = km.fit_predict(X)
    except Exception as e:
        log.warning("_agrupar_por_keywords fallo: %s", e)
        return _fallback_individual(bautizos, labels, ids_hecho)

    from collections import defaultdict
    meta_to_cids = defaultdict(list)
    for i, c in enumerate(cids):
        meta_to_cids[int(grupos[i])].append(c)

    meta_labels = {}
    cluster_to_meta = {}
    for mid, members in meta_to_cids.items():
        # El nombre del meta es el del cluster más grande
        sizes = [(c, int((labels == c).sum())) for c in members]
        winner = max(sizes, key=lambda x: x[1])[0]
        meta_labels[mid] = bautizos.get(winner, f"Grupo {mid}")
        for c in members:
            cluster_to_meta[c] = mid

    meta_assignments = {
        hid: cluster_to_meta[int(lbl)]
        for hid, lbl in zip(ids_hecho, labels)
        if int(lbl) in cluster_to_meta
    }

    log.info("Meta-clustering por keywords: %d clusters → %d meta-hábitos",
             len(cids), len(meta_labels))
    return meta_labels, meta_assignments, cluster_to_meta


def _fallback_individual(bautizos, labels, ids_hecho):
    """Fallback: cada cluster es su propio meta (sin Qwen)."""
    meta_labels = {}
    cluster_to_meta = {}
    for i, c in enumerate(sorted(bautizos.keys())):
        cluster_to_meta[int(c)] = i
        meta_labels[i] = bautizos[c]
    meta_assignments = {
        hid: cluster_to_meta[int(lbl)]
        for hid, lbl in zip(ids_hecho, labels)
        if int(lbl) in cluster_to_meta
    }
    return meta_labels, meta_assignments, cluster_to_meta


async def split_semantico_condicional(
    labels: np.ndarray,
    coords: np.ndarray,
    ids_hecho: list,
    pool,
    min_cluster_size: int = 50,
    umbral_diversidad: float = 0.4,
) -> np.ndarray:
    """
    Para clusters grandes (>200 obs), revisa si hay sub-comportamientos
    distintos adentro. Si los hay, re-ejecuta HDBSCAN localmente.

    Args:
        labels: asignaciones actuales de HDBSCAN
        coords: coordenadas UMAP 3D
        ids_hecho: IDs de cada punto
        pool: conexión a BD
        min_cluster_size: para el split local
        umbral_diversidad: si top actividad < (1-umbral), hay diversidad

    Returns:
        labels actualizado con splits
    """
    try:
        import hdbscan as hdbscan_lib
    except ImportError:
        return labels

    from collections import Counter as _Counter

    unique_cids = [int(c) for c in sorted(set(labels)) if c != -1]
    next_label = max(labels) + 1 if len(labels) > 0 else 0
    new_labels = labels.copy()

    for cid in unique_cids:
        mask = labels == cid
        n_obs = int(mask.sum())
        if n_obs < 200:
            continue

        hecho_ids = [ids_hecho[i] for i in range(len(labels)) if mask[i]]

        async with pool.acquire() as conn:
            act_rows = await conn.fetch("""
                SELECT h.actividad, COUNT(*) AS n
                FROM warehouse.hechos_actividades_escenaurbana h
                WHERE h.id_hecho = ANY($1) AND h.actividad IS NOT NULL
                GROUP BY h.actividad
                ORDER BY n DESC
            """, hecho_ids)

        if not act_rows:
            continue

        total = sum(r["n"] for r in act_rows)
        top_pct = act_rows[0]["n"] / total if total > 0 else 1.0
        distinct_acts = len(act_rows)

        if top_pct >= (1.0 - umbral_diversidad) or distinct_acts < 2:
            continue

        log.info("Split semántico: cluster_%d (%d obs) top=%.0f%% %d actividades distintas",
                 cid, n_obs, top_pct * 100, distinct_acts)

        sub_coords = coords[mask]
        sub_clusterer = hdbscan_lib.HDBSCAN(
            min_cluster_size=min(min_cluster_size, n_obs // 3),
            min_samples=5, core_dist_n_jobs=1
        )
        sub_labels = sub_clusterer.fit_predict(sub_coords)

        n_sub = len(set(sub_labels)) - (1 if -1 in sub_labels else 0)
        log.info("  Split → %d sub-clusters + ruido", n_sub)

        sub_idx = np.where(mask)[0]
        for j, sl in enumerate(sub_labels):
            if sl == -1:
                new_labels[sub_idx[j]] = -1
            else:
                new_labels[sub_idx[j]] = int(next_label + sl)

        next_label += n_sub

    return new_labels
