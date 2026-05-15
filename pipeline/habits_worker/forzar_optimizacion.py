"""
One-shot: optimiza cluster_labels.json existente SIN re-ejecutar HDBSCAN.
Fusiona clusters semánticamente redundantes usando Qwen,
re-asigna asignaciones, regenera meta-hábitos.

Uso: docker exec isla_habitos python /app/forzar_optimizacion.py
"""
import asyncio
import json
import os
import sys
import numpy as np
from collections import Counter

import semantic_utils

CLUSTER_LABELS_FILE = os.getenv("CLUSTER_LABELS_FILE", "/app/cluster_labels.json")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://isla_ollama_llava:11434")
QWEN_MODEL = os.getenv("QWEN_MODEL", "qwen2.5:14b")

BACKUP_SUFFIX = ".bak_optimizacion"


async def main():
    if not os.path.exists(CLUSTER_LABELS_FILE):
        print(f"ERROR: No existe {CLUSTER_LABELS_FILE}")
        sys.exit(1)

    with open(CLUSTER_LABELS_FILE, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    bautizos_original = data.get("labels", {})
    asignaciones = data.get("assignments", {})

    if not bautizos_original:
        print("No hay clusters en el archivo.")
        return

    print(f"Archivo actual: {len(bautizos_original)} clusters, "
          f"{len(asignaciones)} asignaciones, "
          f"{len(data.get('meta_labels', {}))} meta-hábitos")

    # Reconstruir arrays compatibles con semantic_utils
    ids_hecho = list(asignaciones.keys())
    if not ids_hecho:
        print("No hay asignaciones - no se puede continuar.")
        return

    all_cids = sorted(set(asignaciones.values()))
    labels_list = [asignaciones[hid] for hid in ids_hecho]
    labels = np.array(labels_list, dtype=np.int32)

    # Mostrar distribución actual
    print("\nDistribución actual:")
    sizes = Counter(asignaciones.values())
    for cid in sorted(sizes.keys()):
        name = bautizos_original.get(str(cid), bautizos_original.get(cid, f"Cluster {cid}"))
        print(f"  cluster_{cid}: {sizes[cid]} obs → '{name}'")

    # ── Fase 1: Dedup semántico ──────────────────────────────
    # Necesitamos bautizos con claves int
    bautizos_int = {}
    for k, v in bautizos_original.items():
        try:
            bautizos_int[int(k)] = v
        except (ValueError, TypeError):
            bautizos_int[k] = v

    print(f"\n--- Dedup semántico ({len(bautizos_int)} clusters) ---")
    bautizos_limpios, merge_map = await semantic_utils.dedup_semantico(
        bautizos_int, labels, ids_hecho, None, OLLAMA_URL, QWEN_MODEL)

    if not merge_map:
        print("No se encontraron clusters redundantes que fusionar.")
        bautizos_limpios = dict(bautizos_int)

    # ── Fase 2: Re-asignar ──────────────────────────────────
    nuevas_asignaciones = {}
    for hid, cid in asignaciones.items():
        cid_final = merge_map.get(cid, cid)
        if cid_final in bautizos_limpios:
            nuevas_asignaciones[hid] = cid_final

    # Filtrar labels solo a clusters que sobreviven
    bautizos_final = {str(k): v for k, v in bautizos_limpios.items()}
    payload = {"labels": bautizos_final, "assignments": nuevas_asignaciones}

    print(f"\nResultado dedup: {len(bautizos_original)} → {len(bautizos_final)} clusters")

    # ── Fase 3: Meta-clustering semántico ───────────────────
    print("\n--- Meta-clustering semántico ---")
    # Reconstruir labels array con merge_map aplicado
    new_labels_list = []
    for hid in ids_hecho:
        cid = asignaciones.get(hid)
        cid_final = merge_map.get(cid, cid)
        if cid_final in bautizos_limpios:
            new_labels_list.append(cid_final)
        else:
            new_labels_list.append(-1)
    new_labels = np.array(new_labels_list, dtype=np.int32)

    if len(bautizos_limpios) >= 2:
        meta_labels, meta_assignments, cluster_to_meta = \
            await semantic_utils.meta_clustering_semantico(
                bautizos_limpios, new_labels, ids_hecho,
                None, OLLAMA_URL, QWEN_MODEL)
        payload["meta_labels"] = meta_labels
        payload["meta_assignments"] = meta_assignments
        payload["cluster_to_meta"] = {str(k): v for k, v in cluster_to_meta.items()}
        print(f"Meta-hábitos: {len(meta_labels)}")

    # ── Backup del archivo original ──────────────────────────
    backup = CLUSTER_LABELS_FILE + BACKUP_SUFFIX
    with open(backup, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    print(f"Backup guardado: {backup}")

    # ── Guardar resultado ────────────────────────────────────
    with open(CLUSTER_LABELS_FILE, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)

    print(f"\nGuardado: {CLUSTER_LABELS_FILE}")
    print(f"  Clusters: {len(bautizos_original)} → {len(bautizos_final)}")
    print(f"  Asignaciones: {len(asignaciones)} → {len(nuevas_asignaciones)}")
    print(f"  Meta-hábitos: {len(data.get('meta_labels', {}))} → {len(payload.get('meta_labels', {}))}")

    # Mostrar nuevos nombres
    print("\nNuevos clusters:")
    new_sizes = Counter(nuevas_asignaciones.values())
    for cid in sorted(bautizos_limpios.keys()):
        print(f"  cluster_{cid}: {new_sizes.get(cid, 0)} obs → '{bautizos_limpios[cid]}'")


asyncio.run(main())
