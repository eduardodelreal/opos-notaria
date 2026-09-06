#!/usr/bin/env bash
# ============================================================================
# Aplica las migraciones contra un PostgreSQL LOCAL y ejecuta la batería de
# pruebas de comportamiento.
#
# NO TOCA SUPABASE. Crea y DESTRUYE una base de datos local (opos_test por
# defecto) en cada ejecución.
#
#   ./db/pruebas/ejecutar.sh
#
# Variables opcionales:
#   PGDATABASE_TEST   nombre de la base de pruebas   (por defecto opos_test)
#   PSQL              cómo invocar psql              (por defecto "psql")
#
# Ver db/pruebas/README.md.
# ============================================================================
set -euo pipefail

DB="${PGDATABASE_TEST:-opos_test}"
PSQL="${PSQL:-psql}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$RAIZ/db/migrations"
PRU="$RAIZ/db/pruebas"

# Ojo: cualquier cosa que no sea una base local desechable.
case "$DB" in
  *prod*|*produc*|*supabase*) echo "Nombre de base sospechoso: $DB. Aborto." >&2; exit 2 ;;
esac

paso() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

paso "recreando la base de pruebas «$DB»"
$PSQL -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB" >/dev/null
$PSQL -X -q -d postgres -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null

aplicar() {
  $PSQL -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$1" 2>&1 \
    | grep -vE 'NOTICE:.*(does not exist, skipping|already exists, skipping)' || true
}

paso "andamiaje de Supabase (solo local: auth, storage, roles)"
aplicar "$PRU/andamiaje.sql"

paso "aplicando migraciones"
for f in "$MIG"/*.sql; do
  echo "  · $(basename "$f")"
  aplicar "$f"
done

paso "reaplicando migraciones (idempotencia)"
for f in "$MIG"/*.sql; do
  echo "  · $(basename "$f")"
  aplicar "$f"
done

paso "pruebas de comportamiento"
$PSQL -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$PRU/pruebas.sql"

FALLOS="$($PSQL -X -tA -d "$DB" -c 'select count(*) from pruebas.resultados where not ok')"
if [ "$FALLOS" != "0" ]; then
  printf '\n\033[31m%s comprobaciones FALLIDAS\033[0m\n' "$FALLOS"
  $PSQL -X -d "$DB" -c 'select bloque, nombre, detalle from pruebas.resultados where not ok order by n'
  exit 1
fi

printf '\n\033[32mTodas las comprobaciones pasan.\033[0m\n'
