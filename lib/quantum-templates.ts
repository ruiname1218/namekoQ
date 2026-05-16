/**
 * 量子アルゴリズムテンプレート集
 * LLMがコード生成する際の "参照実装" として system prompt に埋め込む。
 * これによりQiskit APIの幻覚(hallucination)を抑制する。
 */

export const BELL_STATE_TEMPLATE = `
# Bell State (動作確認用 / Hello Quantum)
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])

simulator = AerSimulator()
result = simulator.run(qc, shots=1024).result()
counts = result.get_counts()
print({"counts": counts})
`.trim();

export const H2_VQE_TEMPLATE = `
# H2分子の基底状態エネルギー (VQE / Hardware-Efficient Ansatz)
import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter
from qiskit.quantum_info import SparsePauliOp
from qiskit_aer.primitives import EstimatorV2 as Estimator
from scipy.optimize import minimize

# H2 @ bond length 0.735 Å の Jordan-Wigner変換済みハミルトニアン (2 qubit reduction後)
# 参考: Kandala et al., Nature 549, 242 (2017)
H = SparsePauliOp.from_list([
    ("II", -1.0523732),
    ("IZ",  0.39793742),
    ("ZI", -0.39793742),
    ("ZZ", -0.0112801),
    ("XX",  0.18093119),
])

theta = [Parameter(f"θ{i}") for i in range(4)]
ansatz = QuantumCircuit(2)
ansatz.ry(theta[0], 0); ansatz.ry(theta[1], 1)
ansatz.cx(0, 1)
ansatz.ry(theta[2], 0); ansatz.ry(theta[3], 1)

estimator = Estimator()

def energy(params):
    job = estimator.run([(ansatz, H, params)])
    return float(job.result()[0].data.evs)

x0 = np.random.uniform(0, 2*np.pi, size=4)
res = minimize(energy, x0, method="COBYLA", options={"maxiter": 100})
print({"ground_state_energy_Ha": float(res.fun), "params": res.x.tolist()})
`.trim();

export const PORTFOLIO_QAOA_TEMPLATE = `
# 組合せ最適化 (QAOA / Markowitz mean-variance)
# n項目から k 個を選ぶ離散選択問題を量子で解く
import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter
from qiskit.quantum_info import SparsePauliOp
from qiskit_aer.primitives import SamplerV2 as Sampler
from qiskit_aer.primitives import EstimatorV2 as Estimator
from scipy.optimize import minimize

# 例: 3資産, 期待リターン μ, 共分散 Σ, リスク回避係数 q, 選択数 k=2
mu = np.array([0.10, 0.20, 0.15])
sigma = np.array([
    [0.10, 0.02, 0.04],
    [0.02, 0.15, 0.06],
    [0.04, 0.06, 0.12],
])
q = 0.5; k = 2; n = len(mu); penalty = 1.0

# QUBO -> Ising への変換は省略簡略版: 各資産を1qubitに割当
# H_cost = -μ·x + q·xᵀΣx + penalty·(Σx - k)²
def build_hamiltonian():
    ops = []
    # 線形項 + ペナルティ
    for i in range(n):
        coef = -0.5*mu[i] + q*sigma[i, i]*0.5 + penalty*(1 - 2*k)*0.5
        ops.append(("I"*(n-1-i) + "Z" + "I"*i, coef))
    # 二次項
    for i in range(n):
        for j in range(i+1, n):
            coef = q*sigma[i, j]*0.5 + penalty*0.5
            s = list("I"*n); s[n-1-i] = "Z"; s[n-1-j] = "Z"
            ops.append(("".join(s), coef))
    return SparsePauliOp.from_list(ops)

H = build_hamiltonian()
p = 1  # QAOA layers
gamma = [Parameter(f"γ{i}") for i in range(p)]
beta  = [Parameter(f"β{i}") for i in range(p)]

qc = QuantumCircuit(n)
for q_ in range(n): qc.h(q_)
for layer in range(p):
    for op, coef in H.to_list():
        # 簡略: ZZ/Z項のみ展開
        zs = [i for i, c in enumerate(reversed(op)) if c == "Z"]
        if len(zs) == 1:
            qc.rz(2*coef.real*gamma[layer], zs[0])
        elif len(zs) == 2:
            qc.cx(zs[0], zs[1]); qc.rz(2*coef.real*gamma[layer], zs[1]); qc.cx(zs[0], zs[1])
    for q_ in range(n):
        qc.rx(2*beta[layer], q_)

estimator = Estimator()

def cost(params):
    g, b = params[:p], params[p:]
    job = estimator.run([(qc, H, [*g, *b])])
    return float(job.result()[0].data.evs)

x0 = np.random.uniform(0, np.pi, size=2*p)
res = minimize(cost, x0, method="COBYLA", options={"maxiter": 80})

# サンプリングして最頻ビット列を解とする
qc_measure = qc.copy(); qc_measure.measure_all()
sampler = Sampler()
sample = sampler.run([(qc_measure, [*res.x[:p], *res.x[p:]])], shots=2048).result()
counts = sample[0].data.meas.get_counts()
best = max(counts.items(), key=lambda kv: kv[1])[0]
selection = [i for i, c in enumerate(reversed(best)) if c == "1"]
print({"selected_assets": selection, "expectation": float(res.fun), "counts_top": dict(sorted(counts.items(), key=lambda kv: -kv[1])[:5])})
`.trim();

export const TEMPLATES = {
  bell_state: {
    label: "Bell状態 (動作確認)",
    domain: "general",
    description: "もつれ状態の最小例。Qiskitが動くかの確認用。",
    code: BELL_STATE_TEMPLATE,
  },
  h2_vqe: {
    label: "H2分子 VQE",
    domain: "chemistry",
    description: "水素分子の基底状態エネルギー計算。化学ドメインの代表例。",
    code: H2_VQE_TEMPLATE,
  },
  portfolio_qaoa: {
    label: "ポートフォリオ QAOA",
    domain: "finance",
    description: "n資産からk個選ぶ離散最適化。金融ドメインの代表例。",
    code: PORTFOLIO_QAOA_TEMPLATE,
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
