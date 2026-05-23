import { z } from "zod";

export const SuccessCriteriaSchema = z.object({
  primary_metric: z
    .string()
    .describe("Key to read from the execution result dict, for example ground_state_energy_Ha"),
  expected_range: z
    .object({ min: z.number(), max: z.number() })
    .optional()
    .describe("Valid range for primary_metric; checked after execution"),
  additional_notes: z
    .array(z.string())
    .optional()
    .describe("Additional success criteria"),
});

export const PlanParametersSchema = z.object({
  shots: z
    .number()
    .int()
    .min(1)
    .max(20000)
    .optional()
    .describe("Number of measurement shots"),
  optimizer: z
    .enum(["COBYLA", "SPSA", "L_BFGS_B"])
    .optional()
    .describe("Classical optimization algorithm"),
  max_iterations: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Maximum number of optimizer iterations"),
  custom: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Domain-specific parameters, for example {molecule: 'H2', bond_length: 0.735, n_assets: 3}"),
});

export const PlanSchema = z.object({
  domain: z
    .string()
    .min(2)
    .describe("Problem domain, for example chemistry, finance, optimization, physics, ..."),
  framework: z
    .enum(["qiskit", "pennylane", "cirq"])
    .describe("Quantum computing framework used for code generation"),
  algorithm: z
    .enum(["VQE", "QAOA", "Grover", "Bell", "GHZ", "QFT", "QPE", "AmplitudeEstimation", "other"])
    .describe("Selected quantum algorithm"),
  problem_summary: z
    .string()
    .min(5)
    .describe("Summarize the user request in one or two sentences"),
  algorithm_rationale: z
    .string()
    .min(5)
    .describe("Why this algorithm was selected"),
  parameters: PlanParametersSchema.describe(
    "Problem-specific parameters, using the common fields plus free-form custom values",
  ),
  qubits_estimate: z
    .number()
    .int()
    .min(1)
    .max(16)
    .describe("Estimated number of qubits to use; keep at 16 or fewer for local simulation"),
  expected_runtime_sec: z
    .number()
    .int()
    .min(1)
    .max(120)
    .describe("Expected runtime in seconds; the Python simulation timeout is 60 seconds"),
  success_criteria: SuccessCriteriaSchema.describe(
    "Criteria used to judge whether the run succeeded after execution",
  ),
  expected_output_keys: z
    .array(z.string())
    .min(1)
    .describe(
      "Keys expected in the final Python print(dict) output, for example ['energy', 'params']",
    ),
});

export type Plan = z.infer<typeof PlanSchema>;
