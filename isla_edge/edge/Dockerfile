# edge/Dockerfile
FROM python:3.11-slim-bookworm

# Dependencias del sistema para OpenCV y V4L2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    v4l-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=300 --retries=5 -r requirements.txt

# Descargar modelo YOLO al construir la imagen (no en runtime)
# [FIX-YOLO] yolo11s.pt — 9.4M params, 2.5x mas rapido que yolov8m en CPU
# con recall de personas comparable. Requiere ultralytics>=8.3.0
RUN python -c "from ultralytics import YOLO; YOLO('yolo11s.pt')"

COPY . .

# Crear directorio de snapshots (para pruebas locales)
RUN mkdir -p static/snapshots /mnt/memoria/photos

EXPOSE 5000

CMD ["/bin/bash", "-c", "python -u server.py 2> >(grep -v 'NNPACK' >&2)"]
