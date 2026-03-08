FROM python:3.11-slim

WORKDIR /control-plane

# Install system deps for asyncpg and prisma
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# Install prisma CLI (needed for schema provisioning)
RUN npm install -g prisma

# Install poetry
RUN pip install --no-cache-dir poetry

# Copy dependency files first for layer caching
COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi --no-root

# Copy application code
COPY . .
RUN poetry install --no-interaction --no-ansi

# Copy LiteLLM schema.prisma from repo root (needed for org provisioning)
# Build context must be set to repo root: docker build -f saas-control-plane/Dockerfile .
COPY schema.prisma /control-plane/schema.prisma
ENV CP_PRISMA_SCHEMA_PATH=/control-plane/schema.prisma

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
