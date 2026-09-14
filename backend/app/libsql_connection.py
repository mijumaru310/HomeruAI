"""Small sqlite3-style row adapter for Turso's libsql Python connection.

The research queries use SQLite SQL and named row lookups. The libsql Python
driver supports the SQL but returns tuples rather than sqlite3.Row objects.
"""

from __future__ import annotations

from typing import Any


class LibsqlCursor:
    def __init__(self, cursor: Any):
        self._cursor = cursor

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def _named(self, row: tuple[Any, ...] | None) -> dict[str, Any] | None:
        if row is None:
            return None
        columns = [column[0] for column in (self._cursor.description or ())]
        return dict(zip(columns, row))

    def fetchone(self) -> dict[str, Any] | None:
        return self._named(self._cursor.fetchone())

    def fetchall(self) -> list[dict[str, Any]]:
        return [self._named(row) for row in self._cursor.fetchall()]


class LibsqlConnection:
    def __init__(self, connection: Any):
        self._connection = connection

    def execute(self, sql: str, parameters: tuple[Any, ...] = ()) -> LibsqlCursor:
        return LibsqlCursor(self._connection.execute(sql, parameters))

    def close(self) -> None:
        self._connection.close()

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    def __enter__(self) -> "LibsqlConnection":
        self._connection.__enter__()
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> Any:
        return self._connection.__exit__(exc_type, exc_value, traceback)
