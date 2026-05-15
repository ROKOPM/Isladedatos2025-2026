from datetime import datetime, timezone
import hashlib
import json

class MetadataGenerator:
    """
    Scientific Governance Layer
    Generates deterministic metadata for all inferential queries to ensure reproducibility.
    """

    @staticmethod
    def generate_query_hash(filters: dict, dataset_version: str) -> str:
        # Sort keys to guarantee deterministic hash
        encoded = json.dumps({"filters": filters, "version": dataset_version}, sort_keys=True).encode()
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def generate_governance_warnings(sample_size: int, variance: float, academic_context: str) -> list:
        warnings = []
        if sample_size < 5:
            warnings.append("Muestra estadísticamente insuficiente. Inferencia bloqueada.")
        elif sample_size < 30:
            warnings.append("Muestra estadísticamente limitada. Alto margen de error.")

        if variance and variance > 1.5:  # Arbitrary threshold for demo purposes
            warnings.append("Distribución altamente dispersa. Baja estabilidad conductual.")

        if academic_context in ['midterms', 'finals', 'projects', 'partial_exams']:
            warnings.append(f"Periodo evaluado incluye eventos académicos de alta presión ({academic_context}).")

        # Mandatory disclaimer
        warnings.append("Las asociaciones observadas son correlacionales y no implican causalidad algorítmica.")
        return warnings

    @classmethod
    def generate_metadata(cls, filters: dict, sample_size: int, variance: float = 0.0, academic_context: str = 'normal') -> dict:
        dataset_version = "v1.0.0" # Mocked, eventually fetched from DB
        
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "dataset_version": dataset_version,
            "pipeline_version": "1.0",
            "inference_version": "1.0",
            "query_hash": cls.generate_query_hash(filters, dataset_version),
            "sample_size": sample_size,
            "academic_context": academic_context,
            "warnings": cls.generate_governance_warnings(sample_size, variance, academic_context),
            "governance": {
                "causality_warning": True,
                "low_sample_warning": sample_size < 30,
                "high_variance_warning": variance > 1.5
            }
        }
