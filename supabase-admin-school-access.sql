-- 管理者が学校一覧を取得できるようにするRLS
-- Table Editorでは見えるが、アプリでは学校未登録になる場合に実行します。

alter table public.schools enable row level security;

drop policy if exists schools_admin_read on public.schools;

create policy schools_admin_read
on public.schools
for select
to authenticated
using (
  exists (
    select 1
    from public.app_users
    where app_users.id = auth.uid()
      and app_users.role = 'admin'
  )
);

-- アプリのログインユーザー自身のプロフィールを読めるようにします。
alter table public.app_users enable row level security;

drop policy if exists app_users_self_read on public.app_users;

create policy app_users_self_read
on public.app_users
for select
to authenticated
using (id = auth.uid());