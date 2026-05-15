import numpy as np
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score
import hashlib
import json
from collections import defaultdict

# ── Vocabularios cerrados (replican habits_worker) ─────────────────────
ACTIVIDADES = [
    "caminar", "comer", "descansar", "escena_vacia",
    "estudiar", "otro", "reunion", "usar_celular",
]
POSTURAS = ["caminando", "otro", "parado", "recostado", "sentado"]
SOCIALES = [
    "en_grupo_grande", "en_grupo_pequeno", "en_pareja",
    "sin_personas", "solo",
]
RIESGOS = ["alto", "bajo", "critico", "moderado"]

# Mapa: nombre_grupo -> (indices_en_vector_31, peso_defecto)
GRUPOS = {
    "actividad":   (slice(0, 8),   3.0, "8 one-hot: caminar, comer, descansar, escena_vacia, estudiar, otro, reunion, usar_celular"),
    "postura":     (slice(8, 13),  1.0, "5 one-hot: caminando, otro, parado, recostado, sentado"),
    "interaccion": (slice(13, 18), 1.0, "5 one-hot: grupo grande, grupo pequeño, pareja, sin personas, solo"),
    "riesgo":      (slice(18, 22), 1.0, "4 one-hot: alto, bajo, crítico, moderado (según cuartiles de personas)"),
    "fumando":     (22,            5.0, "1 binario: fumando detectado"),
    "ambiental":   (slice(23, 28), 1.0, "5 valores: presencia, conteo_norm, smog_alto, temp_norm, hum_norm"),
    "turno":       (slice(28, 31), 0.5, "3 one-hot: mañana(6-12), tarde(12-18), noche(18-6)"),
}

# Indices para aplicar pesos rapidamente
GRUPO_INDICES: dict[str, list[int]] = {}
for name, (idx, _, _) in GRUPOS.items():
    if isinstance(idx, slice):
        GRUPO_INDICES[name] = list(range(idx.start, idx.stop))
    else:
        GRUPO_INDICES[name] = [idx]


def _onehot(valor: str, vocabulario: list[str]) -> np.ndarray:
    v = (valor or "").strip().lower()
    arr = np.zeros(len(vocabulario), dtype=np.float32)
    if v in vocabulario:
        arr[vocabulario.index(v)] = 1.0
    return arr


def _riesgo_from_personas(n: float) -> str:
    if n <= 2:
        return "bajo"
    elif n <= 5:
        return "moderado"
    elif n <= 10:
        return "alto"
    else:
        return "critico"


def build_feature_vector(row: dict) -> np.ndarray:
    """Construye vector 31-dim sin pesos (igual que armar_vector() de habits_worker).
    Los pesos se aplican despues via apply_weights()."""
    hora = int(row.get("hora") or 12)
    pm10 = float(row.get("nivel_pm10") or row.get("pm10") or 0)
    temp_raw = float(row.get("temperatura") or 20.0)
    temp = (min(max(temp_raw, -10.0), 50.0) + 10.0) / 60.0
    hum = min(float(row.get("humedad") or 50.0), 100.0) / 100.0
    conteo = min(float(row.get("conteo_personas") or 0), 10.0) / 10.0

    n_pers = float(row.get("conteo_personas") or 0)
    riesgo_str = _riesgo_from_personas(n_pers)

    actividad = row.get("actividad") or ""
    postura = row.get("postura_predominante") or row.get("postura_dominante") or ""
    social = row.get("interaccion_social") or ""

    esta_fumando_val = row.get("esta_fumando") or row.get("tiene_fumadores") or False
    if isinstance(esta_fumando_val, str):
        esta_fumando_val = esta_fumando_val.lower() in ("true", "1", "si", "sí")
    presencia_val = 1.0 if n_pers > 0 else 0.0

    smog_alto = 1.0 if pm10 > 50 else 0.0
    turno_manana = 1.0 if 6 <= hora < 12 else 0.0
    turno_tarde = 1.0 if 12 <= hora < 18 else 0.0
    turno_noche = 1.0 if hora >= 18 or hora < 6 else 0.0

    return np.concatenate([
        _onehot(actividad, ACTIVIDADES),       # 8
        _onehot(postura, POSTURAS),            # 5
        _onehot(social, SOCIALES),             # 5
        _onehot(riesgo_str, RIESGOS),          # 4
        [
            1.0 if esta_fumando_val else 0.0,  # 1 — fumando
            presencia_val,                     # 1 — presencia
            conteo,                            # 1 — conteo_norm
            smog_alto,                         # 1 — smog_alto
            temp,                              # 1 — temp_norm
            hum,                               # 1 — hum_norm
            turno_manana,                      # 1 — turno_manana
            turno_tarde,                       # 1 — turno_tarde
            turno_noche,                       # 1 — turno_noche
        ],
    ], dtype=np.float32)


def apply_weights(vector: np.ndarray, weights: dict[str, float]) -> np.ndarray:
    """Aplica pesos por grupo a un vector 31-dim.
    Si un peso es 0, todas las dimensiones del grupo se anulan."""
    v = vector.copy()
    for group_name, group_weight in weights.items():
        if group_name not in GRUPO_INDICES:
            continue
        idxs = GRUPO_INDICES[group_name]
        w = float(group_weight)
        if w == 0:
            v[idxs] = 0.0
        else:
            v[idxs] *= w
    return v


def run_clustering(
    vectors: np.ndarray,
    n_clusters: int = 8,
    random_state: int = 42,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    """Ejecuta StandardScaler -> PCA(2) -> KMeans(k).
    Retorna (pca_x, pca_y, cluster_ids, pca_components, metrics)."""
    if vectors.ndim != 2 or vectors.shape[0] < 2:
        raise ValueError("Se requieren al menos 2 observaciones para clustering.")
    n_clusters = max(2, min(int(n_clusters), int(vectors.shape[0]) - 1))

    scaler = StandardScaler()
    scaled = scaler.fit_transform(vectors)

    n_comp = min(2, scaled.shape[0], scaled.shape[1])
    pca = PCA(n_components=n_comp, random_state=random_state)
    pca_result = pca.fit_transform(scaled)
    if pca_result.shape[1] == 1:
        pca_result = np.column_stack([pca_result[:, 0], np.zeros(pca_result.shape[0])])

    km = KMeans(n_clusters=n_clusters, random_state=random_state, n_init="auto")
    cluster_ids = km.fit_predict(pca_result)
    try:
        silhouette = float(silhouette_score(pca_result, cluster_ids)) if len(set(cluster_ids)) > 1 else None
    except Exception:
        silhouette = None
    metrics = {
        "silhouette": silhouette,
        "inertia": float(km.inertia_),
        "pca_explained_variance": float(pca.explained_variance_ratio_.sum()),
        "n_clusters": int(n_clusters),
        "random_state": int(random_state),
    }

    return (
        pca_result[:, 0].astype(np.float64),
        pca_result[:, 1].astype(np.float64),
        cluster_ids.astype(int),
        pca_result,
        metrics,
    )


def hash_config(filters: dict, weights: dict) -> str:
    """Genera un hash único para cache de configuracion de clustering custom."""
    raw = json.dumps({"f": filters, "w": weights}, sort_keys=True, default=str)
    return hashlib.md5(raw.encode()).hexdigest()


def semantic_label_from_rows(rows: list[dict], cid: int) -> dict:
    """Fallback semántico local para clusters on-demand."""
    n = len(rows)
    if not rows:
        return {
            "cluster_name": f"Patron conductual {cid}",
            "habit_name": "Patron conductual mixto",
            "meta_habit_name": "Patrones conductuales mixtos",
            "description": "Cluster sin observaciones asignadas.",
            "dominant_features": [],
            "confidence": 0.0,
            "warnings": ["Cluster vacio."],
        }

    def mode(key: str, default: str = "") -> str:
        vals = [str(r.get(key) or "").strip() for r in rows if str(r.get(key) or "").strip()]
        return max(set(vals), key=vals.count) if vals else default

    actividad = mode("actividad", "actividad variada").replace("_", " ")
    social = mode("interaccion_social", "")
    horas = [int(r.get("hora") or 0) for r in rows]
    hora_prom = round(sum(horas) / len(horas)) if horas else 12
    personas = [float(r.get("conteo_personas") or 0) for r in rows]
    prom_personas = sum(personas) / len(personas) if personas else 0
    pct_fuma = sum(1 for r in rows if r.get("esta_fumando")) / n * 100
    pm10_vals = [float(r.get("pm10") or 0) for r in rows if r.get("pm10") is not None]
    pm10 = sum(pm10_vals) / len(pm10_vals) if pm10_vals else 0

    if "pareja" in social or 1.5 <= prom_personas < 3:
        contexto = "en pareja"
    elif "grupo_grande" in social or prom_personas >= 4:
        contexto = "grupal"
    elif "grupo" in social or prom_personas >= 3:
        contexto = "en grupo pequeno"
    elif "solo" in social or 0.5 <= prom_personas < 1.5:
        contexto = "individual"
    elif prom_personas < 0.5:
        contexto = "sin presencia dominante"
    else:
        contexto = "social no determinado"

    turno = "matutina" if hora_prom < 12 else ("vespertina" if hora_prom < 18 else "nocturna")
    if pct_fuma >= 15:
        cluster_name = f"Consumo {contexto} {turno}"
        habit_name = "Consumo observado"
        meta = "Consumo y permanencia observada"
    elif actividad in ("descansar", "usar celular", "usar_celular"):
        cluster_name = f"Pausa {contexto} {turno}"
        habit_name = "Pausa de permanencia"
        meta = "Pausas de permanencia"
    elif actividad in ("reunion", "estudiar"):
        cluster_name = f"Convivencia {contexto} {turno}" if contexto != "individual" else f"Actividad academica {turno}"
        habit_name = "Interaccion academica" if contexto != "individual" else "Actividad academica individual"
        meta = "Actividad academica observada"
    elif actividad == "caminar":
        cluster_name = f"Transito {contexto} {turno}"
        habit_name = "Movilidad de transicion"
        meta = "Movilidad y transicion"
    else:
        cluster_name = f"{actividad.capitalize()} {contexto} {turno}"
        habit_name = "Patron conductual mixto"
        meta = "Patrones conductuales mixtos"

    dominant = [f"actividad:{actividad}", f"contexto:{contexto}", f"hora:{turno}"]
    if pct_fuma >= 5:
        dominant.append(f"fumado:{pct_fuma:.1f}%")
    if pm10 > 50:
        dominant.append(f"pm10:{pm10:.1f}")

    warnings = []
    if n < 50:
        warnings.append("Muestra pequena: interpretacion exploratoria.")
    if actividad in ("otro", "actividad variada"):
        warnings.append("Actividad dominante poco especifica.")
    if contexto == "social no determinado":
        warnings.append("Contexto social debil o ausente.")

    return {
        "cluster_name": " ".join(cluster_name.split()),
        "habit_name": habit_name,
        "meta_habit_name": meta,
        "description": (
            f"Grupo descriptivo con actividad dominante '{actividad}', contexto {contexto}, "
            f"hora promedio {hora_prom}h y {pct_fuma:.1f}% de escenas con fumado. No implica causalidad."
        ),
        "dominant_features": dominant,
        "confidence": 0.55 if warnings else 0.7,
        "warnings": warnings,
    }


def meta_labels_from_cluster_profiles(profiles: dict[int, dict]) -> tuple[dict[int, str], dict[int, int]]:
    buckets: dict[str, list[int]] = defaultdict(list)
    for cid, profile in profiles.items():
        buckets[str(profile.get("meta_habit_name") or "Patrones conductuales mixtos")].append(int(cid))
    meta_labels: dict[int, str] = {}
    cluster_to_meta: dict[int, int] = {}
    for mid, (name, cids) in enumerate(sorted(buckets.items())):
        meta_labels[mid] = name
        for cid in cids:
            cluster_to_meta[cid] = mid
    return meta_labels, cluster_to_meta
