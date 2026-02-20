# JuriNex Agent Draft Service - Cloud Run
# Listens on PORT (Cloud Run sets 8080), host 0.0.0.0

FROM python:3.12-slim

WORKDIR /app

# Install system deps if needed (e.g. for psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run contract: listen on PORT (default 8080), bind to 0.0.0.0
ENV PORT=8080
EXPOSE 8080

# Shell form so $PORT is expanded at runtime
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
