import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "cambia-esto-en-produccion")
DEBUG = os.environ.get("DJANGO_DEBUG", "False") == "True"

ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost").split(",")

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "isla.urls"
WSGI_APPLICATION = "isla.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "HOST": os.environ.get("DB_HOST", "isla_postgres"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "NAME": os.environ.get("DB_NAME", "postgres"),
        "USER": os.environ.get("DB_USER", "postgres"),
        "PASSWORD": os.environ.get("DB_PASS", "postgres"),
    }
}

STATIC_URL = "/static/"

# Cache en disco — sin consumo de RAM, compartido entre workers de gunicorn
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
        "LOCATION": "/tmp/idu_api_cache",
        "TIMEOUT": 300,          # 5 min por defecto
        "OPTIONS": {
            "MAX_ENTRIES": 800,  # máx. entradas antes de culling (~50 MB aprox.)
        },
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SNAPSHOTS_DIR = "/tmp/idu_snapshots"

USE_TZ = True
TIME_ZONE = "America/Mexico_City"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
}

CORS_ALLOW_ALL_ORIGINS = DEBUG

ALERTA_UMBRAL_FUMADO    = float(os.environ.get("ALERTA_UMBRAL_FUMADO",    "20"))
ALERTA_UMBRAL_PM10      = float(os.environ.get("ALERTA_UMBRAL_PM10",      "54"))
CONFIANZA_UMBRAL_FUMADO = float(os.environ.get("CONFIANZA_FUMADO_UMBRAL", "0.60"))
API_KEY                 = os.environ.get("API_KEY", "")

CLUSTER_STATE_DIR = os.environ.get("CLUSTER_STATE_DIR", "/app/habitos_state")
CLUSTER_LABELS_FILE = os.path.join(CLUSTER_STATE_DIR, "cluster_labels.json")
CLUSTER_STATUS_FILE = os.path.join(CLUSTER_STATE_DIR, "cluster_job_status.json")
CLUSTER_RECOMPUTE_REQUESTS_FILE = os.path.join(CLUSTER_STATE_DIR, "cluster_recompute_requests.jsonl")
