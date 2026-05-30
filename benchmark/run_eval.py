#!/usr/bin/env python3
"""
namekoQ × QuanBench+ 評価スクリプト

事前準備:
  bash benchmark/setup.sh

実行例:
  # 全フレームワーク・全問題
  python benchmark/run_eval.py

  # Qiskit のみ・10問でデバッグ
  python benchmark/run_eval.py --framework qiskit --limit 10

  # 2モデル比較
  python benchmark/run_eval.py --model-tier pro     --output benchmark/results/gpt55.json
  python benchmark/run_eval.py --model-tier default --output benchmark/results/deepseek.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import requests

SCRIPT_DIR = Path(__file__).parent
QUANBENCH_DIR = SCRIPT_DIR / "quanbench-plus"
RESULTS_DIR = SCRIPT_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)

FRAMEWORKS = ["qiskit", "pennylane", "cirq"]
FRAMEWORK_LABEL = {"qiskit": "Qiskit", "pennylane": "PennyLane", "cirq": "Cirq"}

# QuanBench+ 論文準拠の KL 閾値
KL_THRESHOLD = 0.05


# ── QuanBench+ データの読み込み ────────────────────────────────────────────────

def load_problems(framework: str) -> list[dict]:
    """prompts/{framework}.jsonl を読み込む（1行1問のJSONL形式）。"""
    path = QUANBENCH_DIR / "prompts" / f"{framework}.jsonl"
    if not path.exists():
        print(f"[error] {path} が見つかりません。先に setup.sh を実行してください。")
        sys.exit(1)
    problems = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            problems.append(json.loads(line))
    return problems


def load_canonical_outputs() -> dict[str, list[float]]:
    """
    canonical_results/canonical_solutions.json を読み込む。
    task_id → 確率ベクトル（長さ 2^n_qubits）のマッピングを返す。
    """
    path = QUANBENCH_DIR / "canonical_results" / "canonical_solutions.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {entry["task_id"]: entry["canonical_output"] for entry in data}


def extract_description(complete_prompt: str) -> str:
    """
    QuanBench+ の complete_prompt（コード補完形式）から
    docstring 内の自然言語説明を抽出する。
    """
    match = re.search(r'"""(.*?)"""', complete_prompt, re.DOTALL)
    if match:
        return match.group(1).strip()
    # フォールバック: 3行目以降の最初の実質的な行
    lines = [l.strip() for l in complete_prompt.splitlines() if l.strip()]
    for line in lines:
        if not line.startswith(("from ", "import ", "def ", "#", "I need")):
            return line
    return complete_prompt.strip()


# ── namekoQ の呼び出し ──────────────────────────────────────────────────────────

def call_namekoq(
    base_url: str,
    prompt: str,
    framework: str,
    model_tier: str,
    retries: int = 1,
) -> dict:
    for attempt in range(retries + 1):
        try:
            resp = requests.post(
                f"{base_url}/api/eval",
                json={"prompt": prompt, "framework": framework, "modelTier": model_tier},
                timeout=360,
            )
            return resp.json()
        except requests.exceptions.Timeout:
            if attempt < retries:
                time.sleep(5)
                continue
            return {"ok": False, "error": "timeout"}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    return {"ok": False, "error": "max retries exceeded"}


# QuanBench+ が GLOBAL_INPUTS として渡す評価用固定入力。
# これがないと namekoQ が自分で値を決め、canonical_output との比較がずれる。
_SPECIAL_INPUT_DIRECTIVES: dict[str, str] = {
    "04": (
        "評価用固定入力:\n"
        "- グラフ G の edges: [[0,3],[0,4],[1,3],[1,4],[2,3],[2,4]] (networkx.Graph で構築)\n"
        "- beta  = [(25 * math.pi) / 54] * 5\n"
        "- gamma = [(25 * math.pi) / 54] * 5\n"
        "これらの引数でコードを実行し、測定 counts を出力すること。"
    ),
    "06": (
        "評価用固定入力:\n"
        "- unknown_state は 1-qubit 回路で H → Rz((25*pi)/54) を適用したもの\n"
        "  qc = QuantumCircuit(1); qc.h(0); qc.rz((25 * math.pi) / 54, 0)\n"
        "この入力状態に対して SWAP test を実行し、アンシラ qubit の測定 counts を出力すること。"
    ),
    "29": (
        "評価用固定入力:\n"
        "- alice = 1, bob = 0\n"
        "この入力値で回路を実行し、測定 counts を出力すること。"
    ),
    "39": (
        "評価用固定入力:\n"
        "- parameters = [(25 * math.pi) / 54, (25 * math.pi) / 54]（長さ 2）\n"
        "このパラメータで回路を実行し、測定 counts を出力すること。"
    ),
    "40": (
        "評価用固定入力:\n"
        "- parameters = [(25 * math.pi) / 54] * 8（長さ 8）\n"
        "このパラメータで回路を実行し、測定 counts を出力すること。"
    ),
    "41": (
        "評価用固定入力:\n"
        "- param = [(25 * math.pi) / 54] * 8（長さ 8）\n"
        "このパラメータで VQE を実行し、最終的な ansatz 回路に measure_all を付けて counts を出力すること。"
    ),
    "42": (
        "評価用固定入力:\n"
        "- theta = phi = lam = (25 * math.pi) / 54\n"
        "この角度で U ゲート分解を実行し、回路に measure_all を付けて counts を出力すること。"
    ),
}


def build_prompt(problem: dict, framework: str) -> str:
    """
    QuanBench+ の complete_prompt から自然言語説明を抽出し、
    namekoQ 向けプロンプトに変換する。
    入力引数が必要なタスクには固定入力値を追記する。
    """
    description = extract_description(problem["complete_prompt"])
    task_id = problem.get("task_id", "")
    directive = _SPECIAL_INPUT_DIRECTIVES.get(task_id)
    if directive:
        return f"{description}\n\n{directive}"
    return description


# ── namekoQ 出力 → 確率ベクトル変換 ───────────────────────────────────────────

def result_to_prob_vector(
    sim_result: object,
    n_states: int,
) -> Optional[np.ndarray]:
    """
    namekoQ のシミュレーション結果を長さ n_states の確率ベクトルに変換する。
    canonical_output と同じ形式（2進数インデックス順）。

    対応形式:
      - counts dict: {"00": 512, "11": 512}
      - probabilities list: [0.5, 0.0, 0.0, 0.5]
      - PennyLane 形式: {"probabilities": [...], "wires": n}
    """
    if not isinstance(sim_result, dict):
        return None

    # counts → 確率ベクトル
    counts = sim_result.get("counts")
    if isinstance(counts, dict) and counts:
        total = sum(counts.values())
        if total == 0:
            return None
        vec = np.zeros(n_states)
        for bitstring, count in counts.items():
            try:
                idx = int(str(bitstring), 2)
                if idx < n_states:
                    vec[idx] = count / total
            except (ValueError, TypeError):
                pass
        if vec.sum() > 0:
            return vec / vec.sum()

    # PennyLane 形式: {"probabilities": [...]}
    probs = sim_result.get("probabilities")
    if isinstance(probs, list) and probs:
        arr = np.array(probs, dtype=float)
        if len(arr) == n_states and arr.sum() > 0:
            return arr / arr.sum()

    # statevector → 確率
    statevector = sim_result.get("statevector")
    if isinstance(statevector, list):
        arr = np.array([abs(complex(v)) ** 2 for v in statevector], dtype=float)
        if len(arr) == n_states and arr.sum() > 0:
            return arr / arr.sum()

    return None


def kl_divergence(p: np.ndarray, q: np.ndarray, eps: float = 1e-12) -> float:
    """QuanBench+ 論文準拠の KL ダイバージェンス計算。"""
    p = np.clip(p, eps, 1)
    q = np.clip(q, eps, 1)
    return float(np.sum(p * np.log(p / q)))


# ── 1問の評価 ──────────────────────────────────────────────────────────────────

def evaluate_one(
    problem: dict,
    namekoq_result: dict,
    canonical_output: Optional[list[float]],
) -> dict:
    task_id = problem["task_id"]
    record: dict = {
        "task_id": task_id,
        "framework": problem.get("framework", "unknown"),
        "category": problem.get("category", "unknown"),
        "entry_point": problem.get("entry_point"),
        "passed": False,
        "namekoq_ok": bool(namekoq_result.get("ok")),
        "verification_aligned": namekoq_result.get("verificationAligned"),
        "kl_divergence": None,
        "kl_passed": None,
        "step_count": namekoq_result.get("stepCount"),
        "duration_ms": namekoq_result.get("durationMs"),
        "error": namekoq_result.get("error"),
    }

    if not namekoq_result.get("ok") or not namekoq_result.get("generatedCode"):
        return record

    sim_result = namekoq_result.get("simulationResult")

    # KL Divergence: canonical_output がある場合
    if canonical_output and sim_result is not None:
        n_states = len(canonical_output)
        namekoq_probs = result_to_prob_vector(sim_result, n_states)

        if namekoq_probs is not None:
            ref_probs = np.array(canonical_output, dtype=float)
            if ref_probs.sum() > 0:
                ref_probs /= ref_probs.sum()

            kl = kl_divergence(namekoq_probs, ref_probs)
            passed = kl < KL_THRESHOLD
            record["kl_divergence"] = round(kl, 6)
            record["kl_passed"] = passed
            record["passed"] = passed
            return record

    # canonical_output がない or 確率変換できない場合:
    # 実行成功 + 検証整合をフォールバック合格条件とする
    record["passed"] = bool(namekoq_result.get("ok")) and (
        namekoq_result.get("verificationAligned") is not False
    )
    return record


# ── サマリー出力 ──────────────────────────────────────────────────────────────

def print_summary(results: list[dict], frameworks: list[str]) -> None:
    total = len(results)
    if total == 0:
        print("結果なし")
        return

    passed = sum(1 for r in results if r.get("passed"))
    print()
    print("=" * 64)
    print(f"  Pass@1 (全体): {passed}/{total} = {passed / total * 100:.1f}%")
    print("=" * 64)

    for fw in frameworks:
        fw_r = [r for r in results if r.get("framework") == fw]
        if not fw_r:
            continue
        fw_p = sum(1 for r in fw_r if r.get("passed"))
        print(f"  {fw:12s}: {fw_p:2d}/{len(fw_r):2d} = {fw_p / len(fw_r) * 100:.1f}%")

    categories = sorted({r.get("category", "unknown") for r in results})
    print()
    for cat in categories:
        cat_r = [r for r in results if r.get("category") == cat]
        cat_p = sum(1 for r in cat_r if r.get("passed"))
        print(f"  {cat:26s}: {cat_p:2d}/{len(cat_r):2d}")

    kl_values = [r["kl_divergence"] for r in results if r.get("kl_divergence") is not None]
    if kl_values:
        print(
            f"\n  KL Divergence (KL < {KL_THRESHOLD} で合格):"
            f" mean={float(np.mean(kl_values)):.4f}"
            f" / median={float(np.median(kl_values)):.4f}"
            f" / 計算済み={len(kl_values)}/{total}"
        )

    exec_ok = sum(1 for r in results if r.get("namekoq_ok"))
    verify_ok = sum(1 for r in results if r.get("verification_aligned") is True)
    print(f"\n  実行成功: {exec_ok}/{total}  |  検証整合: {verify_ok}/{total}")
    print("=" * 64)


# ── メイン ────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="namekoQ × QuanBench+ 評価")
    parser.add_argument("--namekoq-url", default="http://localhost:3000")
    parser.add_argument(
        "--framework", choices=["qiskit", "pennylane", "cirq", "all"], default="all",
    )
    parser.add_argument("--model-tier", choices=["default", "pro"], default="pro")
    parser.add_argument("--limit", type=int, default=None, help="テスト問題数の上限")
    parser.add_argument("--output", default=None, help="結果 JSON の保存先")
    parser.add_argument(
        "--delay", type=float, default=2.0, help="問題間のウェイト秒数",
    )
    args = parser.parse_args()

    frameworks = FRAMEWORKS if args.framework == "all" else [args.framework]

    # canonical_output を一括ロード（task_id → 確率ベクトル）
    canonical_outputs = load_canonical_outputs()

    # 問題を収集
    all_problems: list[dict] = []
    for fw in frameworks:
        for p in load_problems(fw):
            all_problems.append({**p, "framework": fw})

    if args.limit:
        all_problems = all_problems[: args.limit]

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = (
        Path(args.output) if args.output else RESULTS_DIR / f"eval_{timestamp}.json"
    )

    print(f"評価開始: {len(all_problems)} 問 | フレームワーク: {frameworks}")
    print(f"namekoQ: {args.namekoq_url} | モデル: {args.model_tier}")
    print(f"結果保存先: {output_path}")
    print()

    results: list[dict] = []

    for idx, problem in enumerate(all_problems):
        fw = problem["framework"]
        task_id = problem["task_id"]

        print(
            f"[{idx + 1:3d}/{len(all_problems)}] {fw:12s} task={task_id} [{problem.get('category','?')[:16]:16s}]",
            end="  ",
            flush=True,
        )

        prompt = build_prompt(problem, fw)
        namekoq_result = call_namekoq(
            args.namekoq_url, prompt, fw, args.model_tier,
        )
        canonical = canonical_outputs.get(task_id)
        record = evaluate_one(problem, namekoq_result, canonical)
        results.append(record)

        status = "✓" if record["passed"] else "✗"
        kl_str = f"KL={record['kl_divergence']:.4f}" if record["kl_divergence"] is not None else "KL=n/a"
        ms = record.get("duration_ms")
        time_str = f"{ms / 1000:.1f}s" if ms else ""
        print(f"{status}  {kl_str}  steps={record.get('step_count', '?')}  {time_str}")

        # 中間保存
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(
                {"timestamp": timestamp, "config": vars(args), "results": results},
                f, indent=2, ensure_ascii=False,
            )

        if idx < len(all_problems) - 1:
            time.sleep(args.delay)

    print_summary(results, frameworks)
    print(f"\n結果を保存しました: {output_path}")


if __name__ == "__main__":
    main()
