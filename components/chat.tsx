"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo, useRef, useState } from "react";

const chatTransport = new DefaultChatTransport({ api: "/api/chat" });

interface ExampleQuery {
  domain: string;
  text: string;
}

export function Chat(_props: { examples: ExampleQuery[] }) {
  const [input, setInput] = useState("");
  const [framework, setFramework] = useState<"qiskit" | "pennylane" | "cirq">(
    "qiskit",
  );
  const [shots, setShots] = useState("auto");
  const [maxIterations, setMaxIterations] = useState("auto");
  const { messages, sendMessage, status, error } = useChat({
    transport: chatTransport,
  });

  const busy = status === "submitted" || status === "streaming";
  const activity = useMemo(() => getActivity(messages, busy), [messages, busy]);

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({
      text: withAdvancedSettings(text, { framework, shots, maxIterations }),
    });
    setInput("");
  };

  return (
    <div className="grid min-h-[calc(100vh-72px)] grid-cols-1 border-t border-[var(--border)] lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="border-b border-[var(--border)] bg-white p-5 lg:border-b-0 lg:border-r">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex h-full flex-col gap-5"
        >
          <section>
            <PanelLabel>Request</PanelLabel>
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              量子計算で解きたい内容をそのまま入力してください。
            </p>
          </section>

          <section>
            <PanelLabel>Framework</PanelLabel>
            <div className="grid grid-cols-3 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-1">
              {(["qiskit", "pennylane", "cirq"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFramework(item)}
                  disabled={busy}
                  className={[
                    "rounded-sm px-2 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                    framework === item
                      ? "bg-white text-[var(--fg)] shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--fg)]",
                  ].join(" ")}
                >
                  {getFrameworkLabel(item)}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-1 flex-col">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="量子計算で解きたい内容を入力..."
              disabled={busy}
              className="min-h-52 flex-1 resize-none rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 text-base leading-relaxed outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--ink)] disabled:opacity-60"
            />
          </section>

          <details className="rounded-sm border border-[var(--border)] bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--muted)]">
              Advanced
            </summary>
            <div className="flex flex-col gap-4 border-t border-[var(--border)] px-4 py-4">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Shots
                </span>
                <select
                  value={shots}
                  onChange={(e) => setShots(e.target.value)}
                  disabled={busy}
                  className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)] disabled:opacity-60"
                >
                  <option value="auto">Auto</option>
                  <option value="512">512</option>
                  <option value="1024">1,024</option>
                  <option value="2048">2,048</option>
                  <option value="4096">4,096</option>
                  <option value="8192">8,192</option>
                </select>
                <span className="text-xs leading-relaxed text-[var(--muted)]">
                  測定を何回繰り返すか。未指定なら LLM が問題に合わせて決めます。
                </span>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Max iterations
                </span>
                <select
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(e.target.value)}
                  disabled={busy}
                  className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)] disabled:opacity-60"
                >
                  <option value="auto">Auto</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="300">300</option>
                  <option value="500">500</option>
                </select>
                <span className="text-xs leading-relaxed text-[var(--muted)]">
                  VQE/QAOA の古典最適化反復上限。未指定なら LLM が選びます。
                </span>
              </label>
            </div>
          </details>

          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-sm bg-[var(--ink)] px-5 py-4 text-base font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? "Generating" : "Generate"}
          </button>

          {error && (
            <div className="font-mono text-xs text-[var(--muted)]">
              Error: {error.message}
            </div>
          )}
        </form>
      </aside>

      <section className="flex min-w-0 flex-col bg-white">
        <div className="flex min-h-[46vh] flex-1 flex-col">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 lg:p-8">
              {messages.map((m) => (
                <MessageView key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-[var(--border)] p-5 lg:p-8">
          <AgentProgress activity={activity} busy={busy} />
        </div>
      </section>
    </div>
  );
}

type UIMessage = ReturnType<typeof useChat>["messages"][number];

function MessageView({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <article
      className={
        isUser
          ? "self-end max-w-2xl rounded-sm border border-[var(--ink)] bg-[var(--ink)] px-4 py-3 text-sm text-white"
          : "self-start w-full rounded-sm border border-[var(--border)] bg-white p-4 text-sm"
      }
    >
      {!isUser && (
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase text-[var(--muted)]">
          <span className="h-2 w-2 rounded-full bg-[var(--ink)]" />
          namekoQ
        </div>
      )}
      <div className="flex flex-col gap-3">
        {message.parts.map((part, i) => (
          <PartView key={i} part={part} />
        ))}
      </div>
    </article>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-20 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-sm border border-[var(--border)]">
          <div className="h-3 w-3 rounded-full bg-[var(--surface-strong)]" />
        </div>
        <div className="text-base font-medium text-[var(--muted)]">
          Generate a quantum result to see the execution here
        </div>
      </div>
    </div>
  );
}

function PartView({ part }: { part: UIMessage["parts"][number] }) {
  if (part.type === "text") {
    return <div className="whitespace-pre-wrap leading-relaxed">{part.text}</div>;
  }

  if (part.type === "reasoning") {
    return (
      <details className="text-xs text-[var(--muted)]">
        <summary className="cursor-pointer">思考</summary>
        <div className="mt-2 whitespace-pre-wrap">{part.text}</div>
      </details>
    );
  }

  if (part.type.startsWith("tool-")) {
    return <ToolPart part={part} />;
  }

  return null;
}

interface SimulateInput {
  code?: string;
  purpose?: string;
}
interface SimulateOutput {
  ok?: boolean;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  parsed?: unknown;
}
interface VerifyInput {
  userRequest?: string;
  interpretation?: string;
  generatedCode?: string;
  result?: unknown;
  plan?: PlanShape;
}
interface VerifyOutput {
  aligned?: boolean;
  confidence?: "high" | "medium" | "low";
  mismatches?: Array<{ aspect: string; expected: string; actual: string }>;
  suggestions?: string[];
  summary?: string;
  durationMs?: number;
}
interface PlanShape {
  domain?: string;
  framework?: "qiskit" | "pennylane" | "cirq";
  algorithm?: string;
  problem_summary?: string;
  algorithm_rationale?: string;
  qubits_estimate?: number;
  expected_runtime_sec?: number;
  parameters?: Record<string, unknown>;
  success_criteria?: {
    primary_metric?: string;
    expected_range?: { min: number; max: number };
    convergence_tolerance?: number;
    additional_notes?: string[];
  };
  expected_output_keys?: string[];
}
interface PlanOutput {
  plan?: PlanShape;
  next?: string;
}
type CombinedInput = SimulateInput & VerifyInput & PlanShape;
type CombinedOutput = SimulateOutput & VerifyOutput & PlanOutput;
interface ToolPartShape {
  type: string;
  state?: string;
  input?: CombinedInput;
  output?: CombinedOutput;
  errorText?: string;
}

interface ActivityStep {
  id: "request_plan" | "simulate" | "verify_intent_alignment";
  title: string;
  detail: string;
  state: "waiting" | "active" | "done" | "error";
}

function AgentProgress({
  activity,
  busy,
}: {
  activity: ActivityStep[];
  busy: boolean;
}) {
  const active = activity.find((step) => step.state === "active");
  const doneCount = activity.filter((step) => step.state === "done").length;
  const hasRun = activity.some((step) => step.state !== "waiting");

  return (
    <section className="overflow-hidden rounded-sm border border-[var(--border)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold uppercase tracking-[0.18em]">
            {activity.some((step) => step.state === "error") ? "Error" : "Run"}
          </div>
          <div className="hidden text-sm text-[var(--muted)] sm:block">
            {busy ? active?.detail ?? "準備中" : hasRun ? "完了" : "未実行"}
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-[var(--muted)]">
          {busy && <span className="progress-dot" />}
          {busy ? "running" : `${doneCount}/${activity.length}`}
        </div>
      </div>

      <div>
        {activity.map((step, index) => (
          <div
            key={step.id}
            className={[
              "grid grid-cols-[28px_minmax(0,1fr)_72px] items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0 transition",
              step.state === "active"
                ? "bg-[var(--surface)] text-[var(--fg)]"
                : step.state === "done"
                ? "bg-white"
                : step.state === "error"
                ? "bg-white"
                : "bg-white text-[var(--muted)]",
            ].join(" ")}
          >
            <div className="font-mono text-xs">
              {step.state === "done" ? "✓" : step.state === "active" ? "•" : "."}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{step.title}</div>
              <div className="truncate text-xs text-[var(--muted)]">
                {step.detail}
              </div>
            </div>
            <div className="text-right text-[11px] uppercase text-[var(--muted)]">
              {getStepStateLabel(step.state)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ToolPart({ part }: { part: unknown }) {
  const p = part as ToolPartShape;
  const toolName = p.type.replace(/^tool-/, "");
  const state = p.state ?? "unknown";
  const input = p.input;
  const output = p.output;
  const isVerify = toolName === "verify_intent_alignment";
  const isPlan = toolName === "request_plan";
  const failed =
    state === "output-error" ||
    Boolean(p.errorText) ||
    (!isVerify && output?.ok === false) ||
    (isVerify && output?.aligned === false);
  const complete =
    isPlan ? Boolean(output?.plan) : isVerify ? output?.aligned === true : output?.ok;
  const active = !complete && !failed;

  if (isPlan) {
    return (
      <PlanToolPart
        toolName={toolName}
        state={state}
        active={active}
        failed={failed}
        input={input}
        output={output}
        errorText={p.errorText}
      />
    );
  }

  if (isVerify) {
    return (
      <VerifyToolPart
        toolName={toolName}
        state={state}
        active={active}
        failed={failed}
        input={input}
        output={output}
        errorText={p.errorText}
      />
    );
  }

  return (
    <ToolCard
      toolName={toolName}
      state={state}
      active={active}
      failed={failed}
      durationMs={output?.durationMs}
    >
      {input?.purpose && (
        <div className="border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          目的: {input.purpose}
        </div>
      )}
      {input?.code && (
        <div className="border-b border-[var(--border)]">
          <CircuitPreview code={input.code} />
          <EditableCode initialCode={input.code} />
        </div>
      )}
      {output && (
        <div className="flex flex-col gap-3 px-3 py-3">
          {output.parsed != null && <ResultVisualization result={output.parsed} />}
          {output.stderr && output.stderr.trim() && (
            <details>
              <summary className="cursor-pointer text-xs text-[var(--fg)]">
                stderr
              </summary>
              <pre className="!m-0">{output.stderr}</pre>
            </details>
          )}
          {!output.parsed && output.stdout && (
            <details>
              <summary className="cursor-pointer text-xs text-[var(--muted)]">
                stdout
              </summary>
              <pre className="!m-0">{output.stdout}</pre>
            </details>
          )}
        </div>
      )}
      {p.errorText && (
        <div className="px-3 py-2 text-xs text-[var(--fg)]">{p.errorText}</div>
      )}
    </ToolCard>
  );
}

function EditableCode({ initialCode }: { initialCode: string }) {
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const lastInitialRef = useRef(initialCode);

  // initialCode が変わったら編集内容をリセット (setState なし = 再レンダー不発生)
  if (lastInitialRef.current !== initialCode) {
    lastInitialRef.current = initialCode;
    if (editedCode !== null) setEditedCode(null);
  }

  const code = editedCode ?? initialCode;

  return (
    <details className="border-t border-[var(--border)]">
      <summary className="cursor-pointer px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--fg)]">
        生成コードを表示・編集 ({code.split("\n").length} 行)
      </summary>
      <textarea
        value={code}
        onChange={(e) => setEditedCode(e.target.value)}
        spellCheck={false}
        className="min-h-80 w-full resize-y border-0 border-t border-[var(--border)] bg-[var(--code-bg)] p-4 font-mono text-xs leading-relaxed outline-none"
      />
      <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
        編集内容はこの画面上だけの下書きです。再実行にはまだ接続していません。
      </div>
    </details>
  );
}

function ResultVisualization({ result }: { result: unknown }) {
  const counts = findCounts(result);
  const metrics = extractMetrics(result);

  return (
    <div className="flex flex-col gap-4">
      {metrics.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Metrics
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((metric) => (
              <div
                key={metric.key}
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <div className="truncate font-mono text-[11px] text-[var(--muted)]">
                  {metric.key}
                </div>
                <div className="mt-1 truncate text-lg font-semibold">
                  {metric.value}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {counts && (
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Measurement distribution
          </div>
          <CountsChart counts={counts} />
        </section>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--fg)]">
          raw result
        </summary>
        <pre className="!mt-2 !mb-0">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}

function CountsChart({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts)
    .filter(([, value]) => typeof value === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const max = Math.max(...entries.map(([, value]) => value), 1);

  return (
    <div className="rounded-sm border border-[var(--border)]">
      {entries.map(([state, value]) => {
        const width = `${Math.max(2, (value / max) * 100)}%`;
        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
        return (
          <div
            key={state}
            className="grid grid-cols-[72px_minmax(0,1fr)_96px] items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0"
          >
            <div className="font-mono text-sm">{state}</div>
            <div className="h-3 overflow-hidden rounded-full bg-[var(--surface-strong)]">
              <div className="h-full bg-[var(--ink)]" style={{ width }} />
            </div>
            <div className="text-right font-mono text-xs text-[var(--muted)]">
              {value} / {pct}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface CircuitGate {
  id: string;
  name: string;
  targets: number[];
}

function CircuitPreview({ code }: { code: string }) {
  const parsedGates = useMemo(() => parseCircuitGates(code), [code]);

  // ドラッグ並び替え用のローカルオーバーライド
  const [overrides, setOverrides] = useState<CircuitGate[] | null>(null);
  const prevCodeRef = useMemo(() => ({ current: code }), [code]);

  // code が変わったらオーバーライドをリセット (useEffect 不要: useMemo で参照が変わるだけ)
  const gates = overrides && prevCodeRef.current === code ? overrides : parsedGates;

  const qubits = Math.max(1, ...gates.flatMap((gate) => gate.targets), 0) + 1;

  if (gates.length === 0) {
    return (
      <div className="px-3 py-3 text-xs text-[var(--muted)]">
        回路図: コードから表示可能なゲートを検出できませんでした。
      </div>
    );
  }

  const moveGate = (from: number, to: number) => {
    if (from === to) return;
    const next = [...gates];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOverrides(next);
  };

  return (
    <div className="px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Quantum circuit
        </div>
        <div className="text-xs text-[var(--muted)]">
          ゲートはドラッグで並び替えできます
        </div>
      </div>
      <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-white p-3">
        <div className="grid gap-2" style={{ minWidth: `${gates.length * 64 + 70}px` }}>
          {Array.from({ length: qubits }).map((_, qubit) => (
            <div
              key={qubit}
              className="grid items-center gap-2"
              style={{
                gridTemplateColumns: `44px repeat(${gates.length}, 52px)`,
              }}
            >
              <div className="font-mono text-xs text-[var(--muted)]">q{qubit}</div>
              {gates.map((gate, gateIndex) => {
                const active = gate.targets.includes(qubit);
                return (
                  <div
                    key={`${gate.id}-${qubit}`}
                    className="relative flex h-9 items-center justify-center"
                    draggable={qubit === 0}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(gateIndex));
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const from = Number(e.dataTransfer.getData("text/plain"));
                      if (!Number.isNaN(from)) moveGate(from, gateIndex);
                    }}
                  >
                    <div className="absolute left-0 right-0 h-px bg-[var(--border-strong)]" />
                    {active && (
                      <div className="relative z-10 grid h-8 min-w-8 place-items-center rounded-sm border border-[var(--ink)] bg-white px-2 font-mono text-xs shadow-sm">
                        {gate.name}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 text-xs text-[var(--muted)]">
        並び替えは表示上の編集です。コードへの自動反映はまだ未接続です。
      </div>
    </div>
  );
}

function ToolCard({
  toolName,
  state,
  active,
  failed,
  durationMs,
  children,
}: {
  toolName: string;
  state: string;
  active: boolean;
  failed: boolean;
  durationMs?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "overflow-hidden rounded-sm border bg-white",
        failed
          ? "border-[var(--ink)]"
          : active
          ? "border-[var(--ink)] shadow-[4px_4px_0_rgba(0,0,0,0.12)]"
          : "border-[var(--border)]",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2 text-xs">
        <span className="font-mono text-[var(--fg)]">{getToolLabel(toolName)}</span>
        <span className="flex items-center gap-2 text-[var(--muted)]">
          {active && <span className="progress-dot" />}
          {state}
          {durationMs ? ` / ${(durationMs / 1000).toFixed(1)}s` : ""}
        </span>
      </div>
      {children}
    </div>
  );
}

function PlanToolPart({
  toolName,
  state,
  active,
  failed,
  input,
  output,
  errorText,
}: {
  toolName: string;
  state: string;
  active: boolean;
  failed: boolean;
  input: CombinedInput | undefined;
  output: CombinedOutput | undefined;
  errorText: string | undefined;
}) {
  const plan = output?.plan ?? (input as PlanShape | undefined);

  return (
    <ToolCard toolName={toolName} state={state} active={active} failed={failed}>
      <div className="flex flex-col gap-3 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-[var(--ink)] px-2 py-0.5 text-xs font-medium">
            {plan ? "計画済み" : "計画中"}
          </span>
          {plan?.algorithm && (
            <span className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-xs">
              {plan.algorithm}
            </span>
          )}
          {plan?.framework && (
            <span className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs">
              {getFrameworkLabel(plan.framework)}
            </span>
          )}
          {plan?.domain && (
            <span className="rounded-sm border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
              {plan.domain}
            </span>
          )}
          {plan?.qubits_estimate != null && (
            <span className="text-xs text-[var(--muted)]">
              {plan.qubits_estimate} qubits
            </span>
          )}
          {plan?.expected_runtime_sec != null && (
            <span className="text-xs text-[var(--muted)]">
              約 {plan.expected_runtime_sec}s
            </span>
          )}
        </div>

        {plan?.problem_summary && (
          <div className="text-sm">
            <span className="text-[var(--muted)]">課題: </span>
            {plan.problem_summary}
          </div>
        )}

        {plan?.algorithm_rationale && (
          <div className="text-xs leading-relaxed text-[var(--muted)]">
            <span>選択理由: </span>
            {plan.algorithm_rationale}
          </div>
        )}

        {plan?.parameters && Object.keys(plan.parameters).length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-[var(--muted)]">
              Parameters
            </div>
            <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              {Object.entries(plan.parameters).map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-2 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
                >
                  <span className="font-mono text-[var(--muted)]">{k}</span>
                  <span className="min-w-0 truncate font-mono">
                    {formatParamValue(v)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {plan?.success_criteria && (
          <details>
            <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--fg)]">
              成功条件
            </summary>
            <pre className="!mt-1 !text-xs">
              {JSON.stringify(plan.success_criteria, null, 2)}
            </pre>
          </details>
        )}

        {plan?.expected_output_keys && plan.expected_output_keys.length > 0 && (
          <div className="text-xs text-[var(--muted)]">
            <span>期待出力キー: </span>
            <span className="font-mono text-[var(--fg)]">
              {plan.expected_output_keys.join(", ")}
            </span>
          </div>
        )}
      </div>

      {errorText && (
        <div className="px-3 py-2 text-xs text-[var(--fg)]">{errorText}</div>
      )}
    </ToolCard>
  );
}

function formatParamValue(v: unknown): string {
  if (v == null) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function VerifyToolPart({
  toolName,
  state,
  active,
  failed,
  input,
  output,
  errorText,
}: {
  toolName: string;
  state: string;
  active: boolean;
  failed: boolean;
  input: CombinedInput | undefined;
  output: CombinedOutput | undefined;
  errorText: string | undefined;
}) {
  const aligned = output?.aligned;
  const verdictLabel =
    aligned === true ? "整合" : aligned === false ? "要確認" : "判定中";

  return (
    <ToolCard
      toolName={toolName}
      state={state}
      active={active}
      failed={failed}
      durationMs={output?.durationMs}
    >
      {output && (
        <div className="flex flex-col gap-3 px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-sm border border-[var(--ink)] px-2 py-0.5 text-xs font-medium">
              {verdictLabel}
            </span>
            {output.confidence && (
              <span className="text-xs text-[var(--muted)]">
                自信度: {output.confidence}
              </span>
            )}
          </div>

          {output.summary && (
            <div className="whitespace-pre-wrap text-sm">{output.summary}</div>
          )}

          {output.mismatches && output.mismatches.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-[var(--muted)]">
                Mismatches
              </div>
              <ul className="flex flex-col gap-2">
                {output.mismatches.map((m) => (
                  <li
                    key={`${m.aspect}::${m.expected}::${m.actual}`}
                    className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-xs"
                  >
                    <div className="font-mono">{m.aspect}</div>
                    <div className="mt-1 text-[var(--muted)]">
                      <span>期待:</span> {m.expected}
                    </div>
                    <div className="text-[var(--muted)]">
                      <span>実際:</span> {m.actual}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {output.suggestions && output.suggestions.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-[var(--muted)]">
                Suggestions
              </div>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-[var(--fg)]">
                {output.suggestions.map((s, i) => (
                  <li key={`${i}-${s.slice(0, 32)}`}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {input && (input.userRequest || input.interpretation) && (
        <details className="border-t border-[var(--border)]">
          <summary className="cursor-pointer px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--fg)]">
            検証への入力
          </summary>
          <div className="flex flex-col gap-2 px-3 pb-3 text-xs">
            {input.userRequest && (
              <div>
                <div className="text-[var(--muted)]">ユーザー要望</div>
                <div className="whitespace-pre-wrap">{input.userRequest}</div>
              </div>
            )}
            {input.interpretation && (
              <div>
                <div className="text-[var(--muted)]">エージェントの解釈</div>
                <div className="whitespace-pre-wrap">{input.interpretation}</div>
              </div>
            )}
          </div>
        </details>
      )}

      {errorText && (
        <div className="px-3 py-2 text-xs text-[var(--fg)]">{errorText}</div>
      )}
    </ToolCard>
  );
}

function getActivity(messages: UIMessage[], busy: boolean): ActivityStep[] {
  const base: ActivityStep[] = [
    {
      id: "request_plan",
      title: "Plan",
      detail: "要望を量子計算の実行計画に変換",
      state: "waiting",
    },
    {
      id: "simulate",
      title: "Simulate",
      detail: "選択frameworkのシミュレータで実行",
      state: "waiting",
    },
    {
      id: "verify_intent_alignment",
      title: "Verify",
      detail: "要望・計画・コード・結果の整合性を検証",
      state: "waiting",
    },
  ];

  const toolParts = messages
    .flatMap((message) => message.parts)
    .filter((part): part is UIMessage["parts"][number] & { type: string } =>
      part.type.startsWith("tool-"),
    )
    .map((part) => part as ToolPartShape);

  for (const step of base) {
    const part = [...toolParts].reverse().find((candidate) => {
      if (step.id === "simulate") return isSimulationToolType(candidate.type);
      return candidate.type === `tool-${step.id}`;
    });
    if (!part) continue;

    if (part.errorText || part.state === "output-error") {
      step.state = "error";
      continue;
    }

    if (step.id === "request_plan") {
      step.state = part.output?.plan ? "done" : "active";
    } else if (step.id === "simulate") {
      step.state =
        part.output?.ok === true
          ? "done"
          : part.output?.ok === false
          ? "error"
          : "active";
      if (part.input?.purpose) step.detail = part.input.purpose;
    } else {
      step.state =
        part.output?.aligned === true
          ? "done"
          : part.output?.aligned === false
          ? "error"
          : "active";
    }
  }

  if (busy && base.every((step) => step.state === "waiting")) {
    base[0].state = "active";
  }

  return base;
}

function getToolLabel(toolName: string): string {
  if (toolName === "request_plan") return "01 / request_plan";
  if (toolName === "simulate_qiskit") return "02 / simulate_qiskit / Aer";
  if (toolName === "simulate_pennylane") {
    return "02 / simulate_pennylane / default.qubit";
  }
  if (toolName === "simulate_cirq") return "02 / simulate_cirq / Simulator";
  if (toolName === "verify_intent_alignment") {
    return "03 / verify_intent_alignment";
  }
  return toolName;
}

function isSimulationToolType(type: string): boolean {
  return (
    type === "tool-simulate_qiskit" ||
    type === "tool-simulate_pennylane" ||
    type === "tool-simulate_cirq"
  );
}

function withAdvancedSettings(
  text: string,
  settings: {
    framework: "qiskit" | "pennylane" | "cirq";
    shots: string;
    maxIterations: string;
  },
): string {
  const directives = [
    `framework は ${getFrameworkLabel(settings.framework)} を使ってください`,
    "他の framework からの変換ではなく、選択された framework 向けのコードを最初から生成してください",
  ];

  if (settings.shots !== "auto") {
    directives.push(`shots は ${settings.shots} にしてください`);
  }
  if (settings.maxIterations !== "auto") {
    directives.push(
      `VQE/QAOA の max_iterations は ${settings.maxIterations} にしてください`,
    );
  }

  if (directives.length === 0) return text;

  return [
    text.trim(),
    "",
    "追加設定:",
    ...directives.map((directive) => `- ${directive}`),
  ].join("\n");
}

function getFrameworkLabel(framework: "qiskit" | "pennylane" | "cirq"): string {
  if (framework === "pennylane") return "PennyLane";
  if (framework === "cirq") return "Cirq";
  return "Qiskit";
}

function findCounts(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;

  for (const key of ["counts", "counts_top", "measurement_counts"]) {
    const candidate = value[key];
    if (isNumericRecord(candidate)) return candidate;
  }

  for (const candidate of Object.values(value)) {
    if (isNumericRecord(candidate)) return candidate;
  }

  return null;
}

function extractMetrics(value: unknown): Array<{ key: string; value: string }> {
  if (!isRecord(value)) return [];

  return Object.entries(value)
    .filter(([, item]) => {
      if (item == null) return false;
      if (typeof item === "number" || typeof item === "boolean") return true;
      if (typeof item === "string") return item.length <= 80;
      return false;
    })
    .map(([key, item]) => ({
      key,
      value: typeof item === "number" ? formatNumber(item) : String(item),
    }));
}

function parseCircuitGates(code: string): CircuitGate[] {
  const gateNames = new Set([
    "h",
    "x",
    "y",
    "z",
    "rx",
    "ry",
    "rz",
    "cx",
    "cz",
    "swap",
    "measure",
  ]);
  const gates: CircuitGate[] = [];

  code.split("\n").forEach((line, index) => {
    const match = line.match(/\b(?:qc|ansatz|circuit|qc_measure)\.(\w+)\((.*)\)/);
    if (!match) return;

    const [, rawName, rawArgs] = match;
    if (!gateNames.has(rawName)) return;

    const targets = extractIntegerArgs(rawArgs).slice(rawName === "measure" ? 0 : -2);
    const fallbackTargets = extractIntegerArgs(rawArgs);
    const normalizedTargets =
      targets.length > 0 ? targets : fallbackTargets.slice(0, rawName === "measure" ? 1 : 2);

    if (normalizedTargets.length === 0) return;

    gates.push({
      id: `${index}-${rawName}`,
      name: rawName.toUpperCase(),
      targets: normalizedTargets,
    });
  });

  return gates.slice(0, 28);
}

function extractIntegerArgs(args: string): number[] {
  return Array.from(args.matchAll(/(?<![A-Za-z_])\d+(?![A-Za-z_])/g)).map((match) =>
    Number(match[0]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumericRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every((item) => typeof item === "number")
  );
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.001) {
    return value.toExponential(4);
  }
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
}

function getStepStateLabel(state: ActivityStep["state"]): string {
  if (state === "active") return "running";
  if (state === "done") return "done";
  if (state === "error") return "check";
  return "queued";
}
