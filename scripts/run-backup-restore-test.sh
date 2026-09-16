#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URLを設定してください}"
: "${BACKUP_RESTORE_DATABASE_URL:?テスト用DBのBACKUP_RESTORE_DATABASE_URLを設定してください}"

command -v pg_dump >/dev/null 2>&1 || { echo 'pg_dump が必要です' >&2; exit 1; }
command -v pg_restore >/dev/null 2>&1 || { echo 'pg_restore が必要です' >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo 'psql が必要です' >&2; exit 1; }

backup_file="$(mktemp -t mogisiken-backup).dump"
trap 'rm -f "$backup_file"' EXIT

## public以外（auth/storage/realtime等）はSupabase管理オブジェクトのため対象外にする
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="$backup_file"

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --schema=public \
  --dbname="$BACKUP_RESTORE_DATABASE_URL" \
  "$backup_file"

psql "$BACKUP_RESTORE_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --command="SELECT COUNT(*) AS schools FROM public.schools; SELECT COUNT(*) AS exams FROM public.exams; SELECT COUNT(*) AS results FROM public.student_exam_results;"

echo 'バックアップ取得とテストDBへの復元に成功しました。'
