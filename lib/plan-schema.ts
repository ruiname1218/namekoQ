import { z } from "zod";

export const SuccessCriteriaSchema = z.object({
  primary_metric: z
    .string()
    .describe(
      "成功判定の中心指標。計算タスクならresult dictのキー、調査タスクなら根拠充足・再現性などの評価軸",
    ),
  expected_range: z
    .object({ min: z.number(), max: z.number() })
    .optional()
    .describe("数値指標の場合の妥当な範囲。実行後に照合する"),
  additional_notes: z
    .array(z.string())
    .optional()
    .describe("補足的な成功条件"),
});

export const TaskTypeSchema = z.enum([
  "literature_review",
  "derivation_check",
  "data_analysis",
  "quantum_simulation",
  "paper_reproduction",
  "experiment_design",
  "general_research",
  "other",
]);

export const SourceReferenceSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("計画内で参照する短いID。例: user_prompt, uploaded_pdf_1, image_1"),
  type: z
    .enum([
      "user_prompt",
      "uploaded_file",
      "image",
      "paper",
      "dataset",
      "code",
      "model_knowledge",
      "other",
    ])
    .describe("根拠・入力ソースの種類"),
  title: z.string().optional().describe("論文名、ファイル名、データ名など"),
  locator: z
    .string()
    .optional()
    .describe("ページ番号、図番号、行範囲、添付ファイル名などの位置情報"),
  relevance: z
    .string()
    .min(3)
    .describe("このソースを計画で使う理由"),
});

export const ResearchMethodSchema = z.object({
  approach: z
    .string()
    .min(5)
    .describe("採用する研究・解析アプローチの要約"),
  steps: z
    .array(z.string())
    .min(1)
    .describe("実行する具体的な手順。調査、抽出、計算、比較など"),
  tools_or_models: z
    .array(z.string())
    .optional()
    .describe("使うモデル、Python、量子framework、統計手法など"),
  deliverables: z
    .array(z.string())
    .min(1)
    .describe("最終的に出す成果物。例: 要約、検証表、再現コード、数値結果"),
});

export const ValidationPlanSchema = z.object({
  required_evidence: z
    .array(z.string())
    .min(1)
    .describe("結論に必要な根拠。添付・文献・計算結果・ユーザー指定など"),
  checks: z
    .array(z.string())
    .min(1)
    .describe("整合性、単位、境界条件、統計、再現性などの確認項目"),
  reproducibility: z
    .array(z.string())
    .optional()
    .describe("seed、環境、パラメータ、再実行手順などの再現性要件"),
  uncertainty_analysis: z
    .array(z.string())
    .optional()
    .describe("不確実性、誤差、信頼区間、解釈上の曖昧さの扱い"),
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
  task_type: TaskTypeSchema.describe(
    "タスク種別。量子回路の実行は quantum_simulation、論文再現は paper_reproduction、一般研究は general_research など",
  ),
  research_question: z
    .string()
    .min(5)
    .describe("この実行で答える中心的な研究質問"),
  domain: z
    .string()
    .min(2)
    .describe(
      "問題のドメイン (例: chemistry, finance, optimization, physics, literature, biology, materials, economics, ...)",
    ),
  framework: z
    .enum(["qiskit", "pennylane", "cirq"])
    .optional()
    .describe(
      "量子計算を実行する場合に使うframework。task_type=quantum_simulation/paper_reproductionで量子実装を行う場合は必須",
    ),
  algorithm: z
    .enum(["VQE", "QAOA", "Grover", "Bell", "GHZ", "QFT", "QPE", "AmplitudeEstimation", "other"])
    .optional()
    .describe("量子計算を実行する場合の量子アルゴリズム"),
  problem_summary: z
    .string()
    .min(5)
    .describe("ユーザー要望を1〜2文で要約"),
  algorithm_rationale: z
    .string()
    .min(5)
    .optional()
    .describe("量子アルゴリズムまたは解析手法を選んだ理由"),
  sources_used: z
    .array(SourceReferenceSchema)
    .min(1)
    .describe("計画で参照する入力・根拠。外部資料が無い場合も user_prompt を含める"),
  method: ResearchMethodSchema.describe(
    "汎用研究計画としての方法。量子タスクでも必ず記入する",
  ),
  parameters: PlanParametersSchema.describe(
    "問題依存のパラメータ。汎用フィールド + custom に自由記述",
  ),
  qubits_estimate: z
    .number()
    .int()
    .min(1)
    .max(16)
    .optional()
    .describe("量子計算を実行する場合の使用予定 qubit 数 (シミュレータ上限のため 16以下)"),
  expected_runtime_sec: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .describe("予想実行時間 (秒)。Pythonシミュレーションのタイムアウトは120秒"),
  success_criteria: SuccessCriteriaSchema.describe(
    "実行後に成功判定するための基準",
  ),
  expected_output_keys: z
    .array(z.string())
    .min(1)
    .describe(
      "最終出力またはPython print(dict)で出す予定のキー・セクション一覧 (例: ['answer', 'evidence', 'limitations'] または ['energy', 'params'])",
    ),
  validation_plan: ValidationPlanSchema.describe(
    "根拠・計算・再現性をどう検証するか。研究用途では常に具体化する",
  ),
  uncertainty: z
    .array(z.string())
    .min(1)
    .describe("予想される不確実性、誤差要因、曖昧さ"),
  limitations: z
    .array(z.string())
    .min(1)
    .describe("この実行計画だけでは言えないこと、制約、外部データ不足"),
  research_validation: ResearchValidationSchema.optional().describe(
    "研究精度モードまたは論文レベル問題で必ず記入する検証プロトコル",
  ),
});

export type Plan = z.infer<typeof PlanSchema>;
