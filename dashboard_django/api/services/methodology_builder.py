"""
Methodology Builder
Automatically generates publication-ready methodology text for thesis, papers, and scientific reports.

NO corporate language. NO prediction language. Strictly observational and correlational.
"""
import json
import os
import hashlib

CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'config', 'scientific_config.json')


def _load_config():
    try:
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def _config_checksum():
    try:
        with open(CONFIG_PATH, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()
    except FileNotFoundError:
        return 'config_not_found'


class MethodologyBuilder:
    """
    Generates deterministic methodology text from the immutable scientific config
    and current query parameters.
    """

    def __init__(self, filters: dict, sample_size: int, academic_context: str = 'normal'):
        self.config = _load_config()
        self.filters = filters
        self.sample_size = sample_size
        self.academic_context = academic_context
        self.inf = self.config.get('inference', {})
        self.ds = self.config.get('dataset', {})

    def build(self) -> dict:
        alpha = self.inf.get('alpha', 0.05)
        method = self.inf.get('test_method', 'welch_heuristic')
        effect = self.inf.get('effect_size_metric', 'cliffs_delta')
        conf = self.inf.get('confidence_level', 0.95)

        methodology_text = (
            f"Se empleó un diseño observacional transversal sobre datos recolectados por la plataforma "
            f"Isla de Datos Urbanos (ESCOM-IPN). Las imágenes de cámaras IP fueron procesadas por "
            f"{self.ds.get('llava_version', 'LLaVA 13B')} para descripción visual y "
            f"{self.ds.get('qwen_version', 'Qwen 2.5 14b')} para extracción estructurada. "
            f"La detección de personas se realizó mediante YOLO con validación cruzada multimodelo. "
            f"El tamaño de la muestra analizada fue N={self.sample_size:,}. "
            f"Se utilizó la prueba de {method} con nivel de significancia α={alpha} "
            f"y el tamaño del efecto se cuantificó mediante {effect}. "
            f"Los intervalos de confianza se calcularon al {conf*100:.0f}%. "
            f"El contexto académico dominante fue clasificado como '{self.academic_context}'. "
            f"Todas las métricas fueron computadas en el frontend para permitir exploración interactiva. "
            f"Versión del motor inferencial: v{self.ds.get('inference_engine_version', '1.0')}."
        )

        limitations = [
            "Las asociaciones reportadas son estrictamente correlacionales. Coincidencia temporal no implica causalidad.",
            "La precisión depende de la calidad de los sensores (cámaras IP) y modelos de visión por computadora.",
            "Los resultados son sensibles al tamaño de la muestra y la cobertura temporal del periodo seleccionado.",
            "El sistema no realiza perfilamiento individual. Todas las métricas son agregadas y anonimizadas.",
            "Los modelos de lenguaje (LLaVA, Qwen) pueden introducir sesgo en la clasificación de actividades.",
        ]

        governance_notes = [
            self.config.get('governance', {}).get('causality_disclaimer', ''),
            self.config.get('governance', {}).get('ethics_disclaimer', ''),
        ]

        return {
            "methodology_text": methodology_text,
            "limitations": limitations,
            "governance_notes": [n for n in governance_notes if n],
            "config_checksum": _config_checksum(),
            "config_version": self.config.get('version', 'unknown')
        }
