# ISLA de Datos Urbanos 2025-2026

Repositorio principal del proyecto **ISLA de Datos Urbanos 2025-2026**, una plataforma de análisis urbano basada en visión computacional, inteligencia artificial y analítica ambiental para el estudio de dinámicas sociales en espacios públicos.

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

Si también necesitas el nodo de captura con cámara USB o RTSP, instala el edge desde:

```text
https://github.com/ROKOPM/isla-edge-installer
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

# Nodo de Captura Edge

Este repositorio instala el procesamiento central: base de datos, LLaVA/Qwen, workers, API y dashboard.

Para capturar imágenes desde una cámara física se usa el repositorio complementario:

```text
https://github.com/ROKOPM/isla-edge-installer
```

El nodo `isla-edge` puede correr en la misma PC que este pipeline o en otra PC con cámara, siempre que pueda alcanzar el endpoint del servidor central:

```text
http://IP_DEL_SERVIDOR:8001/llava/
```

Instalación rápida del edge:

```bash
curl -fsSL https://raw.githubusercontent.com/ROKOPM/isla-edge-installer/main/setup.sh | bash
```

Usa este repositorio para el pipeline completo y `isla-edge-installer` para la captura física.

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

# Instalación

Instalación rápida del pipeline central:

```bash
curl -fsSL https://raw.githubusercontent.com/ROKOPM/Isladedatos2025-2026/main/setup.sh | bash
```

Si usas el instalador público separado del pipeline central:

```bash
curl -fsSL https://raw.githubusercontent.com/ROKOPM/isla-installer/main/setup.sh | bash
```
