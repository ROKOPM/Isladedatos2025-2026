# ISLA de Datos Urbanos 2025-2026

Plataforma de analitica urbana para captura, procesamiento semantico, monitoreo ambiental y visualizacion de patrones de comportamiento. El despliegue usa Docker Compose, imagenes propias publicadas en GitHub Container Registry (GHCR) y un instalador `setup.sh`.

## Componentes

- `nginx`: sirve el frontend React y proxya `/api/` hacia Django.
- `django`: API principal del dashboard.
- `webservice`: capa de captura/procesamiento bronze.
- `davis_poller`: ingesta de datos ambientales desde Davis WeatherLink.
- `qwen_worker`: enriquecimiento semantico con Qwen via Ollama.
- `habits_worker`: vectorizacion, clustering y estado de habitos.
- `postgres`: PostgreSQL con pgvector.
- `ollama`: runtime local para modelos LLaVA y Qwen.

## Imagenes

Imagenes propias en GHCR:

```text
ghcr.io/rokopm/isla-webservice:latest
ghcr.io/rokopm/isla-django:latest
ghcr.io/rokopm/isla-qwen-worker:latest
ghcr.io/rokopm/isla-habits-worker:latest
ghcr.io/rokopm/isla-davis-poller:latest
ghcr.io/rokopm/isla-nginx:latest
```

Imagenes externas:

```text
pgvector/pgvector:pg16
ollama/ollama:latest
```

## Instalacion Rapida

Si las imagenes GHCR son publicas:

```bash
curl -fsSL https://raw.githubusercontent.com/ROKOPM/Isladedatos2025-2026/main/setup.sh | bash
```

Si las imagenes GHCR son privadas, primero inicia sesion:

```bash
echo TU_TOKEN | docker login ghcr.io -u ROKOPM --password-stdin
curl -fsSL https://raw.githubusercontent.com/ROKOPM/Isladedatos2025-2026/main/setup.sh | bash
```

El token para instalacion privada necesita `read:packages`.

## Requisitos

- Docker
- Docker Compose v2
- Git
- GPU NVIDIA con runtime Docker NVIDIA para usar Ollama con GPU
- Recomendado: 16 GB RAM minimo
- Recomendado: 50 GB libres o mas

## Configuracion

El instalador crea un `.env` local desde `.env.template` y solicita:

- `DAVIS_API_KEY`
- `DAVIS_API_SECRET`
- `DAVIS_STATION_ID`

El archivo `.env` no debe subirse al repositorio.

Variables frecuentes:

```text
GHCR_OWNER=rokopm
IMAGE_TAG=latest
HTTP_PORT=80
WEBSERVICE_BIND=127.0.0.1
NVIDIA_DEVICE_ID=0
```

## Uso

Abrir:

```text
http://localhost
```

Comandos utiles:

```bash
docker compose ps
docker compose logs -f nginx
docker compose logs -f django
docker compose logs -f habits_worker
docker compose up -d
docker compose down
```

## Publicar Imagenes

Iniciar sesion en GHCR con un token que tenga `write:packages` y `read:packages`:

```bash
echo TU_TOKEN | docker login ghcr.io -u ROKOPM --password-stdin
```

Construir y publicar `latest`:

```bash
GHCR_OWNER=rokopm bash build-and-push.sh latest
```

Publicar una version:

```bash
GHCR_OWNER=rokopm bash build-and-push.sh v1.0.0
```

## Validacion

```bash
bash -n setup.sh
bash -n build-and-push.sh
docker compose config
docker compose build nginx
docker compose build django habits_worker qwen_worker davis_poller webservice
curl -I http://localhost
```

Resultado esperado:

```text
HTTP/1.1 200 OK
```

## Seguridad y Datos

No subir:

- `.env`
- tokens o API keys
- Davis API keys reales
- dumps SQL
- backups
- datos crudos
- volumenes Docker
- modelos Ollama
- `node_modules`
- builds `dist`

Los `requirements.txt` si se versionan porque son necesarios para construir las imagenes Docker.
