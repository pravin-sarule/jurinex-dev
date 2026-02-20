import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from .routers import analysis
from .database import engine, Base
# Import all models to register them with Base.metadata
from .models.db_models import UserTemplate, UserTemplateField, UserTemplateAnalysisSection

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="User Template Analyser Agent")

# CORS must be added FIRST so it wraps all responses (including errors) and handles preflight OPTIONS
_cors_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "https://jurinex-dev.netlify.app",
    "https://nexintel.netlify.app",
]
_extra = os.environ.get("CORS_ORIGINS", "").strip()
if _extra:
    _cors_origins.extend(o.strip() for o in _extra.split(",") if o.strip())
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://.*\.netlify\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

class RequestLogMiddleware(BaseHTTPMiddleware):
    """Log every incoming request so activity is visible in console."""
    async def dispatch(self, request, call_next):
        path = request.url.path
        method = request.method
        has_auth = "authorization" in [k.lower() for k in request.headers.keys()]
        has_x_user = "x-user-id" in [k.lower() for k in request.headers.keys()]
        print(f"[Template Analyzer] >>> {method} {path} (Auth: {has_auth}, X-User-Id: {has_x_user})", flush=True)
        logger.info(f"Incoming: {method} {path}")
        response = await call_next(request)
        print(f"[Template Analyzer] <<< {method} {path} -> {response.status_code}", flush=True)
        return response

app.add_middleware(RequestLogMiddleware)

# Tables are created by migrations / Backend; we do not run create_all to avoid schema conflicts.
@app.on_event("startup")
async def startup():
    logger.info("Database connection ready (User Templates Service).")

app.include_router(analysis.router)

@app.get("/")
async def root():
    return {"message": "User Template Analyzer Agent is active."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5017)
