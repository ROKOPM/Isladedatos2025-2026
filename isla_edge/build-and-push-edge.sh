#!/usr/bin/env bash
set -Eeuo pipefail

TAG="${1:-latest}"
OWNER="${GHCR_OWNER:-}"

if [[ -z "$OWNER" && -f .env ]]; then
  OWNER="$(grep -E '^GHCR_OWNER=' .env | tail -n1 | cut -d= -f2- || true)"
fi

OWNER="$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')"

if [[ -z "$OWNER" || "$OWNER" == "TU_USUARIO" || "$OWNER" == "tu_usuario" ]]; then
  echo "Error: define GHCR_OWNER con tu usuario u organizacion de GitHub." >&2
  echo "Ejemplo: GHCR_OWNER=rokopm bash build-and-push-edge.sh ${TAG}" >&2
  exit 1
fi

export GHCR_OWNER="$OWNER"
export IMAGE_TAG="$TAG"

echo "Construyendo imagen edge ghcr.io/${GHCR_OWNER}/isla-edge:${IMAGE_TAG}"
docker compose build edge

echo "Subiendo imagen edge a GHCR"
docker compose push edge

echo "Listo."
