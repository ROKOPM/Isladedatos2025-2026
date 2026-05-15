"""
Scientific Response Middleware
Automatically injects governance metadata, dataset versioning, and lineage into every analytical response.

This ensures NO analytical endpoint ever returns raw JSON without scientific context.
"""
import hashlib
import json
import time
from datetime import datetime, timezone
from django.conf import settings
from api.utils.metadata import MetadataGenerator


class ScientificResponseMiddleware:
    """
    Intercepts DRF responses on analytical endpoints and wraps them with
    reproducibility metadata: dataset_version, query_hash, warnings, governance flags.
    """

    ANALYTICAL_PREFIXES = [
        '/api/kpis',
        '/api/eventos-hora',
        '/api/top-actividades',
        '/api/heatmap',
        '/api/clusters',
        '/api/firma-temporal',
        '/api/patrones-raw',
        '/api/tendencias',
        '/api/calidad-aire',
        '/api/duracion-habitos',
        '/api/contexto-social',
    ]

    EXCLUDED_PREFIXES = [
        '/api/health',
        '/api/filtros',
        '/api/sistema',
        '/api/snapshots',
        '/api/scientific-report',
        '/api/export-csv',
        '/api/export-pdf',
    ]

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.monotonic()
        response = self.get_response(request)
        duration_ms = int((time.monotonic() - start) * 1000)

        path = request.path.rstrip('/')
        if not self._is_analytical(path):
            return response

        if not hasattr(response, 'data') or not isinstance(response.data, dict):
            return response

        # Do not double-wrap if metadata already present
        if 'metadata' in response.data:
            return response

        filters = dict(request.GET)
        raw_data = response.data.get('data', response.data)
        sample_size = len(raw_data) if isinstance(raw_data, list) else 0

        metadata = MetadataGenerator.generate_metadata(
            filters=filters,
            sample_size=sample_size,
        )
        metadata['duration_ms'] = duration_ms
        metadata['endpoint'] = path
        metadata['lineage'] = {
            'source': 'postgresql/warehouse',
            'pipeline': 'bronze→silver→gold',
            'models': ['LLaVA 13B', 'Qwen 2.5 14b', 'YOLO'],
            'aggregation': 'frontend-driven'
        }

        # Re-wrap response
        if 'data' not in response.data:
            response.data = {'data': response.data, 'metadata': metadata}
        else:
            response.data['metadata'] = metadata

        # Patch rendered content if already rendered
        if hasattr(response, '_is_rendered') and response._is_rendered:
            response.content = json.dumps(response.data).encode('utf-8')

        return response

    def _is_analytical(self, path: str) -> bool:
        for exc in self.EXCLUDED_PREFIXES:
            if path.startswith(exc):
                return False
        for prefix in self.ANALYTICAL_PREFIXES:
            if path.startswith(prefix):
                return True
        return False
