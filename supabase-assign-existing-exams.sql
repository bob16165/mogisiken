-- 既存試験へ学校IDを後付けする移行SQL
-- 実行前に SCHOOL_UUID を、public.schools.id の実際のUUIDへ置き換えてください。

-- 旧構成で列がない場合だけ追加します。
alter table public.exams
  add column if not exists school_id uuid references public.schools(id) on delete cascade;

alter table public.student_exam_results
  add column if not exists school_id uuid references public.schools(id) on delete cascade;

-- 既存試験と、その試験結果を指定した学校へ割り当てます。
update public.exams
set school_id = 'SCHOOL_UUID'
where school_id is null;

update public.student_exam_results result
set school_id = exam.school_id
from public.exams exam
where result.exam_id = exam.id
  and result.school_id is null;

-- 割り当て結果を確認します。
select
  exam.id,
  exam.exam_name,
  exam.school_id,
  school.name as school_name,
  count(result.id) as result_count
from public.exams exam
left join public.schools school on school.id = exam.school_id
left join public.student_exam_results result on result.exam_id = exam.id
group by exam.id, exam.exam_name, exam.school_id, school.name
order by exam.created_at;