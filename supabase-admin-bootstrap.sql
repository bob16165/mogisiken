-- 管理者ログインの初期設定
-- 先に Supabase Authentication > Users でユーザーを作成してください。
-- 下のメールアドレスだけ、Authユーザーの実際のメールアドレスに変更します。

insert into public.app_users (id, role, school_id, student_id, display_name)
select
  id,
  'admin',
  null,
  null,
  'システム管理者'
from auth.users
where lower(email) = lower('admin@mogisiken.local')
on conflict (id) do update
set
  role = 'admin',
  school_id = null,
  student_id = null,
  display_name = 'システム管理者';

-- 登録結果を確認
select
  u.id,
  u.email,
  u.email_confirmed_at,
  a.role,
  a.display_name
from auth.users u
left join public.app_users a on a.id = u.id
where lower(u.email) = lower('admin@mogisiken.local');