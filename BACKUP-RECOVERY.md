# バックアップ・障害時復旧手順

## 1. バックアップ対象

| 対象 | 保存方法 | 復旧方法 |
| --- | --- | --- |
| 業務データ（学校、学生マスター、試験、成績、チャット、課題） | Supabase のバックアップ機能、および定期的な `pg_dump` | DB 復元後にマイグレーションを適用 |
| DB スキーマ・RLS | Git 管理の SQL（`supabase-*.sql`） | SQL を適用 |
| Edge Functions | Git 管理の `supabase/functions/` | Supabase CLI で再デプロイ |
| Secrets | Git に保存せず、パスワード管理庫などで別管理 | Supabase Secrets を再設定 |
| Auth ユーザー | Supabase の Auth / DB バックアップ運用に従う | 復元できない場合はユーザーを再作成し、パスワードを再設定 |
| GitHub Pages | Git の `main` ブランチ | GitHub Pages の公開設定を復旧 |

`service_role` キー、OpenAI API キー、パスワード、バックアップファイルは GitHub に保存しません。

## 2. 定期バックアップ

### Supabase 側

Supabase Dashboard の対象プロジェクトで、契約プランに含まれる自動バックアップと保持期間を確認します。Point-in-Time Recovery（PITR）が利用できる場合は、本番運用では有効化を検討してください。バックアップの有無だけでなく、実際に復元できるかを定期的に検証します。

### 論理バックアップ

本番 DB の接続情報を端末や CI の Secret として安全に設定したうえで、定期的に取得します。実際の接続文字列やキーをコマンド、ログ、Git に残さないでください。

```sh
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="backup-$(date +%Y%m%d-%H%M%S).dump"
```

リポジトリの `npm run test:backup-restore` を使うと、`DATABASE_URL` から取得したダンプを `BACKUP_RESTORE_DATABASE_URL` のテスト用 DB へ復元し、主要テーブルの件数を確認できます。本番 DB を復元先に指定しないでください。

- バックアップは暗号化された保管先へ保存する
- 保持期間と世代数を決める
- 本番と同じ場所だけに保存しない
- 個人情報を含むため、アクセス権を管理する
- 少なくとも月1回はテスト用プロジェクトへ復元する
- 復元テスト後はテスト DB と一時ファイルを削除する

Auth のパスワードは `pg_dump` で復元する運用にせず、復旧後にパスワードリセットを行います。

## 3. 障害発生時の初動

1. GitHub Pages、Supabase API、Auth、Edge Function のどこで失敗しているかを切り分ける
2. Supabase Dashboard の障害情報、ログ、Database の状態を確認する
3. 破壊的な SQL、再インポート、ユーザー削除を止める
4. 発生時刻、エラーメッセージ、直前の変更、影響範囲を記録する
5. データ破損が疑われる場合は、現在の DB 状態を保存してから復旧作業を始める
6. 学生・教員へ影響と暫定対応を連絡する

## 4. DB を復元する場合

1. 復元先プロジェクトを用意し、接続先 URL を確認する
2. Supabase のバックアップまたは `pg_restore` で DB を復元する
3. Git の SQL を確認し、必要なスキーマ移行を古い順に適用する
4. 既存 DB の RLS 強化だけを行う場合は、`supabase-schema.sql` ではなく `supabase-security-hardening.sql` を使う
5. RLS、`FORCE ROW LEVEL SECURITY`、ポリシー、関数を確認する
6. テスト用アカウントで、学生は本人のデータだけ、教員は所属校だけ取得できることを確認する
7. 別学校・別学生のデータを取得できないことを確認する
8. Edge Functions の接続先と Secrets を復旧する
9. アプリの Supabase Project URL を復旧先へ切り替える
10. 本番公開前にログイン、成績表示、CSV 登録、チャット、課題保存を確認する

### 復元後の確認 SQL

```sql
SELECT
  tables.tablename,
  tables.rowsecurity,
  classes.relforcerowsecurity AS force_row_level_security
FROM pg_tables AS tables
JOIN pg_class AS classes
  ON classes.relname = tables.tablename
JOIN pg_namespace AS namespaces
  ON namespaces.oid = classes.relnamespace
 AND namespaces.nspname = tables.schemaname
WHERE tables.schemaname = 'public'
  AND tables.tablename IN (
    'schools', 'app_users', 'student_master', 'exams',
    'student_exam_results', 'source_mapping',
    'student_chat_messages', 'student_study_tasks'
  )
ORDER BY tables.tablename;
```

全対象テーブルで `rowsecurity = true`、`force_row_level_security = true` であることを確認します。

## 5. Edge Function を復旧する場合

プロジェクトへ再リンクした後、Git 管理のソースからデプロイします。

```sh
supabase functions deploy import-student-master
supabase functions deploy import-exam
supabase functions deploy student-results
supabase functions deploy ai-chat
```

続けて Dashboard または CLI で、次の Secrets を再設定します。

```sh
supabase secrets set OPENAI_API_KEY=<実際のキー>
```

`SUPABASE_SERVICE_ROLE_KEY` は Edge Function の実行環境で利用できる状態を確認します。値をソースコード、ブラウザ、GitHub Actions のログへ出力しません。

## 6. Auth ユーザーを復旧する場合

- Auth がバックアップから復元できる場合は、`app_users.id` と `auth.users.id` の対応を確認する
- 復元できない場合は、管理用 Edge Function で Auth ユーザーを再作成する
- パスワードは復元・ログ出力せず、初回ログイン時の再設定または管理者による再発行を行う
- 再作成後に `app_users` の `id`、`role`、`school_id`、`student_id` を照合する

## 7. GitHub Pages を復旧する場合

1. GitHub リポジトリが Public であることを確認する
2. Settings → Pages を開く
3. `Deploy from a branch`、`main`、`/(root)` を設定する
4. 保存後、Actions / Pages のデプロイ状態を確認する
5. 次の URL で HTTP 200 を確認する

```text
https://bob16165.github.io/mogisiken/
https://bob16165.github.io/mogisiken/index-supabase.html
```

## 8. 復旧完了の判定

- ログインできる
- 学生は本人の成績だけ見える
- 教員は所属校のデータだけ見える
- 学校をまたいだ読み書きが拒否される
- `service_role` と外部 API キーがブラウザに存在しない
- Edge Function の認証・Secrets・ログが正常である
- RLS と `FORCE ROW LEVEL SECURITY` が有効である
- 直近バックアップからの復元結果と欠損データを管理者が確認した
