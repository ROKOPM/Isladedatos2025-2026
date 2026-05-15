# ISLA de Datos Urbanos 2025-2026

Repositorio principal y privado del proyecto **ISLA de Datos Urbanos 2025-2026**, una plataforma de análisis urbano basada en visión computacional, inteligencia artificial y analítica ambiental para el estudio de dinámicas sociales en espacios públicos.

Este repositorio contiene el núcleo completo del sistema:

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

Todo el sistema opera mediante contenedores Docker y procesamiento distribuido.

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

Este repositorio es privado y contiene el código fuente completo del sistema.

Si deseas instalar y ejecutar la plataforma mediante imágenes Docker públicas, utiliza el instalador oficial:

👉 [ISLA Installer Repository](https://github.com/ROKOPM/isla-installer?utm_source=chatgpt.com)

Instalación rápida:

```bash
curl -fsSL https://raw.githubusercontent.com/ROKOPM/isla-installer/main/setup.sh | bash
