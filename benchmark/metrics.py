"""
QuanBench+ 準拠の評価指標。

- Pass@K  : n サンプル中 c 正解のとき、K サンプルで少なくとも1つ正解する確率
- KL Divergence: 測定分布の比較（閾値 0.05 以下で合格）
- Process Fidelity: ユニタリ行列の類似度（Qiskit のみ）
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from typing import Optional

import numpy as np
from scipy.stats import entropy


# ── Pass@K ────────────────────────────────────────────────────────────────────

def pass_at_k(n: int, c: int, k: int) -> float:
    """Chen et al. (2021) の unbiased estimator。"""
    if n == 0:
        return 0.0
    if n - c < k:
        return 1.0
    return 1.0 - float(np.prod([(n - c - i) / (n - i) for i in range(k)]))


# ── KL Divergence ─────────────────────────────────────────────────────────────

KL_THRESHOLD = 0.05  # QuanBench+ 論文に準拠


def compute_kl_divergence(
    dist1: dict[str, int | float],
    dist2: dict[str, int | float],
    threshold: float = KL_THRESHOLD,
) -> tuple[float, bool]:
    """
    2つの測定分布の KL ダイバージェンスを計算する。

    Returns:
        (kl_value, passed)  passed は kl_value <= threshold のとき True
    """
    all_keys = sorted(set(dist1.keys()) | set(dist2.keys()))
    p = np.array([dist1.get(k, 0) for k in all_keys], dtype=float)
    q = np.array([dist2.get(k, 0) for k in all_keys], dtype=float)

    if p.sum() == 0 or q.sum() == 0:
        return float("inf"), False

    p /= p.sum()
    q /= q.sum()
    # ゼロ除算を避けるスムージング
    q = np.where(q == 0, 1e-10, q)

    kl = float(entropy(p, q))
    return kl, kl <= threshold


# ── Process Fidelity ──────────────────────────────────────────────────────────

_PROCESS_FIDELITY_WRAPPER = """
import json, sys
{code}

try:
    from qiskit.quantum_info import Operator
    op = Operator(FINAL_CIRCUIT)
    print(json.dumps({{"matrix_real": op.data.real.tolist(), "matrix_imag": op.data.imag.tolist()}}))
except Exception as e:
    print(json.dumps({{"error": str(e)}}))
"""


def _get_unitary(code: str, timeout: int = 60) -> Optional[np.ndarray]:
    """Python コードから FINAL_CIRCUIT のユニタリ行列を取得する。"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(_PROCESS_FIDELITY_WRAPPER.format(code=code))
        fname = f.name

    try:
        result = subprocess.run(
            [sys.executable, fname],
            capture_output=True, text=True, timeout=timeout,
        )
        stdout = result.stdout.strip()
        if not stdout:
            return None
        for line in reversed(stdout.split("\n")):
            line = line.strip()
            if line.startswith("{"):
                data = json.loads(line)
                if "error" in data:
                    return None
                real = np.array(data["matrix_real"])
                imag = np.array(data["matrix_imag"])
                return real + 1j * imag
    except Exception:
        pass
    return None


def compute_process_fidelity(
    generated_code: str,
    reference_code: str,
) -> Optional[float]:
    """
    生成コードと参照コードの Process Fidelity を計算する（Qiskit のみ）。

    両コードとも FINAL_CIRCUIT (qiskit.QuantumCircuit) を定義している必要がある。
    計算できない場合は None を返す。
    """
    try:
        from qiskit.quantum_info import Operator, process_fidelity as qk_pf  # noqa: F401
    except ImportError:
        return None

    gen_mat = _get_unitary(generated_code)
    ref_mat = _get_unitary(reference_code)
    if gen_mat is None or ref_mat is None:
        return None

    try:
        from qiskit.quantum_info import Operator, process_fidelity as qk_pf
        return float(qk_pf(Operator(gen_mat), Operator(ref_mat)))
    except Exception:
        return None


# ── サマリー出力 ──────────────────────────────────────────────────────────────

def print_summary(results: list[dict], frameworks: list[str]) -> None:
    total = len(results)
    if total == 0:
        print("結果なし")
        return

    passed = sum(1 for r in results if r.get("passed"))

    print()
    print("=" * 62)
    print(f"  Pass@1 (全体): {passed}/{total} = {passed / total * 100:.1f}%")
    print("=" * 62)

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
        print(f"  {cat:24s}: {cat_p:2d}/{len(cat_r):2d}")

    kl_values = [r["kl_divergence"] for r in results if r.get("kl_divergence") is not None]
    if kl_values:
        print(
            f"\n  KL Divergence: mean={float(np.mean(kl_values)):.4f}"
            f" / median={float(np.median(kl_values)):.4f}"
            f" / passed={sum(1 for r in results if r.get('kl_passed'))} / {len(kl_values)}"
        )

    exec_ok = sum(1 for r in results if r.get("namekoq_ok"))
    verify_ok = sum(1 for r in results if r.get("verification_aligned") is True)
    print(f"\n  実行成功: {exec_ok}/{total}  検証整合: {verify_ok}/{total}")
    print("=" * 62)
