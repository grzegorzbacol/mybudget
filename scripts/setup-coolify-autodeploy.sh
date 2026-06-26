#!/usr/bin/env bash
set -euo pipefail

COOLIFY_URL="${COOLIFY_URL:-http://51.38.132.184:8000}"
COOLIFY_APP_UUID="${COOLIFY_APP_UUID:-zso000wkg0gokc8040cc8cw8}"
GITHUB_REPO="${GITHUB_REPO:-grzegorzbacol/mybudget}"

if [ -z "${COOLIFY_TOKEN:-}" ]; then
  echo "Ustaw COOLIFY_TOKEN (Coolify → Keys & Tokens → token z uprawnieniem deploy)."
  echo "Przykład: COOLIFY_TOKEN=... ./scripts/setup-coolify-autodeploy.sh"
  exit 1
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  GITHUB_TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | awk -F= '/^password=/{print $2}')
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "Brak GITHUB_TOKEN — zaloguj się do GitHub (git credential lub export GITHUB_TOKEN=...)."
  exit 1
fi

echo "→ Włączam auto-deploy w Coolify..."
curl -fsS -X PATCH "${COOLIFY_URL}/api/v1/applications/${COOLIFY_APP_UUID}" \
  -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"is_auto_deploy_enabled":true,"instant_deploy":true}' >/dev/null

echo "→ Zapisuję COOLIFY_TOKEN w GitHub Secrets..."
GH_TOKEN="${GITHUB_TOKEN}" gh secret set COOLIFY_TOKEN \
  --body "${COOLIFY_TOKEN}" \
  --repo "${GITHUB_REPO}"

echo "→ Uruchamiam deploy bieżącej wersji..."
curl -fsS -G "${COOLIFY_URL}/api/v1/deploy" \
  --data-urlencode "uuid=${COOLIFY_APP_UUID}" \
  -H "Authorization: Bearer ${COOLIFY_TOKEN}"

echo
echo "Gotowe. Każdy push na main uruchomi deploy przez GitHub Actions."
