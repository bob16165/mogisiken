-- 出典マッピングのアップロード権限を管理者だけに限定します。
DROP POLICY IF EXISTS source_mapping_teacher_write ON public.source_mapping;
DROP POLICY IF EXISTS source_mapping_admin_write ON public.source_mapping;

CREATE POLICY source_mapping_admin_write
ON public.source_mapping
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());