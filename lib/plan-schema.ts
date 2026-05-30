import { z } from "zod";

export const SuccessCriteriaSchema = z.object({
  primary_metric: z
    .string()
    .describe("実行結果のdictから取り出すキー (例: ground_state_energy_Ha)"),
  expected_range: z
    .object({ min: z.number(), max: z.number() })
    .optional()
    .describe("primary_metric の妥当な範囲。実行後に照合する"),
  additional_notes: z
    .array(z.string())
    .optional()
    .describe("補足的な成功条件"),
});

export const PlanParametersSchema = z.object({
  shots: z
    .number()
    .int()
    .min(1)
    .max(20000)
    .optional()
    .describe("測定ショット数"),
  optimizer: z
    .enum(["COBYLA", "SPSA", "L_BFGS_B"])
    .optional()
    .describe("古典最適化アルゴリズム"),
  max_iterations: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("最適化の最大反復回数"),
  custom: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("ドメイン固有の任意パラメータ (例: {molecule: 'H2', bond_length: 0.735, n_assets: 3})"),
});

export const ResearchValidationSchema = z.object({
  assumptions: z
    .array(z.string())
    .min(1)
    .describe("論文レベルの再現性に影響する前提・単純化・固定値"),
  approximation_strategy: z
    .string()
    .min(5)
    .describe("フルスケール問題を直接扱えない場合の縮小・近似・代理問題の方針"),
  baseline_methods: z
    .array(z.string())
    .min(1)
    .describe("結果比較に使う古典計算、厳密対角化、既知解、解析的 sanity check など"),
  validation_checks: z
    .array(z.string())
    .min(1)
    .describe("実行後に確認する収束性、物理量、制約充足、seed差などの検証項目"),
  failure_modes: z
    .array(z.string())
    .min(1)
    .describe("この実験で誤った結論につながり得る失敗モード"),
});

export const PlanSchema = z.object({
  domain: z
    .string()
    .min(2)
    .describe("問題のドメイン (例: chemistry, finance, optimization, physics, ...)"),
  framework: z
    .enum(["qiskit", "pennylane", "cirq"])
    .describe("コード生成に使う量子計算フレームワーク"),
  algorithm: z
    .enum(["VQE", "QAOA", "Grover", "Bell", "GHZ", "QFT", "QPE", "AmplitudeEstimation", "other"])
    .describe("採用する量子アルゴリズム"),
  problem_summary: z
    .string()
    .min(5)
    .describe("ユーザー要望を1〜2文で要約"),
  algorithm_rationale: z
    .string()
    .min(5)
    .describe("なぜこのアルゴリズムを選んだか"),
  parameters: PlanParametersSchema.describe(
    "問題依存のパラメータ。汎用フィールド + custom に自由記述",
  ),
  qubits_estimate: z
    .number()
    .int()
    .min(1)
    .max(16)
    .describe("使用予定 qubit 数 (シミュレータ上限のため 16以下)"),
  expected_runtime_sec: z
    .number()
    .int()
    .min(1)
    .max(120)
    .describe("予想実行時間 (秒)。Pythonシミュレーションのタイムアウトは120秒"),
  success_criteria: SuccessCriteriaSchema.describe(
    "実行後に成功判定するための基準",
  ),
  expected_output_keys: z
    .array(z.string())
    .min(1)
    .describe(
      "Python print(dict) で出力する予定のキー一覧 (例: ['energy', 'params'])",
    ),
  research_validation: ResearchValidationSchema.optional().describe(
    "研究精度モードまたは論文レベル問題で必ず記入する検証プロトコル",
  ),
});

export type Plan = z.infer<typeof PlanSchema>;
