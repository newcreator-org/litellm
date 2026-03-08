-- Create the shared SaaS database that holds per-org schemas.
-- The control-plane DB (litellm_control_plane) is created by POSTGRES_DB env var.

SELECT 'CREATE DATABASE litellm_saas OWNER llmproxy'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'litellm_saas')\gexec
