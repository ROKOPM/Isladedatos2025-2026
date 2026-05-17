# ISLA de Datos Urbanos 2025-2026 - Codigo Fuente

Repositorio principal de codigo fuente del proyecto **ISLA de Datos Urbanos 2025-2026**, una plataforma de analisis urbano basada en vision computacional, inteligencia artificial y analitica ambiental para el estudio de dinamicas sociales en espacios publicos.

Este repositorio contiene el pipeline central completo:

- backend y APIs
- frontend y dashboard interactivo
- pipelines ETL
- workers semánticos
- clustering conductual
- integración con modelos multimodales
- procesamiento ambiental
- almacenamiento vectorial
- infraestructura Docker
- herramientas de minería y análisis de hábitos
- codigo del nodo edge de captura en `isla_edge/`

Este repo es para desarrollo, auditoria y explicacion tecnica del proyecto. Para instalar el sistema en una maquina final usa los instaladores publicos:

```text
Pipeline central: https://github.com/ROKOPM/isla-installer
Nodo de captura: https://github.com/ROKOPM/isla-edge-installer
```

---

# Objetivo del Proyecto

El proyecto busca construir una plataforma capaz de transformar observaciones urbanas no estructuradas en conocimiento analítico útil mediante:

- visión computacional
- modelos multimodales
- embeddings semánticos
- clustering conductual
- análisis temporal
- monitoreo ambiental
- minería de datos urbanos

La arquitectura permite detectar y analizar patrones sociales, hábitos colectivos y dinámicas de uso en espacios públicos a partir de imágenes, sensores y contexto ambiental.

---

# Líneas Principales de Investigación

## Análisis Conductual Urbano

Identificación automática de:

- hábitos de consumo
- comportamientos grupales
- dinámicas sociales
- patrones temporales
- zonas de concentración
- perfiles conductuales

---

## Procesamiento Multimodal

Integración de:

- imágenes
- texto
- embeddings
- metadatos ambientales
- contexto temporal

mediante modelos como:

- Qwen
- LLaVA
- Ollama
- modelos vectoriales

---

## Analítica Ambiental

Captura y correlación de:

- temperatura
- humedad
- calidad ambiental
- clima
- temporalidad académica

para estudiar relaciones entre entorno y comportamiento humano.

---

## Visualización y Exploración de Datos

El sistema incorpora dashboards interactivos orientados a:

- exploración semántica
- visualización de clusters
- análisis temporal
- patrones de actividad
- comportamiento social
- reproducibilidad analítica

---

# Arquitectura General

La plataforma se compone de múltiples servicios desacoplados:

- frontend React servido por NGINX
- backend Django
- procesamiento ETL
- workers semánticos
- pipelines de embeddings
- PostgreSQL + pgvector
- inferencia local mediante Ollama
- servicios de monitoreo ambiental
- nodo edge opcional para captura distribuida

Todo el sistema opera mediante contenedores Docker y procesamiento distribuido.

---

# Codigo del Nodo de Captura Edge

El codigo del nodo de captura vive dentro de este repositorio en:

```text
isla_edge/
```

Incluye:

- `isla_edge/edge/server.py`: servidor Flask/SocketIO de captura.
- `isla_edge/edge/Dockerfile`: imagen Docker del nodo edge.
- `isla_edge/edge/requirements.txt`: dependencias Python.
- `isla_edge/edge/templates/index.html`: interfaz local del nodo.
- `isla_edge/docker-compose.yml`: compose de referencia para desarrollo.
- `isla_edge/.env.template`: plantilla sin secretos.

No se incluyen llaves, modelos entrenados, `.env`, capturas ni casos dificiles.

Para instalar el nodo edge en una maquina con camara fisica se usa el instalador complementario:

```text
https://github.com/ROKOPM/isla-edge-installer
```

El nodo `isla-edge` puede correr en la misma PC que este pipeline o en otra PC con cámara, siempre que pueda alcanzar el endpoint del servidor central:

```text
http://IP_DEL_SERVIDOR:8001/llava/
```

Instalacion rapida del edge:

```bash
curl -fsSL https://raw.githubusercontent.com/ROKOPM/isla-edge-installer/main/setup.sh | bash
```

Usa este repositorio para revisar o modificar el codigo. Usa `isla-installer` y `isla-edge-installer` para instalar.

---

# Estado del Proyecto

El sistema actualmente implementa:

- pipelines automatizados de captura y procesamiento
- clustering semántico de hábitos
- embeddings vectoriales
- dashboards analíticos
- correlaciones ambientales
- visualización temporal avanzada
- workers multimodales
- despliegue mediante Docker Compose
- distribución mediante imágenes GHCR

---

# Instaladores

Pipeline central:

```bash
https://github.com/ROKOPM/isla-installer
```

Nodo de captura:

```text
https://github.com/ROKOPM/isla-edge-installer
```
