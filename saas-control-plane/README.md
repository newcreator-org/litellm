# LiteLLM SaaS Control Plane

Multi-tenant management layer for LiteLLM. Each organisation gets its own isolated LiteLLM instance with separate database schema, while sharing infrastructure to minimize cost.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  API Gateway                         │
│  (Control Plane routes by X-Org-Slug / subdomain)   │
└──────────┬──────────┬──────────┬────────────────────┘
           │          │          │
     ┌─────▼──┐ ┌─────▼──┐ ┌────▼───┐
     │LiteLLM │ │LiteLLM │ │LiteLLM │  ← per-org containers
     │ Org A  │ │ Org B  │ │ Org C  │    (scale-to-zero)
     └───┬────┘ └───┬────┘ └───┬────┘
         │          │          │
    ┌────▼──────────▼──────────▼────┐
    │     Shared PostgreSQL          │
    │  ┌─────────┬─────────┬──────┐ │
    │  │ org_a   │ org_b   │org_c │ │  ← schema-per-org
    │  └─────────┴─────────┴──────┘ │
    └───────────────────────────────┘
    ┌───────────────────────────────┐
    │       Shared Redis             │
    │  prefix: org:a, org:b, org:c  │
    └───────────────────────────────┘
```

## Key Design Decisions

- **Zero changes to LiteLLM core** — upstream updates merge cleanly
- **Schema-per-org** — full data isolation without separate DB instances
- **Scale-to-zero** — idle orgs cost nothing (Fly.io auto-stop or Docker stop)
- **Wake-on-request** — gateway auto-starts suspended instances

## Quick Start (Local Docker)

```bash
# Start shared infrastructure + control plane
docker compose -f docker-compose.saas.yml up -d

# Create an organisation
curl -X POST http://localhost:8000/orgs \
  -H "X-CP-API-Key: sk-cp-dev-secret" \
  -H "Content-Type: application/json" \
  -d '{"slug": "acme", "display_name": "Acme Corp"}'

# Use the org's LiteLLM instance via the gateway
curl http://localhost:8000/v1/models \
  -H "X-Org-Slug: acme" \
  -H "Authorization: Bearer <org-master-key>"
```

## API Reference

### Management API

All management endpoints require `X-CP-API-Key` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/orgs` | Create org (provisions DB schema + container) |
| `GET` | `/orgs` | List orgs (with optional `?status=` filter) |
| `GET` | `/orgs/{id}` | Get org details |
| `PATCH` | `/orgs/{id}` | Update org metadata |
| `DELETE` | `/orgs/{id}` | Destroy org (removes container + schema) |
| `POST` | `/orgs/{id}/stop` | Suspend org (scale-to-zero) |
| `POST` | `/orgs/{id}/start` | Wake org |
| `GET` | `/orgs/{id}/status` | Check container status |
| `GET` | `/health` | Health check |

### Gateway (LLM Proxy)

All other paths are proxied to the org's LiteLLM instance. Set the org via:

- `X-Org-Slug: acme` header (recommended)
- `X-Org-Id: <uuid>` header
- Subdomain: `acme.llm.example.com`

## Production Deployment (Fly.io)

```bash
# Deploy control plane
./scripts/deploy-flyio.sh

# Set required secrets
fly secrets set \
  CP_DATABASE_URL="postgresql+asyncpg://..." \
  CP_SHARED_PG_HOST="..." \
  CP_SHARED_PG_PASSWORD="..." \
  CP_FLY_API_TOKEN="..." \
  CP_CONTROL_PLANE_API_KEY="sk-cp-prod-..." \
  CP_ORCHESTRATOR_BACKEND="flyio" \
  --app litellm-control-plane
```

Org LiteLLM instances are automatically managed as Fly Machines with auto-stop enabled.

## Cost Estimate

| Component | Cost (10 orgs) | Cost (100 orgs) |
|-----------|---------------|-----------------|
| Control Plane | ~$5/mo | ~$5/mo |
| Shared PostgreSQL | ~$15-30/mo | ~$30-50/mo |
| Shared Redis | ~$10-15/mo | ~$15-25/mo |
| LiteLLM containers | ~$1-5/org (active) | ~$1-5/org (active) |
| **Total** | **~$40-80/mo** | **~$100-300/mo** |

Idle orgs consume zero compute cost thanks to scale-to-zero.

## Configuration

All settings are configured via environment variables with `CP_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `CP_DATABASE_URL` | `postgresql+asyncpg://...` | Control plane DB |
| `CP_SHARED_PG_HOST` | `localhost` | Shared PG for org schemas |
| `CP_SHARED_PG_DATABASE` | `litellm_saas` | Shared DB name |
| `CP_REDIS_HOST` | `localhost` | Shared Redis host |
| `CP_ORCHESTRATOR_BACKEND` | `docker` | `docker` or `flyio` |
| `CP_LITELLM_IMAGE` | `ghcr.io/berriai/litellm:main-stable` | LiteLLM Docker image |
| `CP_CONTROL_PLANE_API_KEY` | `sk-cp-secret` | Management API key |
| `CP_FLY_API_TOKEN` | — | Fly.io API token (for flyio backend) |
| `CP_FLY_REGION` | `nrt` | Fly.io region |
