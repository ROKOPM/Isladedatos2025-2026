FROM python:3.11-slim-bookworm

WORKDIR /app

# Dependencias del sistema para compilar hdbscan / umap
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ build-essential libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=300 --retries=5 -r requirements.txt

COPY habits_worker.py .
COPY semantic_utils.py .

CMD ["python", "-u", "habits_worker.py"]
