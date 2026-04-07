import asyncio
import json
import sqlite3
from datetime import date, datetime
from pathlib import Path

import asyncpg

from app.core.config import settings

TABLE_ORDER = [
    "agents",
    "contacts",
    "properties",
    "leads",
    "site_visits",
    "tasks",
    "activities",
    "notifications",
    "followups",
]


def _parse_datetime(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            pass
        for fmt in (
            "%Y-%m-%d %H:%M:%S.%f",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%dT%H:%M:%S.%f",
            "%Y-%m-%dT%H:%M:%S",
        ):
            try:
                return datetime.strptime(v, fmt)
            except ValueError:
                continue
    return value


def _parse_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        try:
            return date.fromisoformat(v)
        except ValueError:
            return _parse_datetime(v).date()
    if isinstance(value, datetime):
        return value.date()
    return value


def _convert_value(value, pg_data_type):
    if value == "":
        return None

    if pg_data_type in ("timestamp without time zone", "timestamp with time zone"):
        return _parse_datetime(value)
    if pg_data_type == "date":
        return _parse_date(value)
    if pg_data_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() in ("1", "true", "t", "yes", "y")
    if pg_data_type in ("json", "jsonb"):
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        if isinstance(value, str):
            try:
                return json.dumps(json.loads(value))
            except json.JSONDecodeError:
                return None
    if pg_data_type in ("smallint", "integer", "bigint"):
        if value is None:
            return None
        if isinstance(value, int):
            return value
        return int(value)
    if pg_data_type in ("numeric", "real", "double precision"):
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return value
        return float(value)

    if isinstance(value, (dict, list)):
        # For non-JSON destination columns, preserve complex payload as string.
        return json.dumps(value)

    return value


async def migrate():
    sqlite_path = Path("propello.db")
    if not sqlite_path.exists():
        raise RuntimeError("Local SQLite database propello.db not found")

    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()

    pg_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    pg_conn = await asyncpg.connect(pg_url)

    try:
        await pg_conn.execute("BEGIN")

        # Replace existing CRM rows with local SQLite snapshot.
        truncate_sql = "TRUNCATE TABLE " + ", ".join(f"public.{t}" for t in TABLE_ORDER) + " CASCADE"
        await pg_conn.execute(truncate_sql)

        migrated_summary = {}

        for table in TABLE_ORDER:
            sqlite_cur.execute(f"SELECT * FROM {table}")
            rows = sqlite_cur.fetchall()

            col_info = await pg_conn.fetch(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position
                """,
                table,
            )
            pg_columns = [r["column_name"] for r in col_info]
            pg_types = {r["column_name"]: r["data_type"] for r in col_info}

            inserted = 0
            for row in rows:
                source = dict(row)
                cols = [c for c in pg_columns if c in source]
                if not cols:
                    continue

                values = [_convert_value(source[c], pg_types.get(c, "text")) for c in cols]
                placeholders = ", ".join(f"${i}" for i in range(1, len(cols) + 1))
                col_sql = ", ".join(cols)
                sql = f"INSERT INTO public.{table} ({col_sql}) VALUES ({placeholders})"
                await pg_conn.execute(sql, *values)
                inserted += 1

            migrated_summary[table] = {"source_rows": len(rows), "inserted": inserted}

        await pg_conn.execute("COMMIT")

        print("Migration completed: SQLite -> Supabase")
        for table in TABLE_ORDER:
            stats = migrated_summary[table]
            print(f"{table}: source={stats['source_rows']} inserted={stats['inserted']}")

    except Exception:
        await pg_conn.execute("ROLLBACK")
        raise
    finally:
        sqlite_conn.close()
        await pg_conn.close()


if __name__ == "__main__":
    asyncio.run(migrate())
