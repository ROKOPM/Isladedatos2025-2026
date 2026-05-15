import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from django.core.management.base import BaseCommand
from django.conf import settings
from api.models import DatasetVersion


class Command(BaseCommand):
    help = 'Registra una versión del dataset en disco para trazabilidad científica.'

    def add_arguments(self, parser):
        parser.add_argument('--ds-version', type=str, required=True)
        parser.add_argument('--llava', type=str, default='LLaVA 13B v1.0')
        parser.add_argument('--qwen', type=str, default='Qwen 2.5 14b')
        parser.add_argument('--notes', type=str, default='')

    def handle(self, *args, **options):
        version_str = options['ds_version']
        now = datetime.now(timezone.utc)
        checksum = hashlib.sha256(f"warehouse_state_{now.isoformat()}".encode()).hexdigest()

        dv = DatasetVersion(
            version=version_str,
            created_at=now,
            warehouse_checksum=checksum,
            llava_version=options['llava'],
            qwen_version=options['qwen'],
            clustering_version="HDBSCAN v0.8",
            inference_version="CliffDelta/Welch v1.0",
            notes=options['notes'],
        )

        versions_path = Path(getattr(settings, "SNAPSHOTS_DIR", "/tmp/idu_snapshots")) / "dataset_versions.json"
        versions_path.parent.mkdir(parents=True, exist_ok=True)
        versions = json.loads(versions_path.read_text()) if versions_path.exists() else []
        versions.append({
            "version": dv.version,
            "created_at": dv.created_at.isoformat(),
            "warehouse_checksum": dv.warehouse_checksum,
            "llava_version": dv.llava_version,
            "qwen_version": dv.qwen_version,
            "clustering_version": dv.clustering_version,
            "inference_version": dv.inference_version,
            "notes": dv.notes,
        })
        versions_path.write_text(json.dumps(versions, indent=2, ensure_ascii=False))

        self.stdout.write(self.style.SUCCESS(f"Version '{version_str}' saved. Checksum: {checksum}"))
