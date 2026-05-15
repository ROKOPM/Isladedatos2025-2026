#!/usr/bin/env bash
set -Eeuo pipefail

DEFAULT_REPO_URL="${ISLA_REPO_URL:-https://github.com/ROKOPM/Isladedatos2025-2026.git}"
DEFAULT_INSTALL_DIR="${ISLA_INSTALL_DIR:-$HOME/Isladedatos2025-2026}"

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: falta '$1'." >&2
    exit 1
  fi
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -d '\n'
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

prompt() {
  local label="$1"
  local default="${2:-}"
  local value
  local input="/dev/stdin"
  if [[ -r /dev/tty ]]; then
    input="/dev/tty"
  fi
  if [[ -n "$default" ]]; then
    read -r -p "${label} [${default}]: " value <"$input"
    echo "${value:-$default}"
  else
    read -r -p "${label}: " value <"$input"
    echo "$value"
  fi
}

replace_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"
  sed -i "s/^${key}=.*/${key}=${escaped}/" .env
}

need_command docker
need_command git

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose v2 no esta disponible. Instala el plugin 'docker compose'." >&2
  exit 1
fi

mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
disk_kb="$(df -Pk . | awk 'NR==2 {print $4}')"
if (( mem_kb > 0 && mem_kb < 16000000 )); then
  echo "Aviso: se detectaron menos de 16 GB de RAM. Los modelos locales pueden no funcionar bien."
fi
if (( disk_kb > 0 && disk_kb < 50000000 )); then
  echo "Aviso: se detectaron menos de 50 GB libres. Ollama y las imagenes pueden necesitar mas espacio."
fi
if ! docker info 2>/dev/null | grep -qi nvidia; then
  echo "Aviso: no se detecto runtime NVIDIA en Docker. El servicio Ollama usa GPU NVIDIA."
fi

repo_url="$(prompt "Repositorio Git" "$DEFAULT_REPO_URL")"
install_dir="$(prompt "Directorio de instalacion" "$DEFAULT_INSTALL_DIR")"

if [[ "$repo_url" == *"TU_USUARIO"* ]]; then
  echo "Error: edita la URL del repositorio o define ISLA_REPO_URL antes de ejecutar setup.sh." >&2
  exit 1
fi

if [[ -d "$install_dir/.git" ]]; then
  git -C "$install_dir" pull --ff-only
else
  git clone "$repo_url" "$install_dir"
fi

cd "$install_dir"

if [[ ! -f .env ]]; then
  cp .env.template .env
fi

repo_owner="$(printf '%s' "$repo_url" | sed -E 's#^git@github.com:([^/]+)/.*#\1#; s#^https://github.com/([^/]+)/.*#\1#' | tr '[:upper:]' '[:lower:]')"
replace_env GHCR_OWNER "$repo_owner"
replace_env IMAGE_TAG "${IMAGE_TAG:-latest}"
replace_env DJANGO_SECRET_KEY "$(random_secret)"

davis_key="$(prompt "Davis API key" "$(grep -E '^DAVIS_API_KEY=' .env | cut -d= -f2-)")"
davis_secret="$(prompt "Davis API secret" "$(grep -E '^DAVIS_API_SECRET=' .env | cut -d= -f2-)")"
davis_station="$(prompt "Davis station ID" "$(grep -E '^DAVIS_STATION_ID=' .env | cut -d= -f2-)")"

if [[ -z "$davis_key" || -z "$davis_secret" || -z "$davis_station" ]]; then
  echo "Error: Davis API key, secret y station ID son obligatorios." >&2
  exit 1
fi

replace_env DAVIS_API_KEY "$davis_key"
replace_env DAVIS_API_SECRET "$davis_secret"
replace_env DAVIS_STATION_ID "$davis_station"

docker volume create "$(grep -E '^POSTGRES_VOLUME=' .env | cut -d= -f2-)" >/dev/null

docker compose pull
docker compose up -d

echo
echo "ISLA de Datos Urbanos esta levantando."
echo "Abre: http://localhost"
echo
echo "Comandos utiles:"
echo "  docker compose ps"
echo "  docker compose logs -f nginx"
echo "  docker compose logs -f django"
echo "  docker compose logs -f habits_worker"
echo "  docker compose up -d"
echo "  docker compose down"
