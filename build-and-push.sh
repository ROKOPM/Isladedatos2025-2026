#!/usr/bin/env bash
set -Eeuo pipefail

TAG="${1:-latest}"
OWNER="${GHCR_OWNER:-}"

if [[ -z "$OWNER" ]]; then
  if [[ -f .env ]]; then
    OWNER="$(grep -E '^GHCR_OWNER=' .env | tail -n1 | cut -d= -f2- || true)"
  fi
fi

if [[ -z "$OWNER" || "$OWNER" == "TU_USUARIO" || "$OWNER" == "tu_usuario" ]]; then
  echo "Error: define GHCR_OWNER con tu usuario u organizacion de GitHub." >&2
  echo "Ejemplo: GHCR_OWNER=miusuario bash build-and-push.sh ${TAG}" >&2
  exit 1
fi

export GHCR_OWNER="$OWNER"
export IMAGE_TAG="$TAG"

echo "Construyendo imagenes GHCR para ${GHCR_OWNER}:${IMAGE_TAG}"
docker compose build webservice django qwen_worker habits_worker davis_poller nginx

echo "Subiendo imagenes a ghcr.io/${GHCR_OWNER}"
docker compose push webservice django qwen_worker habits_worker davis_poller nginx

echo "Listo."
