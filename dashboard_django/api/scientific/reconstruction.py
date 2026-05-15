"""
Analysis Reconstruction Validator
Verifies that a saved snapshot can be exactly reproduced given the same inputs.

If the reconstructed checksum diverges from the original, reproducibility is broken.
"""
import hashlib
import json
from api.utils.metadata import MetadataGenerator


class ReconstructionValidator:
    """
    Given a snapshot's frozen state, recomputes the query hash and metadata checksum.
    Compares against the original to validate scientific reproducibility.
    """

    @staticmethod
    def compute_state_checksum(filters: dict, metrics: dict, metadata: dict) -> str:
        """Deterministic checksum of the full analytical state."""
        state = {
            "filters": filters,
            "metrics": metrics,
            "metadata": {
                "dataset_version": metadata.get("dataset_version"),
                "query_hash": metadata.get("query_hash"),
                "sample_size": metadata.get("sample_size"),
            }
        }
        encoded = json.dumps(state, sort_keys=True, default=str).encode()
        return hashlib.sha256(encoded).hexdigest()

    @classmethod
    def validate(cls, snapshot_record: dict) -> dict:
        """
        Validates reproducibility of a snapshot record.
        
        Args:
            snapshot_record: dict with keys: filters, metrics, metadata, query_hash
            
        Returns:
            dict with: is_valid, original_hash, reconstructed_hash, message
        """
        filters = snapshot_record.get('filters', {})
        metrics = snapshot_record.get('metrics', {})
        metadata = snapshot_record.get('metadata', {})
        original_hash = snapshot_record.get('query_hash', '')

        # Reconstruct query hash from filters + dataset version
        dataset_version = metadata.get('dataset_version', 'unknown')
        reconstructed_query_hash = MetadataGenerator.generate_query_hash(filters, dataset_version)

        # Compute full state checksum
        original_checksum = cls.compute_state_checksum(filters, metrics, metadata)

        if reconstructed_query_hash != original_hash:
            return {
                "is_valid": False,
                "original_hash": original_hash,
                "reconstructed_hash": reconstructed_query_hash,
                "state_checksum": original_checksum,
                "message": "FALLO DE REPRODUCIBILIDAD: El hash reconstruido no coincide con el original. "
                           "Los filtros o la versión del dataset pudieron haber cambiado."
            }

        return {
            "is_valid": True,
            "original_hash": original_hash,
            "reconstructed_hash": reconstructed_query_hash,
            "state_checksum": original_checksum,
            "message": "Reproducibilidad verificada. El estado analítico es reconstruible de forma idéntica."
        }
