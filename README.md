# namekoQ

namekoQ is a proof-of-concept AI agent for quantum application generation. It turns a natural-language request into a structured quantum-computing plan, generates executable code, runs a local simulator, checks intent alignment, and returns a researcher-oriented analysis report.

The current branch, `English_version`, keeps the product UI, prompts, generated report structure, tool labels, examples, and README in English.

## Architecture

```text
[User request]
       |
[Next.js App Router UI]
       |
[/api/chat: AI SDK v6 streamText + tool calling]
       |
[Planning -> code generation -> simulation -> verification]
       |
[Python subprocess: Qiskit / PennyLane / Cirq]
       |
[Final code, OpenQASM 2 artifacts, simulation results, analysis report]
```

## Setup

Install Node dependencies:

```bash
npm install
```

Install the local Python simulation stack. Python 3.10 or newer is recommended.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If you use a virtual environment, point `PYTHON_BIN` at that interpreter in `.env.local`.

```bash
PYTHON_BIN=/path/to/namekoQ/.venv/bin/python
```

Configure model keys:

```bash
DEEPSEEK_API_KEY=sk-...
OPENAI_API_KEY=sk-...

# optional
DEEPSEEK_BASE_URL=https://api.deepseek.com
NAMEKOQ_DEEPSEEK_MODEL=deepseek-v4-pro
NAMEKOQ_MODEL=gpt-5.5
```

Run the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Example Requests

- Chemistry: `Compute the H2 molecule ground-state energy with VQE at bond length 0.735 Angstrom.`
- Chemistry scan: `Run a VQE bond-length scan for H2 from 0.5 to 2.0 Angstrom and find the most stable point.`
- Finance: `Solve a portfolio optimization problem with QAOA. Choose 2 assets from 3 assets with expected returns [0.10, 0.20, 0.15], covariance [[0.10,0.02,0.04],[0.02,0.15,0.06],[0.04,0.06,0.12]], risk aversion 0.5, and shots 2048. Return selected assets, top bitstrings, and objective values.`
- Smoke test: `Create and measure a Bell state.`

## Main Features

- Structured planning with domain, framework, algorithm, parameters, qubit estimate, runtime estimate, success criteria, and expected output keys.
- Code generation for Qiskit, PennyLane, or Cirq.
- Local simulation through a Python subprocess with Qiskit Aer, PennyLane, and Cirq-compatible execution paths.
- Direct re-simulation of edited final code or wrapper code generated from edited OpenQASM.
- OpenQASM 2-first final circuit artifacts for broad compatibility with the browser circuit editor.
- Circuit editor support for common gates, parameters, measurement mapping, import/export, undo/redo, and validation.
- Bloch-sphere preview for the pre-measurement circuit state when it can be inferred locally.
- Research-style analysis report with Markdown and JSON export.
- App Builder that turns the final circuit, results, and algorithm intent into a practical single-file HTML app.
- DeepSeek fallback behavior for critic validation when structured response formats are unavailable.

## Important Files

| Path | Role |
| --- | --- |
| `app/page.tsx` | App entry and example request definitions |
| `components/chat.tsx` | Main chat, settings, final output, report, simulator, and app builder UI |
| `components/circuit-editor.tsx` | OpenQASM-compatible circuit editor |
| `components/bloch-sphere.tsx` | Bloch-sphere preview component |
| `app/api/chat/route.ts` | Main AI agent route, tool definitions, simulation tools, verification, and OpenQASM extraction |
| `app/api/simulate/route.ts` | Direct simulation endpoint for edited code |
| `app/api/app-builder/route.ts` | HTML app generation endpoint |
| `lib/system-prompt.ts` | Main agent instructions |
| `lib/critic-prompt.ts` | Intent-alignment critic instructions |
| `lib/plan-schema.ts` | Structured planning schema |
| `lib/quantum-templates.ts` | Reference Qiskit implementations embedded into the prompt |
| `lib/run-python-simulation.ts` | Python subprocess runner with timeout and output limits |

## Current Scope

namekoQ is not a full quantum platform. It is a focused research prototype for natural-language-driven quantum workflow generation. It is strongest for small simulations, educational experiments, early algorithm prototyping, and structured report generation.

The current local execution model runs generated Python on the host machine. Before production or multi-user deployment, execution should be moved to an isolated sandbox with strict import, filesystem, network, timeout, and resource controls.

The included H2 and portfolio examples are intentionally compact reference implementations. Production-grade chemistry workflows should integrate molecular Hamiltonian generation through libraries such as PySCF or qiskit-nature. Production-grade optimization workflows should use a more rigorous QUBO or Ising conversion layer, constraint handling, and benchmark tests.

## Development Notes

- `npm run build` validates the Next.js application.
- Python simulation requires packages from `requirements.txt`.
- Final agent answers are expected to include practical interpretation, assumptions, limitations, and next steps, not only raw simulator output.
- OpenQASM artifacts should prefer OpenQASM 2 unless a downstream tool explicitly supports OpenQASM 3.
