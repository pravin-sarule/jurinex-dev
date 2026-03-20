"""
One-off script to create user_templates and related tables in Draft_DB.
Run from this directory: venv\\Scripts\\python.exe run_user_templates_migration.py
"""
import asyncio
import os
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

# Load .env from this directory
load_dotenv(Path(__file__).resolve().parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL not set in .env")

# asyncpg expects postgresql:// (no +asyncpg)
conn_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)

MIGRATION_FILE = Path(__file__).resolve().parent / "migrations" / "create_user_templates.sql"


async def main():
    sql = MIGRATION_FILE.read_text(encoding="utf-8")
    conn = await asyncpg.connect(conn_url)
    try:
        await conn.execute(sql)
        print("Migration completed: user_templates and related tables created.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
