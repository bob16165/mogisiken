# OSS ライセンス一覧

本プロジェクトで利用している主な OSS とライセンスです。ライセンス本文は各プロジェクトの公式配布物を参照してください。

## Vite / React アプリ

| パッケージ | 用途 | ライセンス | 公式リポジトリ |
| --- | --- | --- | --- |
| React | UI ランタイム | MIT | https://github.com/facebook/react |
| React DOM | React の DOM レンダラー | MIT | https://github.com/facebook/react |
| TypeScript | 型チェック・コンパイル | Apache-2.0 | https://github.com/microsoft/TypeScript |
| Vite | 開発サーバー・ビルド | MIT | https://github.com/vitejs/vite |
| @vitejs/plugin-react | Vite の React プラグイン | MIT | https://github.com/vitejs/vite-plugin-react |
| @types/react | React の型定義 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | React DOM の型定義 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## 公開 HTML の CDN 依存

| ライブラリ | 用途 | ライセンス | 公式サイト / リポジトリ |
| --- | --- | --- | --- |
| React | UI ランタイム | MIT | https://github.com/facebook/react |
| React DOM | React の DOM レンダラー | MIT | https://github.com/facebook/react |
| Babel Standalone | ブラウザ上の JSX 変換 | MIT | https://github.com/babel/babel |
| @supabase/supabase-js | Supabase Auth・DB クライアント | MIT | https://github.com/supabase/supabase-js |
| html2canvas | HTML の画像化 | MIT | https://github.com/niklasvh/html2canvas |
| jsPDF | PDF 生成 | MIT | https://github.com/parallax/jsPDF |

## 注意事項

- `package.json` の直接依存だけでなく、依存パッケージの推移依存も OSS ライセンス確認の対象です。リリース時は `package-lock.json` の実際のバージョンを基準に確認してください。
- `index-supabase.html` の CDN URL は一部がメジャーバージョン指定またはバージョン未固定です。再現性とライセンス管理のため、本番では具体的なバージョンを固定し、更新時にこの一覧を見直してください。
- OSS のライセンス表示義務は各ライセンスの条件に従ってください。MIT / Apache-2.0 の著作権表示・ライセンス本文の扱いを、配布形態と合わせて確認してください。
- Supabase、OpenAI、GitHub Pages はサービスであり、この一覧の OSS ライブラリとは別に各サービスの利用規約・料金・データ取扱条件を確認してください。

## 秘密ロジックの移行状況

現時点で Edge Function 側に移っているものは次のとおりです。

- OpenAI API 呼び出しと `OPENAI_API_KEY` の利用
- `SUPABASE_SERVICE_ROLE_KEY` を使う管理処理
- Auth ユーザーの作成・更新を含む学生一括登録
- Edge Function 側での学生本人・教員・管理者の権限確認
- AI 呼び出しの学生単位レート制限
- 試験回答のサーバー側採点と学生向け結果レスポンスの生成

一方、次のロジックはまだ `index-supabase.html` のブラウザ側にあります。

- 学生画面の表示・学習ガイダンスの一部
- ローカル AI 学習コーチのルールベース応答

学生結果 API は正答フィールドを学生レスポンスから除外します。フロントは表示を担当し、学生向けの正答・採点材料を直接取得しない構成です。
