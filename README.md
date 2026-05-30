# namekoQ — 量子アプリケーション生成AIエージェント

ドメイン専門家(化学・金融など)向けに、自然言語の要望から **量子計算コード生成 → シミュレータ実行 → ドメイン用語での解釈** までを行うエージェントのPoC。

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
[simulate_*] → Python3 subprocess → Qiskit / PennyLane / Cirq simulator
       ↓
[結果をドメイン用語に翻訳して返す]
```

## セットアップ

### 1. Node依存をインストール

```bash
npm install
```

### 2. Python + 量子計算フレームワークを入れる

Qiskit / PennyLane / Cirq のローカルシミュレータを動かすため Python 3.10+ が必要です。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`.venv` を使う場合は `.env.local` の `PYTHON_BIN` を venv の python に向けてください。

```bash
PYTHON_BIN=/path/to/namekoQ/.venv/bin/python
```

### 3. LLM API キーを設定

UIの「標準」モードは DeepSeek V4 Pro、「Pro」モードは GPT-5.5 を使います。

**標準モード (DeepSeek)**

```bash
DEEPSEEK_API_KEY=sk-...
# NAMEKOQ_DEEPSEEK_MODEL=deepseek-v4-pro  # 任意。デフォルトは deepseek-v4-pro
```

**Pro モード (OpenAI)**

[OpenAI Platform](https://platform.openai.com/api-keys) でキーを発行し `.env.local` に記入:

```bash
OPENAI_API_KEY=sk-...
# NAMEKOQ_MODEL=gpt-5.5  # 任意。デフォルトは gpt-5.5
```

Vercelにデプロイする場合は CLI で同期できます:

```bash
vercel link
vercel env add DEEPSEEK_API_KEY
vercel env pull .env.local
```

### 4. 起動

```bash
npm run dev
# → http://localhost:3000
```

## ベンチマーク評価 (QuanBench+)

[QuanBench+](https://arxiv.org/html/2604.08570v2) を使って namekoQ の精度を自動評価できます。
Qiskit / PennyLane / Cirq の 42 問を採点し、Pass@1・KL Divergence を論文準拠で計測します。

### セットアップ

```bash
bash benchmark/setup.sh
```

QuanBench+ リポジトリのクローンと Python 依存のインストールを行います。

### 実行

namekoQ を起動した状態で別ターミナルから実行します。

```bash
# GPT-5.5（Pro モード）で全フレームワーク・全問題
python benchmark/run_eval.py --model-tier pro

# DeepSeek V4 Pro（標準モード）で評価
python benchmark/run_eval.py --model-tier default

# 動作確認用（Qiskit のみ 5 問）
python benchmark/run_eval.py --framework qiskit --limit 5

# 結果ファイルを指定
python benchmark/run_eval.py --model-tier pro --output benchmark/results/gpt55.json
```

結果は `benchmark/results/` に JSON 形式で保存されます（途中クラッシュ時も中間保存あり）。

| オプション | 説明 |
|---|---|
| `--model-tier` | `pro`（GPT-5.5）または `default`（DeepSeek V4 Pro） |
| `--framework` | `qiskit` / `pennylane` / `cirq` / `all`（デフォルト） |
| `--limit` | テストする問題数の上限 |
| `--namekoq-url` | namekoQ の URL（デフォルト: `http://localhost:3000`） |
| `--delay` | 問題間のウェイト秒数（デフォルト: 2.0） |

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
| `app/api/chat/route.ts` | `streamText` + plan/simulate/verify ツール定義 |
| `lib/system-prompt.ts` | ドメイン専門家向け振る舞いの指示 |
| `lib/quantum-templates.ts` | VQE/QAOA/Bell の参照Qiskit実装 |
| `lib/run-python-simulation.ts` | Python subprocess 実行 (タイムアウト/サイズ制限あり) |

## リポジトリ分析

### 何を作っているか

このリポジトリは、量子計算の専門家ではないユーザーが自然言語で目的を入力し、LLM が実行計画を立て、Python の量子計算コードを生成し、ローカルシミュレータで実行して結果を説明するための PoC です。

実装上の中心は、単なるチャットUIではなく、以下の **計画 → 実行 → 検証** の3段階ワークフローです。

1. `request_plan`
   - ユーザー要望を `PlanSchema` に従う構造化計画へ変換する
   - framework、アルゴリズム、qubit数、パラメータ、成功条件、期待出力キーを明示する
2. `simulate_qiskit` / `simulate_pennylane` / `simulate_cirq`
   - 選択された framework 向けの Python コードを生成し、ローカルの Python subprocess で実行する
   - stdout の末尾に出た dict 風出力を JSON として抽出する
3. `verify_intent_alignment`
   - 別の critic LLM が、ユーザー要望・計画・コード・結果の整合性をレビューする
   - `aligned=false` の場合は修正して再実行する前提の設計になっている
4. `convert_to_openqasm`
   - 検証済み最終コードとは別に、LLM が OpenQASM 抽出専用コードを整形する
   - OpenQASM 自体は LLM ではなく Qiskit / Cirq / PennyLane の API で機械的に出力する
   - OpenQASM から、元の framework 以外の Qiskit / PennyLane / Cirq 実行用 wrapper code も機械的に生成する
   - 変換都合でメインの量子計算コードを単純化しないための後段ステップ

### 現在の実装範囲

- Frontend
  - Next.js App Router + React 19 + Tailwind CSS
  - 左ペインにリクエスト入力、Advanced 内に framework / shots / max iterations の追加設定
  - framework が Auto の場合は、LLM が問題に合う framework を選ぶ
  - 右ペインにチャット、ツール実行状況、計画、生成コード、実行結果、検証結果を表示
  - 実行完了後に `Final Output` として、最終コード、OpenQASM、OpenQASM 由来の別 framework 用 wrapper code を select で切り替えて編集・コピー可能な形で表示
  - OpenQASM 2.0 compatible な `quantum-circuit` ベースの回路エディターを表示し、gate の追加・移動・削除をドラッグ&ドロップで行える
  - 回路エディターでは RX/RY/RZ の角度、measure の classical bit、CX/CZ/SWAP の wire 割り当てを編集できる
  - OpenQASM ファイルの import/export、回路編集履歴の undo/redo、OpenQASM validation 表示に対応する
  - 回路エディターで編集した OpenQASM から、Qiskit / PennyLane / Cirq 用 wrapper code をブラウザ側で即時再生成する
  - 測定 counts は簡易バー表示される

- Backend
  - `/api/chat` が AI SDK v6 の `streamText` と tool calling を使う
  - 標準モードは DeepSeek V4 Pro (`DEEPSEEK_API_KEY`)、Pro モードは GPT-5.5 (`OPENAI_API_KEY`)
  - メインモデルは `NAMEKOQ_MODEL` / `NAMEKOQ_DEEPSEEK_MODEL`、critic は `NAMEKOQ_CRITIC_MODEL` / `NAMEKOQ_DEEPSEEK_CRITIC_MODEL` で変更可能
  - 最大12 step まで tool call を継続する

- Quantum execution
  - `requirements.txt` では Qiskit / qiskit-aer / PennyLane / Cirq Core / NumPy / SciPy を要求する
  - 実行はローカル Python subprocess
  - タイムアウトは120秒
  - stdout / stderr は最大64KBまで保持
  - 一時ディレクトリを作成してコードを書き込み、実行後に削除する

- Prompting
  - `SYSTEM_PROMPT` に Qiskit の Bell / H2 VQE / Portfolio QAOA 参照実装を埋め込んでいる
  - framework の取り違え、古い Qiskit API、存在しない API の生成を抑制しようとしている
  - `CRITIC_PROMPT` は「動いたか」ではなく「要望に合っているか」を見る設計

### 強み

- LLM に直接コードを書かせるだけでなく、`PlanSchema` で一度コミットメントポイントを作っている
- 実行後に critic LLM を挟むため、パラメータ取り違えや出力不足を検出しやすい
- Qiskit だけでなく PennyLane / Cirq も UI と tool 名としては選択できる
- 結果表示がドメインユーザー向けで、raw stdout だけでなく metrics / counts / 検証結果を見せる
- H2 VQE、Portfolio QAOA、Bell 状態という PoC の代表例が明確

### 制約・リスク

- 現在の Python 実行は安全なサンドボックスではなく、ローカル subprocess で任意 Python を実行する設計
  - 本番化するなら Vercel Sandbox、コンテナ、seccomp、ネットワーク遮断、ファイルシステム制限などが必要
- 回路エディターで編集した OpenQASM から wrapper code を即時再生成するが、Python simulator の再実行はパネルの「実行」ボタンで手動トリガーする設計
  - 回路変更のたびに自動実行するとリクエストが多発するため意図的にこの設計
- H2 VQE テンプレートは 0.735 Å の係数を直接持つ PoC 実装
  - 任意 bond length の本格的な分子ハミルトニアン生成には PySCF / qiskit-nature 等の導入が必要
- QAOA テンプレートは簡略版で、一般的な QUBO / Ising 変換や制約処理の厳密性は限定的
- 自動テスト、E2E、型チェック/CI が README 上も package scripts 上も未整備

### Qniverse との位置づけ

Qniverse は、量子回路ビルダー、複数SDK、HPC/GPU/FPGA/QPU バックエンド、教材やアルゴリズム集まで含む統合プラットフォームです。一方、このリポジトリはそこまでの統合環境ではなく、**自然言語から量子コードを生成し、ローカルシミュレーションして説明する AI エージェント PoC** です。

近い方向性はありますが、現状の namekoQ は Qniverse の代替ではなく、Qniverse 的な体験のうち「自然言語インターフェース」「コード生成」「ローカル実行」「結果解釈」に絞った小さな実験実装と見るのが正確です。

### 改善優先度

1. 実行安全性を上げる
   - ローカル subprocess から隔離サンドボックスへ移す
   - 実行可能 import / ファイルアクセス / ネットワークを制限する
2. framework 実行層を整理する
   - framework ごとの依存チェックとエラー説明を分ける
3. 量子テンプレートを拡充する
   - Qiskit / PennyLane / Cirq それぞれに同等テンプレートを持たせる
   - H2 以外の分子、Grover、QFT、QPE、Amplitude Estimation を追加する
4. 検証を自動化する
   - Bell 状態、H2 VQE、簡易 QAOA のスモークテスト
   - API route の tool call 回帰テスト
   - 生成結果 JSON の schema validation

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
