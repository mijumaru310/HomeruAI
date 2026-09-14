# Vercel 公開手順（Next.js + FastAPI）

この構成はルートの `vercel.json` にある Vercel Services（ベータ）で、画面と API を同じドメインに配置する。`/api/*` は FastAPI、その他は Next.js に届く。API キーや研究データはブラウザへ配らない。

## 公開前に

1. この変更を GitHub の `main` に反映する。Vercel の Project で `HomeruAI` を GitHub から Import し、**Root Directory はリポジトリのルート**（`frontend` ではない）、Framework Preset は **Services** にする。Production Branch は `main`。
2. Turso で **libSQL データベース**を作る。Vercel の [Turso Cloud integration](https://vercel.com/marketplace/tursocloud) を使う場合は、プロジェクトへの接続後、`TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` が Production / Preview に設定されたことを確認する。Preview 用には Production と別の DB を使い、実験データを混ぜない。手動設定でも同名の環境変数を使える。
3. Google Cloud で課金が有効なプロジェクトを選び、Vertex AI API（現行コンソールでは Agent Platform API と表示される場合がある）を有効にする。アプリ専用サービスアカウントにそのプロジェクトの `roles/aiplatform.user` を付与する。Vercel の Project Settings → Environment Variables に、`GOOGLE_CLOUD_PROJECT`（プロジェクトID）、`GOOGLE_CLOUD_LOCATION=global`、`VERTEX_GEMINI_MODEL=gemini-3.5-flash-lite`、`VERTEX_SERVICE_ACCOUNT_JSON`（サービスアカウントのJSON全体）を **backend 用のサーバー環境変数** として登録する。JSON は機密値として扱い、Git・`NEXT_PUBLIC_*`・画面に出さない。サービスアカウント鍵は漏えい時の影響が大きいため、鍵なしの Workload Identity Federation を将来の運用候補とし、鍵を使う場合は権限を絞って定期的にローテーションする。
4. 同じ Environment Variables に従来の `GEMINI_API_KEY` をフォールバック用として残す。`GOOGLE_CLOUD_PROJECT` が設定されていれば **Vertex AI → APIキー → ローカルの操作記録による称賛** の順に切り替わる。`GOOGLE_CLOUD_PROJECT` が空なら従来どおりAPIキーから始まる。`VERTEX_TIMEOUT_MS` と `GEMINI_TIMEOUT_MS` は各API呼び出しのタイムアウト（初期値12,000ms）。`NEXT_PUBLIC_API_URL` は設定しない（同一ドメインの `/api` を利用）。秘密値を Git に入れない。
5. Redeploy を実行する。環境変数の変更は既存デプロイに自動反映されない。`TURSO_DATABASE_URL` または `TURSO_AUTH_TOKEN` が欠けた Vercel 実行環境では、消えるローカル SQLite に書き込まないよう API 起動を止める。

Vercel Services は現時点でベータ。画面に Services のエラーが出る場合は [公式 Services ドキュメント](https://vercel.com/docs/services) の現行仕様とプロジェクト設定を確認する。このリポジトリの設定だけでは Turso データベースや Vercel アカウントは作成されない。

## 動作確認

1. `https://<公開ドメイン>/api/health` が JSON を返す。`provider.vertex_configured` と `provider.api_key_fallback_configured` が `true` かを確認する（接続成功の保証ではなく設定有無のみ。秘密値は返らない）。テスト用の筆記を1件分析し、研究DBの `analysis_runs.provider` が通常 `vertex_ai`、Vertex障害時 `gemini_api`、両方失敗時 `local` になることを確認する。
2. iPad の Safari で `https://<公開ドメイン>/` を開き、Apple Pencil で筆記・消去・振り返りを試す。再読み込み後にノートが戻ることを確かめる。ノート本体はその端末の IndexedDB 保存であり、別端末へ同期しない。
3. 別のテスト参加者コードで実験URLを開き、3問と追加問題の選択まで進める。ページ再読み込み後もサーバー側の成長表示・イベントが残ることを確認する。テストコードを本番割付に再利用しない。
4. 実験URLは `backend/scripts/create_experiment_assignments.py --base-url https://<公開ドメイン>/ ...` で生成する。アンケートはアプリに組み込まず、[実験手順](./RESEARCH_PROTOCOL.md) に従って外部で実施する。
5. 研究者のローカル `backend/.env` に **対象DB** の `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` を設定すると、監査・CSV出力・再学習・辞退者データ削除スクリプトは公開DBを参照する。`--database <path>` を付けると従来どおり指定したローカル SQLite を使う。削除前には `withdraw_participant.py` のプレビューと対象コードを必ず確認する。

## 研究運用上の注意

- `VERCEL` 上の研究データは Turso に永続化するが、**本番の Turso 接続を使った実測はデータベース作成後に必須**。ローカルの libSQL 互換テストだけでは通信・権限・レイテンシーは検証できない。
- API に参加者認証はない。URL パラメータは操作を簡単にするためのもので、アクセス制御ではない。公開前に Vercel Deployment Protection 等で配布範囲を限定し、同意・データ保持期間・撤回手順を研究計画に明記する。
- `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` の Preview / Production の取り違えに注意する。CSV や割付表は公開リポジトリにコミットしない。
- Gemini の外部送信は参加者への説明・同意の対象。Vertex AI と API キー経路は課金先・割当・データ取扱条件が異なりうる。参加前の同意文書で両経路を説明し、`analysis_runs.provider` と `error_category` を監査して群間の切替率を報告する。Vertex AI も共有容量不足などで429になりうるため、フォールバックは回数制限の完全な回避を保証しない。
