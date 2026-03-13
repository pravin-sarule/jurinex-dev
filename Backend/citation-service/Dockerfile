FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080

CMD ["sh", "-c", "gunicorn -k uvicorn.workers.UvicornWorker -b :${PORT} main:app --workers 1 --threads 8 --timeout 0"]
