import uuid as _uuid_mod
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from django.conf import settings


# ── Ruta de almacenamiento en disco (sin tocar la BD) ────────
_SNAPSHOTS_DIR = Path(getattr(settings, "SNAPSHOTS_DIR", "/tmp/idu_snapshots"))


def _snapshots_dir() -> Path:
    _SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    return _SNAPSHOTS_DIR


class AnalysisSnapshot:
    """
    Almacena análisis reproducibles en archivos JSON en disco.
    No usa la base de datos — los datos operacionales no se tocan.
    """

    def __init__(self, **kwargs):
        self.uuid            = kwargs.get("uuid", str(_uuid_mod.uuid4()))
        self.created_at      = kwargs.get("created_at", datetime.now(timezone.utc))
        self.filters_json    = kwargs.get("filters_json", {})
        self.computed_metrics_json = kwargs.get("computed_metrics_json", {})
        self.metadata_json   = kwargs.get("metadata_json", {})
        self.academic_context_summary = kwargs.get("academic_context_summary", {})
        self.visualization_state = kwargs.get("visualization_state", {})
        self.user_notes      = kwargs.get("user_notes", "")
        self.query_hash      = kwargs.get("query_hash", "")
        self.pipeline_version   = kwargs.get("pipeline_version", "1.0")
        self.inference_version  = kwargs.get("inference_version", "1.0")

    def _path(self) -> Path:
        return _snapshots_dir() / f"{self.uuid}.json"

    def save(self):
        data = {
            "uuid":                    self.uuid,
            "created_at":              self.created_at.isoformat(),
            "filters_json":            self.filters_json,
            "computed_metrics_json":   self.computed_metrics_json,
            "metadata_json":           self.metadata_json,
            "academic_context_summary": self.academic_context_summary,
            "visualization_state":     self.visualization_state,
            "user_notes":              self.user_notes,
            "query_hash":              self.query_hash,
            "pipeline_version":        self.pipeline_version,
            "inference_version":       self.inference_version,
        }
        self._path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return self

    @classmethod
    def create(cls, **kwargs):
        obj = cls(**kwargs)
        obj.save()
        return obj

    @classmethod
    def get(cls, uuid):
        path = _snapshots_dir() / f"{uuid}.json"
        if not path.exists():
            raise FileNotFoundError(uuid)
        data = json.loads(path.read_text(encoding="utf-8"))
        data["created_at"] = datetime.fromisoformat(data["created_at"])
        return cls(**data)

    @classmethod
    def all_ordered(cls, limit=50):
        files = sorted(_snapshots_dir().glob("*.json"), key=os.path.getmtime, reverse=True)
        results = []
        for f in files[:limit]:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                data["created_at"] = datetime.fromisoformat(data["created_at"])
                results.append(cls(**data))
            except Exception:
                continue
        return results


class DatasetVersion:
    """Versión de dataset — almacenada en disco, no en BD."""

    def __init__(self, **kwargs):
        self.version             = kwargs.get("version", "")
        self.created_at          = kwargs.get("created_at", datetime.now(timezone.utc))
        self.warehouse_checksum  = kwargs.get("warehouse_checksum")
        self.llava_version       = kwargs.get("llava_version")
        self.qwen_version        = kwargs.get("qwen_version")
        self.clustering_version  = kwargs.get("clustering_version")
        self.inference_version   = kwargs.get("inference_version")
        self.notes               = kwargs.get("notes")

    def __str__(self):
        return f"{self.version} ({self.created_at.date() if hasattr(self.created_at,'date') else self.created_at})"
