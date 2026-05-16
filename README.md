# namekoQ — 量子アプリケーション生成AIエージェント

ドメイン専門家(化学・金融など)向けに、自然言語の要望から **Qiskitコード生成 → シミュレータ実行 → ドメイン用語での解釈** までを行うエージェントのPoC。

## アーキテクチャ

```
[ユーザー: "H2のエネルギー計算したい"]
       ↓
[Next.js Chat UI] (App Router + @ai-sdk/react)
       ↓
[/api/chat] (AI SDK v6 streamText + Tool Calling)
       ↓
[OpenAI (@ai-sdk/openai)]
       ↓ tool call
[simulate_qiskit] → Python3 subprocess → Qiskit Aer
       ↓
[結果をドメイン用語に翻訳して返す]
```

## セットアップ

### 1. Node依存をインストール

```bash
npm install
```

### 2. Python + Qiskit を入れる

Aerシミュレータをローカルで動かすため Python 3.10+ が必要です。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install qiskit qiskit-aer scipy numpy
```

`.venv` を使う場合は `.env.local` の `PYTHON_BIN` を venv の python に向けてください。

### 3. OpenAI API キーを設定

[OpenAI Platform](https://platform.openai.com/api-keys) でキーを発行し `.env.local` に記入:

```bash
OPENAI_API_KEY=sk-...
NAMEKOQ_MODEL=gpt-5.5   # 必要に応じてgpt-5やgpt-4oに変更
```

Vercelにデプロイする場合は CLI で同期できます:

```bash
vercel link
vercel env add OPENAI_API_KEY
vercel env pull .env.local
```

### 4. 起動

```bash
npm run dev
# → http://localhost:3000
```

## 使い方の例

UIに以下を投げると、エージェントがコード生成 → 実行 → 解釈まで自動でやります:

- **化学**: 「H2分子の基底状態エネルギーをVQEで計算して。bond lengthは0.735 Å」
- **化学**: 「VQEで H2 の bond length を 0.5〜2.0 Å の間で振って、最安定点を見つけて」
- **金融**: 「3資産のうち2つを選ぶポートフォリオ最適化をQAOAで解いて」
- **動作確認**: 「Bell状態を作って測定してみて」

## 構成ファイル

| パス | 役割 |
|------|------|
| `app/page.tsx` | エントリ。例文ボタン+Chatを並べる |
| `components/chat.tsx` | `useChat` + `DefaultChatTransport` のチャットUI |
| `app/api/chat/route.ts` | `streamText` + `simulate_qiskit` ツール定義 |
| `lib/system-prompt.ts` | ドメイン専門家向け振る舞いの指示 |
| `lib/quantum-templates.ts` | VQE/QAOA/Bell の参照Qiskit実装 |
| `lib/run-qiskit.ts` | Python subprocess 実行 (タイムアウト/サイズ制限あり) |

## 今後の拡張 (PoCの先)

1. **Vercel Sandbox 化**: ローカルPython依存を外し、`@vercel/sandbox` でクラウド実行に切替
2. **実機ジョブ**: IBM Quantumへの投入 + ジョブ完了通知 (Vercel Workflow DevKitでdurable化)
3. **RAG**: Qiskit公式docs + 量子アルゴリズム論文のベクタDB
4. **検証ループ強化**: 期待値の物理的妥当性チェック (例: H2エネルギー > -1.5 Ha)
5. **PES計算など反復タスク**: パラメトリックスキャン用のオーケストレーション

## 参考にしたもの

- Qiskit Code Assistant (IBM, 2024 / arXiv:2405.19495) — Qiskit専用LLMのFTとベンチマーク
- Classiq — 高レベル仕様 → 自動回路合成
- Kandala et al., Nature 549, 242 (2017) — Hardware-Efficient VQE for H2
- Vercel AI SDK v6 + AI Gateway の Tool Calling パターン
