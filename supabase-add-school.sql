-- 新規学校（学科）登録テンプレート。qualification_group を選んで実行する。
--   'judo'                : 柔道整復師
--   'acupuncture'         : 鍼灸師（はり師・きゅう師）
--   'acupuncture_massage' : 鍼灸師 + あん摩マッサージ指圧師（同一グループ）
-- ※ 同じ学校でも学科ごとに別の学校(school)として登録する。
INSERT INTO schools (name, qualification_group)
VALUES ('<学校名>', 'acupuncture_massage');

-- 既存の学校のグループ変更
-- UPDATE schools SET qualification_group = 'judo' WHERE id = '<学校ID>';
