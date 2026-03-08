#!/usr/bin/env bash
set -euo pipefail

# Deploy the SaaS control plane and shared infrastructure to Fly.io.
#
# Prerequisites:
#   - fly CLI installed and authenticated
#   - Shared PostgreSQL and Redis already provisioned on Fly.io
#
# Usage:
#   ./scripts/deploy-flyio.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CP_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== LiteLLM SaaS Control Plane — Fly.io Deployment ==="

# ---------- 1. Create Fly app (if not exists) ----------
echo "[1/4] Ensuring Fly app exists..."
fly apps create litellm-control-plane --org personal 2>/dev/null || true

# ---------- 2. Set secrets ----------
echo "[2/4] Setting secrets..."
echo "  (Set these via: fly secrets set KEY=VALUE --app litellm-control-plane)"
echo "  Required secrets:"
echo "    CP_DATABASE_URL          — Control plane PostgreSQL URL"
echo "    CP_SHARED_PG_HOST        — Shared PG host for org schemas"
echo "    CP_SHARED_PG_PORT        — Shared PG port"
echo "    CP_SHARED_PG_USER        — Shared PG user"
echo "    CP_SHARED_PG_PASSWORD    — Shared PG password"
echo "    CP_SHARED_PG_DATABASE    — Shared PG database name"
echo "    CP_REDIS_HOST            — Shared Redis host"
echo "    CP_REDIS_PORT            — Shared Redis port"
echo "    CP_REDIS_PASSWORD        — Shared Redis password"
echo "    CP_FLY_API_TOKEN         — Fly.io API token for Machines API"
echo "    CP_FLY_ORG               — Fly.io organisation"
echo "    CP_FLY_REGION            — Fly.io region (default: nrt)"
echo "    CP_CONTROL_PLANE_API_KEY — API key for management endpoints"
echo ""

# ---------- 3. Deploy ----------
echo "[3/4] Deploying control plane..."
cd "$CP_DIR"
fly deploy --app litellm-control-plane

# ---------- 4. Verify ----------
echo "[4/4] Verifying deployment..."
sleep 5
curl -sf "https://litellm-control-plane.fly.dev/health" | python3 -m json.tool

echo ""
echo "=== Deployment complete ==="
echo "Control Plane URL: https://litellm-control-plane.fly.dev"
echo ""
echo "Next steps:"
echo "  1. Set secrets listed above via 'fly secrets set'"
echo "  2. Create an org:  curl -X POST https://litellm-control-plane.fly.dev/orgs \\"
echo "       -H 'X-CP-API-Key: <your-key>' \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"slug\": \"acme\", \"display_name\": \"Acme Corp\"}'"
