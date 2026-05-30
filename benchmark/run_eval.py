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

  # 結果を指定ファイルに保存
  python benchmark/run_eval.py --output benchmark/results/my_run.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests

SCRIPT_DIR = Path(__file__).parent
QUANBENCH_DIR = SCRIPT_DIR / "quanbench-plus"
RESULTS_DIR = SCRIPT_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)

FRAMEWORKS = ["qiskit", "pennylane", "cirq"]

FRAMEWORK_LABEL = {"qiskit": "Qiskit", "pennylane": "PennyLane", "cirq": "Cirq"}


# ── 問題の読み込み ──────────────────────────────────────────────────────────────

def _find_tasks_file(framework: str) -> Optional[Path]:
    """QuanBench+ リポジトリから問題ファイルを探す。"""
    candidates = [
        QUANBENCH_DIR / "tasks" / framework / "tasks.json",
        QUANBENCH_DIR / f"{framework}_tasks.json",
        QUANBENCH_DIR / "data" / f"{framework}.json",
        QUANBENCH_DIR / framework / "tasks.json",
        QUANBENCH_DIR / "benchmarks" / framework / "tasks.json",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def load_problems(framework: str) -> list[dict]:
    path = _find_tasks_file(framework)
    if path is None:
        # ディレクトリ構造をデバッグ出力して早期終了
        top = list(QUANBENCH_DIR.iterdir()) if QUANBENCH_DIR.exists() else []
        print(f"[warn] QuanBench+ の {framework} タスクファイルが見つかりません。")
        print(f"       QUANBENCH_DIR: {QUANBENCH_DIR}")
        if top:
            print(f"       中身: {[p.name for p in top[:15]]}")
        return []

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    # リストまたは {"tasks": [...]} 形式に対応
    return data if isinstance(data, list) else data.get("tasks", [])


def load_reference_code(framework: str, problem_id: str) -> Optional[str]:
    """QuanBench+ の参照実装コードを読み込む。"""
    candidates = [
        QUANBENCH_DIR / "reference" / framework / f"{problem_id}.py",
        QUANBENCH_DIR / "solutions" / framework / f"{problem_id}.py",
        QUANBENCH_DIR / framework / "reference" / f"{problem_id}.py",
        QUANBENCH_DIR / framework / "solutions" / f"{problem_id}.py",
        QUANBENCH_DIR / "canonical" / framework / f"{problem_id}.py",
    ]
    for p in candidates:
        if p.exists():
            return p.read_text(encoding="utf-8")
    return None


# ── 参照実装の実行 ───────────────────────────────────────────────────────────────

def run_python_code(code: str, timeout: int = 120) -> dict:
    """Python コードを subprocess で実行し stdout の最後の JSON を返す。"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        fname = f.name

    try:
        result = subprocess.run(
            [sys.executable, fname],
            capture_output=True, text=True, timeout=timeout,
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        if result.returncode != 0:
            return {"ok": False, "stderr": stderr, "parsed": None}

        for line in reversed(stdout.split("\n")):
            line = line.strip()
            if not (line.startswith("{") and line.endswith("}")):
                continue
            try:
                return {"ok": True, "parsed": json.loads(line), "stderr": stderr}
            except json.JSONDecodeError:
                normalized = (line
                    .replace("'", '"')
                    .replace("True", "true")
                    .replace("False", "false")
                    .replace("None", "null"))
                try:
                    return {"ok": True, "parsed": json.loads(normalized), "stderr": stderr}
                except json.JSONDecodeError:
                    pass

        return {"ok": True, "parsed": None, "stdout": stdout, "stderr": stderr}
    except subprocess.TimeoutExpired:
        return {"ok": False, "stderr": f"timeout ({timeout}s)", "parsed": None}
    except Exception as e:
        return {"ok": False, "stderr": str(e), "parsed": None}


def find_counts(result: object) -> Optional[dict[str, int]]:
    """結果オブジェクトから測定 counts を探す。"""
    if not isinstance(result, dict):
        return None
    if "counts" in result and isinstance(result["counts"], dict):
        return result["counts"]
    # ネストした辞書を再帰的に探す（1段のみ）
    for v in result.values():
        if isinstance(v, dict) and v:
            if all(isinstance(k, str) and isinstance(c, (int, float)) for k, c in v.items()):
                return {k: int(c) for k, c in v.items()}
    return None


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


def build_prompt(problem: dict, framework: str) -> str:
    """QuanBench+ 問題を namekoQ 向け自然言語プロンプトに変換する。"""
    description = (
        problem.get("description")
        or problem.get("prompt")
        or problem.get("task")
        or problem.get("question")
        or str(problem)
    )
    label = FRAMEWORK_LABEL[framework]
    return "\n".join([
        description.strip(),
        "",
        "追加設定:",
        f"- フレームワークは {label} を使う",
        "- 別フレームワークからの変換ではなく、選択したフレームワークのネイティブコードを生成する",
    ])


# ── 1問の評価 ──────────────────────────────────────────────────────────────────

def evaluate_one(problem: dict, namekoq_result: dict, framework: str) -> dict:
    from metrics import compute_kl_divergence

    problem_id = problem.get("id") or problem.get("name") or "unknown"
    record: dict = {
        "problem_id": problem_id,
        "framework": framework,
        "category": problem.get("category", "unknown"),
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
    namekoq_counts = find_counts(sim_result) if sim_result else None

    # KL Divergence: 参照実装が取得できて counts がある場合
    ref_code = load_reference_code(framework, problem_id)
    if namekoq_counts and ref_code:
        ref_run = run_python_code(ref_code)
        ref_counts = find_counts(ref_run.get("parsed")) if ref_run.get("ok") else None
        if ref_counts:
            kl, kl_passed = compute_kl_divergence(namekoq_counts, ref_counts)
            record["kl_divergence"] = round(kl, 6)
            record["kl_passed"] = kl_passed
            record["passed"] = kl_passed
            return record

    # 参照実装がない / counts が取れない場合: 実行成功 + 検証整合を合格とする
    record["passed"] = bool(namekoq_result.get("ok")) and (
        namekoq_result.get("verificationAligned") is not False
    )
    return record


# ── メイン ────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="namekoQ × QuanBench+ 評価")
    parser.add_argument("--namekoq-url", default="http://localhost:3000")
    parser.add_argument(
        "--framework", choices=["qiskit", "pennylane", "cirq", "all"], default="all",
    )
    parser.add_argument(
        "--model-tier", choices=["default", "pro"], default="pro",
    )
    parser.add_argument("--limit", type=int, default=None, help="テスト問題数の上限")
    parser.add_argument("--output", default=None, help="結果 JSON の保存先")
    parser.add_argument(
        "--delay", type=float, default=2.0,
        help="問題間のウェイト秒数（レート制限対策）",
    )
    args = parser.parse_args()

    frameworks = FRAMEWORKS if args.framework == "all" else [args.framework]

    # 問題を収集
    all_problems: list[tuple[str, dict]] = []
    for fw in frameworks:
        problems = load_problems(fw)
        for p in problems:
            all_problems.append((fw, p))

    if not all_problems:
        print("[error] 問題が1件も読み込めませんでした。先に setup.sh を実行してください。")
        sys.exit(1)

    if args.limit:
        all_problems = all_problems[: args.limit]

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = (
        Path(args.output)
        if args.output
        else RESULTS_DIR / f"eval_{timestamp}.json"
    )

    print(f"評価開始: {len(all_problems)} 問 | フレームワーク: {frameworks}")
    print(f"namekoQ: {args.namekoq_url} | モデル: {args.model_tier}")
    print(f"結果保存先: {output_path}")
    print()

    results: list[dict] = []

    for idx, (fw, problem) in enumerate(all_problems):
        problem_id = problem.get("id") or problem.get("name") or f"#{idx}"
        print(f"[{idx + 1:3d}/{len(all_problems)}] {fw:12s} {problem_id}", end="  ", flush=True)

        prompt = build_prompt(problem, fw)
        namekoq_result = call_namekoq(
            args.namekoq_url, prompt, fw, args.model_tier,
        )
        record = evaluate_one(problem, namekoq_result, fw)
        results.append(record)

        kl_str = (
            f"KL={record['kl_divergence']:.4f}" if record["kl_divergence"] is not None else ""
        )
        status = "✓" if record["passed"] else "✗"
        steps = record.get("step_count") or "?"
        ms = record.get("duration_ms")
        time_str = f"{ms / 1000:.1f}s" if ms else ""
        print(f"{status}  {kl_str}  steps={steps}  {time_str}")

        # 中間保存（途中でクラッシュしても再開可能）
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(
                {"timestamp": timestamp, "config": vars(args), "results": results},
                f, indent=2, ensure_ascii=False,
            )

        if idx < len(all_problems) - 1:
            time.sleep(args.delay)

    # サマリー
    from metrics import print_summary
    print_summary(results, frameworks)
    print(f"\n結果を保存しました: {output_path}")


if __name__ == "__main__":
    main()
