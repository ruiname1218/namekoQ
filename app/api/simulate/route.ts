import { z } from "zod";
import { runPythonSimulation } from "@/lib/run-python-simulation";

export const maxDuration = 120;

const SimulateRequestSchema = z.object({
  code: z.string().min(1),
  framework: z.enum(["qiskit", "pennylane", "cirq"]).optional(),
  simulator: z.string().optional(),
  source: z.enum(["source", "openqasm", "converted"]).optional(),
});

export async function POST(req: Request) {
  const started = Date.now();

  try {
    const body = SimulateRequestSchema.parse(await req.json());
    const result = await runPythonSimulation(body.code);

    return Response.json({
      ok: result.ok,
      framework: body.framework ?? null,
      simulator: body.simulator ?? null,
      source: body.source ?? null,
      durationMs: result.durationMs,
      totalMs: Date.now() - started,
      stdout: result.stdout.slice(-8000),
      stderr: result.stderr.slice(-8000),
      parsed: result.parsed ?? null,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        durationMs: Date.now() - started,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        parsed: null,
      },
      { status: 400 },
    );
  }
}
