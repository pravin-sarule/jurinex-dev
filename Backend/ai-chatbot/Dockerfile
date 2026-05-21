FROM python:3.12-slim

# System deps for psycopg binary + general build
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer-cached unless requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY . .

# Cloud Run injects PORT env var; default to 8095 for local docker run
ENV PORT=8095
ENV HOST=0.0.0.0
ENV ENVIRONMENT=production
ENV LOG_LEVEL=INFO
ENV WORKERS=4
ENV DB_POOL_MIN_SIZE=2
ENV DB_POOL_MAX_SIZE=10

EXPOSE ${PORT}

# Production: gunicorn with multiple UvicornWorkers
# Each worker gets its own connection pool (DB_POOL_MIN_SIZE–DB_POOL_MAX_SIZE connections).
CMD gunicorn main:app \
    -c gunicorn.conf.py \
    --bind ${HOST}:${PORT} \
    --workers ${WORKERS}
