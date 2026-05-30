#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUANBENCH_DIR="$SCRIPT_DIR/quanbench-plus"

echo "=== QuanBench+ セットアップ ==="

# QuanBench+ をクローン or 更新
if [ ! -d "$QUANBENCH_DIR/.git" ]; then
  echo "QuanBench+ をクローン中..."
  git clone https://github.com/JawadKotaichh/quanbench-plus "$QUANBENCH_DIR"
else
  echo "QuanBench+ を更新中 (git pull)..."
  git -C "$QUANBENCH_DIR" pull --ff-only
fi

# Python 依存
echo ""
echo "Python 依存をインストール中..."
pip install requests scipy numpy qiskit qiskit-aer pennylane cirq

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "実行方法:"
echo "  # namekoQ を起動しておく"
echo "  npm run dev &"
echo ""
echo "  # 全フレームワーク・全問題"
echo "  python benchmark/run_eval.py"
echo ""
echo "  # フレームワーク指定・問題数制限（動作確認用）"
echo "  python benchmark/run_eval.py --framework qiskit --limit 5"
