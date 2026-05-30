"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { BlochSpherePanel } from "@/components/bloch-sphere";
import { CircuitEditor } from "@/components/circuit-editor";
import { LiquidMetalCard } from "@/components/ui/liquid-metal-card";
import { LiquidMetal } from "@paper-design/shaders-react";

const chatTransport = new DefaultChatTransport({ api: "/api/chat" });

interface ExampleQuery {
  domain: string;
  text: string;
}

type RunMode = "default" | "pro" | "research";
type AccuracyMode = "standard" | "research";
type QuantumFramework = "qiskit" | "pennylane" | "cirq";
type FrameworkPreference = "auto" | QuantumFramework;
type SimulatorPreference =
  | "auto"
  | "qiskit_aer_qasm"
  | "qiskit_aer_statevector"
  | "qiskit_aer_density_matrix"
  | "qiskit_aer_mps"
  | "pennylane_default_qubit"
  | "pennylane_default_mixed"
  | "pennylane_lightning_qubit"
  | "cirq_simulator"
  | "cirq_density_matrix"
  | "cirq_clifford";
type OutputFormatId = "source" | "openqasm" | `converted:${QuantumFramework}`;

interface OutputCodeEntry {
  id: OutputFormatId;
  label: string;
  code: string;
}

interface QasmHistory {
  items: string[];
  index: number;
}

interface SimulatorOption {
  id: SimulatorPreference;
  label: string;
  framework?: QuantumFramework;
  help: string;
  directive?: string;
}

const QUANTUM_FRAMEWORKS = ["qiskit", "pennylane", "cirq"] as const;
const SIMULATOR_OPTIONS: SimulatorOption[] = [
  {
    id: "auto",
    label: "自動",
    help: "LLM が問題に合うシミュレータを選びます。",
  },
  {
    id: "qiskit_aer_qasm",
    label: "Aer qasm",
    framework: "qiskit",
    help: "ショットベースの測定 counts 向けです。",
    directive:
      "Use qiskit_aer.AerSimulator() in Qiskit and return shot-based measurement counts.",
  },
  {
    id: "qiskit_aer_statevector",
    label: "Aer statevector",
    framework: "qiskit",
    help: "厳密な状態ベクトルと確率向けです。",
    directive:
      "Use qiskit_aer.AerSimulator(method='statevector') or Statevector in Qiskit and return exact statevector / probabilities.",
  },
  {
    id: "qiskit_aer_density_matrix",
    label: "Aer density matrix",
    framework: "qiskit",
    help: "混合状態やノイズモデル向けです。",
    directive:
      "Use qiskit_aer.AerSimulator(method='density_matrix') in Qiskit and return density_matrix / probabilities with a noise model when needed.",
  },
  {
    id: "qiskit_aer_mps",
    label: "Aer MPS",
    framework: "qiskit",
    help: "低エンタングルメントの大きめの回路向けです。",
    directive:
      "Use qiskit_aer.AerSimulator(method='matrix_product_state') in Qiskit and run a circuit suitable for MPS simulation.",
  },
  {
    id: "pennylane_default_qubit",
    label: "default.qubit",
    framework: "pennylane",
    help: "PennyLane標準の純粋状態シミュレータです。",
    directive:
      "Use qml.device('default.qubit') in PennyLane.",
  },
  {
    id: "pennylane_default_mixed",
    label: "default.mixed",
    framework: "pennylane",
    help: "混合状態やノイズチャネル向けです。",
    directive:
      "Use qml.device('default.mixed') in PennyLane and use noise channels plus density-matrix-compatible measurements when needed.",
  },
  {
    id: "pennylane_lightning_qubit",
    label: "lightning.qubit",
    framework: "pennylane",
    help: "高速な純粋状態シミュレータです。",
    directive:
      "Use qml.device('lightning.qubit') in PennyLane. If unavailable, explain the import error and do not silently switch frameworks.",
  },
  {
    id: "cirq_simulator",
    label: "Simulator",
    framework: "cirq",
    help: "Cirq標準の状態ベクトルシミュレータです。",
    directive:
      "Use cirq.Simulator() in Cirq and return either state-vector simulation results or sampled measurements.",
  },
  {
    id: "cirq_density_matrix",
    label: "Density matrix",
    framework: "cirq",
    help: "混合状態やノイズチャネル向けです。",
    directive:
      "Use cirq.DensityMatrixSimulator() in Cirq and use noise channels plus density-matrix-compatible measurements when needed.",
  },
  {
    id: "cirq_clifford",
    label: "Clifford",
    framework: "cirq",
    help: "Clifford / stabilizer回路専用です。",
    directive:
      "Use cirq.CliffordSimulator() in Cirq. If the problem needs non-Clifford gates, explain why this simulator is unsuitable.",
  },
];

const BORDER_FADE_MS = 600;
const MAX_ATTACHMENTS = 6;
const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ATTACHMENT_ACCEPT =
  "image/*,.pdf,.txt,.md,.csv,.json,.jsonl,.py,.ipynb,.qasm,.qasm2,.openqasm,.ts,.tsx,.js,.jsx,.mjs,.cjs";
const FALLBACK_MEDIA_TYPES: Record<string, string> = {
  cjs: "text/javascript",
  csv: "text/csv",
  ipynb: "application/x-ipynb+json",
  js: "text/javascript",
  json: "application/json",
  jsonl: "application/x-jsonlines",
  jsx: "text/javascript",
  md: "text/markdown",
  mjs: "text/javascript",
  openqasm: "text/x-openqasm",
  pdf: "application/pdf",
  py: "text/x-python",
  qasm: "text/x-openqasm",
  qasm2: "text/x-openqasm",
  ts: "text/typescript",
  tsx: "text/typescript",
  txt: "text/plain",
};

function ScreenBorderOverlay({ visible }: { visible: boolean }) {
  // visible=false になったらフェードアウト後にアンマウントして WebGL を止める
  const [mounted, setMounted] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setFading(false);
    } else if (mounted) {
      setFading(true);
      const t = setTimeout(() => {
        setMounted(false);
        setFading(false);
      }, BORDER_FADE_MS);
      return () => clearTimeout(t);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      style={{
        opacity: fading ? 0 : 1,
        transition: `opacity ${BORDER_FADE_MS}ms ease`,
        WebkitMask:
          "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
        padding: "3px",
      }}
    >
      <LiquidMetal
        className="absolute inset-0"
        shape="none"
        speed={0.42}
        repetition={3}
        softness={0.58}
        shiftRed={0.16}
        shiftBlue={0.38}
        distortion={0.12}
        scale={7}
      />
    </div>
  );
}

export function Chat({ examples }: { examples: ExampleQuery[] }) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [runMode, setRunMode] = useState<RunMode>("default");
  const [framework, setFramework] = useState<FrameworkPreference>("auto");
  const [simulator, setSimulator] = useState<SimulatorPreference>("auto");
  const [shots, setShots] = useState("auto");
  const [maxIterations, setMaxIterations] = useState("auto");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const { messages, sendMessage, status, error } = useChat({
    transport: chatTransport,
  });

  const busy = status === "submitted" || status === "streaming";
  const activity = useMemo(() => getActivity(messages, busy), [messages, busy]);
  const finalCode = useMemo(
    () => getFinalGeneratedCode(messages, busy),
    [messages, busy],
  );
  const finalOpenQasm = useMemo(
    () => getFinalOpenQasm(messages, busy),
    [messages, busy],
  );
  const finalReport = useMemo(
    () => getFinalAnalysisReport(messages, busy),
    [messages, busy],
  );
  const simulatorOptions = useMemo(
    () => getSimulatorOptions(framework),
    [framework],
  );
  const modelTier = runMode === "default" ? "default" : "pro";
  const accuracyMode: AccuracyMode =
    runMode === "research" ? "research" : "standard";

  useEffect(() => {
    if (!simulatorOptions.some((option) => option.id === simulator)) {
      setSimulator("auto");
    }
  }, [simulator, simulatorOptions]);

  const clearSelectedFiles = () => {
    setSelectedFiles([]);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addSelectedFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setSelectedFiles((current) => {
      const next = dedupeFiles([...current, ...Array.from(files)]);
      if (next.length > MAX_ATTACHMENTS) {
        setFileError(`添付は最大 ${MAX_ATTACHMENTS} 件までです。`);
        return next.slice(0, MAX_ATTACHMENTS);
      }

      const totalBytes = next.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        setFileError(
          `添付の合計は ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} までです。`,
        );
        return current;
      }

      setFileError(null);
      return next;
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((current) => current.filter((_, i) => i !== index));
    setFileError(null);
  };

  const submit = async (text: string) => {
    const currentText = inputRef.current?.value ?? text;
    const files = selectedFiles;
    if ((!currentText.trim() && files.length === 0) || busy) return;

    try {
      const fileParts =
        files.length > 0
          ? await Promise.all(files.map((file) => fileToUIPart(file)))
          : undefined;
      const baseText =
        currentText.trim() || "添付ファイルを解析してください。";
      await sendMessage(
        {
          text: withAttachmentContext(
            withAdvancedSettings(baseText, {
              accuracyMode,
              framework,
              simulator,
              shots,
              maxIterations,
            }),
            files,
          ),
          ...(fileParts?.length ? { files: fileParts } : {}),
        },
        { body: { modelTier } },
      );
      setInput("");
      clearSelectedFiles();
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitExample = (text: string) => {
    if (busy) return;
    sendMessage(
      {
        text: withAdvancedSettings(text, {
          accuracyMode,
          framework,
          simulator,
          shots,
          maxIterations,
        }),
      },
      { body: { modelTier } },
    );
  };

  return (
    <>
      <ScreenBorderOverlay visible={busy} />
    <div className="grid min-h-[calc(100vh-72px)] grid-cols-1 items-start border-t border-[var(--border)] lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="border-b border-[var(--border)] bg-white p-5 lg:sticky lg:top-4 lg:h-[calc(100vh-88px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(inputRef.current?.value ?? input);
          }}
          className="flex h-full flex-col gap-5"
        >
          <section>
            <PanelLabel>リクエスト</PanelLabel>
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              研究・解析・量子計算で扱いたい内容をそのまま入力してください。
            </p>
          </section>

          <section className="flex flex-1 flex-col">
            <div className="relative flex flex-1">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="研究・解析・量子計算で扱いたい内容を入力..."
                disabled={busy}
                className="min-h-52 flex-1 resize-none rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 pb-12 text-base leading-relaxed outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--ink)] disabled:opacity-60"
              />
              <div className="absolute bottom-3 right-4 flex items-center">
                <label className="relative inline-flex items-center">
                  <select
                    aria-label="実行モード"
                    value={runMode}
                    onChange={(e) => setRunMode(e.target.value as RunMode)}
                    disabled={busy}
                    className="appearance-none border-0 bg-transparent py-1 pl-0 pr-7 text-lg font-medium text-[#8d8d8d] outline-none transition hover:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="default">標準</option>
                    <option value="pro">プロ</option>
                    <option value="research">研究</option>
                  </select>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-[#8d8d8d]"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 6l4 4 4 -4" />
                    </svg>
                  </span>
                </label>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="rounded-sm border border-[var(--border-strong)] px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  添付
                </button>
                {selectedFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={clearSelectedFiles}
                    disabled={busy}
                    className="text-xs text-[var(--muted)] transition hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    クリア
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  multiple
                  onChange={(event) => addSelectedFiles(event.currentTarget.files)}
                  className="hidden"
                />
              </div>

              {selectedFiles.length > 0 && (
                <div className="grid gap-2">
                  {selectedFiles.map((file, index) => (
                    <SelectedFileItem
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      file={file}
                      onRemove={() => removeSelectedFile(index)}
                    />
                  ))}
                </div>
              )}

              {fileError && (
                <div className="text-xs leading-relaxed text-[var(--muted)]">
                  {fileError}
                </div>
              )}
            </div>
          </section>

          <details className="rounded-sm border border-[var(--border)] bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--muted)]">
              詳細設定
            </summary>
            <div className="flex flex-col gap-4 border-t border-[var(--border)] px-4 py-4">
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  フレームワーク
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-1">
                  {(
                    [
                      "auto",
                      "qiskit",
                      "pennylane",
                      "cirq",
                    ] as const satisfies readonly FrameworkPreference[]
                  ).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setFramework(item)}
                      disabled={busy}
                      className={[
                        "min-w-0 rounded-sm border px-1.5 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                        framework === item
                          ? "border-[var(--ink)] bg-white text-[var(--fg)] shadow-sm"
                          : "border-transparent bg-transparent text-[var(--muted)] hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--fg)]",
                      ].join(" ")}
                    >
                      <span className="block truncate">
                        {getFrameworkPreferenceLabel(item)}
                      </span>
                    </button>
                  ))}
                </div>
                <span className="text-xs leading-relaxed text-[var(--muted)]">
                  Auto では LLM が問題に合うフレームワークを選びます。
                </span>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  シミュレータ
                </span>
                <select
                  value={simulator}
                  onChange={(e) =>
                    setSimulator(e.target.value as SimulatorPreference)
                  }
                  disabled={busy || framework === "auto"}
                  className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)] disabled:opacity-60"
                >
                  {simulatorOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs leading-relaxed text-[var(--muted)]">
                  {getSimulatorOption(simulator)?.help ??
                    "フレームワークを選ぶと対応シミュレータが表示されます。"}
                </span>
              </label>

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
                  <option value="auto">自動</option>
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
                  最大反復回数
                </span>
                <select
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(e.target.value)}
                  disabled={busy}
                  className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)] disabled:opacity-60"
                >
                  <option value="auto">自動</option>
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
            type="button"
            onClick={() => void submit(inputRef.current?.value ?? input)}
            disabled={busy}
            className="rounded-sm bg-[var(--ink)] px-5 py-4 text-base font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? "生成中" : "生成"}
          </button>

          {error && (
            <div className="font-mono text-xs text-[var(--muted)]">
              エラー: {error.message}
            </div>
          )}
        </form>
      </aside>

      <section className="flex min-w-0 flex-col bg-white">
        <div className="flex min-h-[46vh] flex-1 flex-col">
          {messages.length === 0 ? (
            <EmptyState examples={examples} onExampleClick={submitExample} />
          ) : (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 lg:p-8">
              {messages.map((m, i) => (
                <MessageView
                  key={m.id}
                  message={m}
                  isLastStreaming={busy && i === messages.length - 1 && m.role === "assistant"}
                />
              ))}
              {finalReport && <AnalysisReportPanel report={finalReport} />}
              {finalCode && (
                <FinalOutputPanel
                  code={finalCode}
                  openqasm={finalOpenQasm}
                  report={finalReport}
                />
              )}
            </div>
          )}
        </div>
        <div className="border-t border-[var(--border)] p-5 lg:p-8">
          <AgentProgress activity={activity} busy={busy} />
        </div>
      </section>
    </div>
    </>
  );
}

type UIMessage = ReturnType<typeof useChat>["messages"][number];

function MessageView({ message, isLastStreaming }: { message: UIMessage; isLastStreaming?: boolean }) {
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
          <img
            src="/namekoq-icon.svg"
            alt=""
            className="h-5 w-5 rounded-full object-contain"
            aria-hidden="true"
          />
          namekoQ
        </div>
      )}
      <div className="flex flex-col gap-3">
        {message.parts.map((part, i) => (
          <PartView
            key={i}
            part={part}
            isUser={isUser}
            cursor={isLastStreaming && i === message.parts.length - 1}
          />
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

function EmptyState({
  examples,
  onExampleClick,
}: {
  examples: ExampleQuery[];
  onExampleClick: (text: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-sm border border-[var(--border)]">
          <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none" aria-hidden="true">
            {/* 球の外周 */}
            <circle cx="16" cy="16" r="9" stroke="#eeeeee" strokeWidth="0.8" />
            {/* 赤道ベルト */}
            <ellipse cx="16" cy="16" rx="9" ry="3.5" stroke="#e4e4e4" strokeWidth="0.8" />
            {/* 子午線 */}
            <ellipse cx="16" cy="16" rx="3.5" ry="9" stroke="#e8e8e8" strokeWidth="0.6" />
            {/* 中心 */}
            <circle cx="16" cy="16" r="1.2" fill="#cccccc" />
            {/* 粒子A — 時計回り */}
            <g>
              <animateTransform attributeName="transform" type="rotate"
                from="0 16 16" to="360 16 16" dur="3s" repeatCount="indefinite" />
              <circle cx="16" cy="7" r="1.5" fill="#aaaaaa" />
            </g>
            {/* 粒子B — 反時計回り（常に対蹠点） */}
            <g>
              <animateTransform attributeName="transform" type="rotate"
                from="0 16 16" to="-360 16 16" dur="3s" repeatCount="indefinite" />
              <circle cx="16" cy="25" r="1.5" fill="#aaaaaa" />
            </g>
          </svg>
        </div>
        <p className="mb-8 text-base font-medium text-[var(--muted)]">
          量子計算を生成すると、ここに実行状況と結果が表示されます
        </p>

        {examples.length > 0 && (
          <div className="grid gap-2 text-left sm:grid-cols-2">
            {examples.map((example) => (
              <button
                key={example.text}
                type="button"
                onClick={() => onExampleClick(example.text)}
                className="group rounded-sm border border-[var(--border)] bg-white px-4 py-3 text-left transition hover:border-[var(--ink)]"
              >
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)] transition group-hover:text-[var(--fg)]">
                  {example.domain}
                </div>
                <div className="text-sm leading-relaxed text-[var(--fg)]">
                  {example.text}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PartView({
  part,
  isUser,
  cursor,
}: {
  part: UIMessage["parts"][number];
  isUser?: boolean;
  cursor?: boolean;
}) {
  if (part.type === "text") {
    return (
      <div className={isUser ? "whitespace-pre-wrap leading-relaxed" : ""}>
        {isUser ? part.text : <MarkdownContent text={part.text} />}
        {cursor && <span className="terminal-cursor" />}
      </div>
    );
  }

  if (part.type === "reasoning") {
    return (
      <details className="text-xs text-[var(--muted)]">
        <summary className="cursor-pointer">推論</summary>
        <div className="mt-2 whitespace-pre-wrap">{part.text}</div>
      </details>
    );
  }

  if (part.type === "file") {
    return <FilePartView part={part as FileUIPart} />;
  }

  if (part.type.startsWith("tool-")) {
    return <ToolPart part={part} />;
  }

  return null;
}

function SelectedFileItem({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!inferMediaType(file).startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-sm border border-[var(--border)] bg-white p-2">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="h-10 w-10 rounded-sm border border-[var(--border)] object-cover"
        />
      ) : (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-[var(--border)] bg-[var(--surface)] font-mono text-[10px] text-[var(--muted)]">
          {fileExtensionLabel(file.name)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{file.name}</div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)]">
          {inferMediaType(file)} / {formatFileSize(file.size)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-sm border border-[var(--border)] px-2 py-1 text-[10px] font-medium text-[var(--muted)] transition hover:border-[var(--ink)] hover:text-[var(--fg)]"
      >
        削除
      </button>
    </div>
  );
}

function FilePartView({ part }: { part: FileUIPart }) {
  const isImage = part.mediaType.startsWith("image/");

  return (
    <div className="overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)]">
      {isImage && (
        <img
          src={part.url}
          alt={part.filename ?? "添付画像"}
          className="max-h-72 w-full object-contain bg-white"
        />
      )}
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className="min-w-0 truncate font-medium">
          {part.filename ?? "添付ファイル"}
        </span>
        <span className="shrink-0 font-mono text-[var(--muted)]">
          {part.mediaType}
        </span>
      </div>
    </div>
  );
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "table"; rows: string[][] }
  | { type: "hr" };

function MarkdownContent({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="flex flex-col gap-3 leading-relaxed">
      {blocks.map((block, index) => (
        <MarkdownBlockView key={index} block={block} />
      ))}
    </div>
  );
}

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  if (block.type === "heading") {
    const headingClass =
      block.level <= 2
        ? "mt-1 border-b border-[var(--border)] pb-2 text-base font-semibold text-[var(--fg)]"
        : "mt-1 text-sm font-semibold text-[var(--fg)]";
    return <div className={headingClass}>{renderInlineMarkdown(block.text)}</div>;
  }

  if (block.type === "paragraph") {
    return (
      <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--fg)]">
        {renderInlineMarkdown(block.lines.join("\n"))}
      </p>
    );
  }

  if (block.type === "list") {
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-7 text-[var(--fg)]">
        {block.items.map((item, index) => (
          <li key={`${index}-${item.slice(0, 24)}`}>
            {renderInlineMarkdown(item)}
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "code") {
    return (
      <div className="overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--code-bg)]">
        {block.lang && (
          <div className="border-b border-[var(--border)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {block.lang}
          </div>
        )}
        <pre className="m-0 max-h-[460px] overflow-auto border-0 bg-transparent p-3 text-xs leading-relaxed">
          <code>{block.code}</code>
        </pre>
      </div>
    );
  }

  if (block.type === "table") {
    const [head, ...body] = block.rows;
    return (
      <div className="overflow-x-auto rounded-sm border border-[var(--border)]">
        <table className="w-full border-collapse text-sm">
          {head && (
            <thead className="bg-[var(--surface)]">
              <tr>
                {head.map((cell, index) => (
                  <th
                    key={`${index}-${cell}`}
                    className="border-b border-[var(--border)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"
                  >
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-[var(--border)] last:border-b-0">
                {row.map((cell, cellIndex) => (
                  <td key={`${cellIndex}-${cell}`} className="px-3 py-2 align-top">
                    {renderInlineMarkdown(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <hr className="border-[var(--border)]" />;
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        code.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: "code", lang: fence[1] ?? "", code: code.join("\n") });
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (isMarkdownTableLine(trimmed)) {
      const tableLines: string[] = [];
      while (i < lines.length && isMarkdownTableLine((lines[i] ?? "").trim())) {
        tableLines.push((lines[i] ?? "").trim());
        i++;
      }
      const rows = tableLines
        .filter((item) => !isMarkdownTableSeparator(item))
        .map((item) =>
          item
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim()),
        );
      if (rows.length > 0) blocks.push({ type: "table", rows });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      const nextTrimmed = next.trim();
      if (
        !nextTrimmed ||
        /^```/.test(nextTrimmed) ||
        /^(#{1,4})\s+/.test(nextTrimmed) ||
        /^---+$/.test(nextTrimmed) ||
        isMarkdownTableLine(nextTrimmed) ||
        /^[-*]\s+/.test(nextTrimmed)
      ) {
        break;
      }
      paragraph.push(next);
      i++;
    }
    if (paragraph.length > 0) blocks.push({ type: "paragraph", lines: paragraph });
  }

  return blocks;
}

function isMarkdownTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.includes("|", 1);
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={nodes.length} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={nodes.length}
          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 font-mono text-[0.92em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
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
interface OpenQasmOutput {
  framework?: QuantumFramework;
  openqasm?: string | null;
  openqasmVersion?: string | null;
  editorOpenqasm?: string | null;
  openqasmError?: string | null;
  convertedFrameworkCodes?: Partial<Record<QuantumFramework, string>>;
  extractionCode?: string;
  notes?: string[];
  durationMs?: number;
}
interface PlanShape {
  task_type?:
    | "literature_review"
    | "derivation_check"
    | "data_analysis"
    | "quantum_simulation"
    | "paper_reproduction"
    | "experiment_design"
    | "general_research"
    | "other";
  research_question?: string;
  domain?: string;
  framework?: "qiskit" | "pennylane" | "cirq";
  algorithm?: string;
  problem_summary?: string;
  algorithm_rationale?: string;
  sources_used?: Array<{
    id?: string;
    type?: string;
    title?: string;
    locator?: string;
    relevance?: string;
  }>;
  method?: {
    approach?: string;
    steps?: string[];
    tools_or_models?: string[];
    deliverables?: string[];
  };
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
  validation_plan?: {
    required_evidence?: string[];
    checks?: string[];
    reproducibility?: string[];
    uncertainty_analysis?: string[];
  };
  uncertainty?: string[];
  limitations?: string[];
  research_validation?: {
    assumptions?: string[];
    approximation_strategy?: string;
    baseline_methods?: string[];
    validation_checks?: string[];
    failure_modes?: string[];
  };
}
interface PlanOutput {
  plan?: PlanShape;
  next?: string;
}
type CombinedInput = SimulateInput & VerifyInput & PlanShape;
type CombinedOutput = SimulateOutput & VerifyOutput & PlanOutput & OpenQasmOutput;
interface ToolPartShape {
  type: string;
  state?: string;
  input?: CombinedInput;
  output?: CombinedOutput;
  errorText?: string;
}

interface FinalGeneratedCode {
  code: string;
  toolName: string;
  framework?: QuantumFramework;
  purpose?: string;
}

interface FinalOpenQasm {
  openqasm: string;
  framework?: QuantumFramework;
  openqasmVersion?: string | null;
  editorOpenqasm?: string | null;
  convertedFrameworkCodes?: Partial<Record<QuantumFramework, string>>;
  extractionCode?: string;
  notes?: string[];
}

interface AnalysisReport {
  title: string;
  createdAt: string;
  userRequest: string;
  assistantSummary?: string;
  plan?: PlanShape;
  simulation?: {
    toolName: string;
    framework?: QuantumFramework;
    purpose?: string;
    durationMs?: number;
    parsed?: unknown;
    stderr?: string;
  };
  verification?: VerifyOutput;
  openqasm?: {
    ok?: boolean;
    framework?: QuantumFramework;
    version?: string | null;
    notes?: string[];
    error?: string | null;
  };
  artifacts: string[];
  limitations: string[];
}

interface DirectSimulationResult {
  ok: boolean;
  framework?: QuantumFramework | null;
  simulator?: string | null;
  source?: string | null;
  durationMs?: number;
  totalMs?: number;
  stdout?: string;
  stderr?: string;
  parsed?: unknown;
}

interface GeneratedQuantumApp {
  title: string;
  concept: string;
  html: string;
  usageNotes: string[];
}

interface ActivityStep {
  id:
    | "request_plan"
    | "simulate"
    | "verify_intent_alignment"
    | "openqasm";
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

  const content = (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold uppercase tracking-[0.18em]">
            {activity.some((step) => step.state === "error") ? "エラー" : "実行"}
          </div>
          <div className="hidden text-sm text-[var(--muted)] sm:block">
            {busy ? active?.detail ?? "準備中" : hasRun ? "完了" : "未実行"}
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-[var(--muted)]">
          {busy && <OscilloscopeWave />}
          {busy ? "実行中" : `${doneCount}/${activity.length}`}
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
    </>
  );

  if (busy) {
    return (
      <LiquidMetalCard
        className="rounded-md border border-[var(--border)] p-[1px] shadow-[0_12px_34px_rgba(17,24,39,0.10)]"
        speed={0.42}
        repetition={3}
        softness={0.58}
        shiftRed={0.16}
        shiftBlue={0.38}
        distortion={0.12}
        scale={7}
      >
        <section className="overflow-hidden rounded-[6px] border border-white/70 bg-white/95 backdrop-blur">
          {content}
        </section>
      </LiquidMetalCard>
    );
  }

  return (
    <section className="overflow-hidden rounded-sm border border-[var(--border)] bg-white">
      {content}
    </section>
  );
}

function FinalOutputPanel({
  code,
  openqasm,
  report,
}: {
  code: FinalGeneratedCode;
  openqasm: FinalOpenQasm | null;
  report: AnalysisReport | null;
}) {
  const selectedSourceFramework = code.framework ?? openqasm?.framework ?? "qiskit";
  const rawOpenqasm = openqasm?.openqasm ?? "";
  const initialEditorOpenqasm = getEditorCompatibleOpenQasm(openqasm);
  const [editorOpenqasm, setEditorOpenqasm] = useState(
    initialEditorOpenqasm,
  );
  const [qasmHistory, setQasmHistory] = useState<QasmHistory>(
    initialEditorOpenqasm
      ? { items: [initialEditorOpenqasm], index: 0 }
      : { items: [], index: -1 },
  );
  const qasmFileInputRef = useRef<HTMLInputElement | null>(null);
  const editorCanRender = isEditorCompatibleOpenQasm(editorOpenqasm);
  const liveOpenqasm = editorOpenqasm || rawOpenqasm;
  const liveOpenqasmVersion = inferOpenQasmVersion(
    liveOpenqasm,
    openqasm?.openqasmVersion,
  );
  const liveConvertedCodes = useMemo(
    () =>
      liveOpenqasm
        ? createClientFrameworkConversionCodes({
            openqasm: liveOpenqasm,
            openqasmVersion: liveOpenqasmVersion ?? undefined,
          })
        : {},
    [liveOpenqasm, liveOpenqasmVersion],
  );
  const codeEntries: OutputCodeEntry[] = [
    {
      id: "source",
      label: `${getFrameworkLabel(selectedSourceFramework)}（最終）`,
      code: code.code,
    },
    ...(openqasm && liveOpenqasm
      ? QUANTUM_FRAMEWORKS.map((framework) => ({
          id: convertedFormatId(framework),
          label: `${getFrameworkLabel(framework)}（OpenQASM由来）`,
          code: liveConvertedCodes[framework] ?? "",
        }))
      : []),
    ...(openqasm && liveOpenqasm
      ? [
          {
            id: "openqasm" as const,
            label: liveOpenqasmVersion
              ? `OpenQASM ${liveOpenqasmVersion}`
              : "OpenQASM",
            code: liveOpenqasm,
          },
        ]
      : []),
  ];
  const [selectedFormat, setSelectedFormat] =
    useState<OutputFormatId>("source");
  const selectedCode =
    codeEntries.find((entry) => entry.id === selectedFormat)?.code ?? code.code;
  const [editedCode, setEditedCode] = useState(selectedCode);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [runFramework, setRunFramework] =
    useState<QuantumFramework>(selectedSourceFramework);
  const [runSimulator, setRunSimulator] = useState<SimulatorPreference>("auto");
  const canUndoQasm = qasmHistory.index > 0;
  const canRedoQasm =
    qasmHistory.index >= 0 && qasmHistory.index < qasmHistory.items.length - 1;
  const runSimulatorOptions = useMemo(
    () => getSimulatorOptions(runFramework),
    [runFramework],
  );
  const directRunCode = useMemo(
    () =>
      createDirectRunCode({
        selectedFormat,
        editedCode,
        liveOpenqasm,
        liveOpenqasmVersion: liveOpenqasmVersion ?? undefined,
        targetFramework: runFramework,
        simulator: runSimulator,
      }),
    [
      selectedFormat,
      editedCode,
      liveOpenqasm,
      liveOpenqasmVersion,
      runFramework,
      runSimulator,
    ],
  );
  useEffect(() => {
    setSelectedFormat("source");
    setRunFramework(selectedSourceFramework);
  }, [code.code, selectedSourceFramework]);

  useEffect(() => {
    if (!runSimulatorOptions.some((option) => option.id === runSimulator)) {
      setRunSimulator("auto");
    }
  }, [runSimulator, runSimulatorOptions]);

  useEffect(() => {
    const nextOpenqasm = getEditorCompatibleOpenQasm(openqasm);
    setEditorOpenqasm(nextOpenqasm);
    setQasmHistory(
      nextOpenqasm
        ? { items: [nextOpenqasm], index: 0 }
        : { items: [], index: -1 },
    );
  }, [openqasm]);

  useEffect(() => {
    setEditedCode(selectedCode);
    setCopyState("idle");
  }, [selectedCode]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(editedCode);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const commitEditorOpenqasm = (nextOpenqasm: string) => {
    setEditorOpenqasm(nextOpenqasm);
    setQasmHistory((history) => {
      const base = history.items.slice(0, history.index + 1);
      if (base[base.length - 1] === nextOpenqasm) return history;
      const items = [...base, nextOpenqasm];
      const limitedItems = items.length > 60 ? items.slice(items.length - 60) : items;
      return { items: limitedItems, index: limitedItems.length - 1 };
    });
  };

  const undoQasm = () => {
    if (!canUndoQasm) return;
    const index = qasmHistory.index - 1;
    const nextOpenqasm = qasmHistory.items[index] ?? "";
    setQasmHistory({ ...qasmHistory, index });
    setEditorOpenqasm(nextOpenqasm);
    setSelectedFormat("openqasm");
  };

  const redoQasm = () => {
    if (!canRedoQasm) return;
    const index = qasmHistory.index + 1;
    const nextOpenqasm = qasmHistory.items[index] ?? "";
    setQasmHistory({ ...qasmHistory, index });
    setEditorOpenqasm(nextOpenqasm);
    setSelectedFormat("openqasm");
  };

  const importOpenQasmFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const nextOpenqasm = await file.text();
    commitEditorOpenqasm(nextOpenqasm);
    setSelectedFormat("openqasm");
    if (copyState !== "idle") setCopyState("idle");
  };

  const exportOpenQasmFile = () => {
    if (!liveOpenqasm) return;
    const blob = new Blob([liveOpenqasm], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "namekoq-circuit.qasm";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section className="overflow-hidden rounded-sm border border-[var(--border-strong)] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold uppercase tracking-[0.18em]">
            最終出力
          </div>
          <label className="mt-2 flex min-w-0 items-center gap-2">
            <select
              value={selectedFormat}
              onChange={(e) =>
                setSelectedFormat(e.target.value as OutputFormatId)
              }
              className="max-w-56 rounded-sm border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium outline-none focus:border-[var(--ink)]"
            >
              {codeEntries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={undoQasm}
            disabled={!canUndoQasm}
            className="rounded-sm border border-[var(--border-strong)] px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            戻す
          </button>
          <button
            type="button"
            onClick={redoQasm}
            disabled={!canRedoQasm}
            className="rounded-sm border border-[var(--border-strong)] px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            やり直し
          </button>
          <button
            type="button"
            onClick={() => qasmFileInputRef.current?.click()}
            disabled={!openqasm}
            className="rounded-sm border border-[var(--border-strong)] px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            QASM読込
          </button>
          <button
            type="button"
            onClick={exportOpenQasmFile}
            disabled={!liveOpenqasm}
            className="rounded-sm border border-[var(--border-strong)] px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            QASM出力
          </button>
          <button
            type="button"
            onClick={copyCode}
            className="rounded-sm border border-[var(--ink)] px-3 py-2 text-xs font-medium transition hover:bg-[var(--ink)] hover:text-white"
          >
            {copyState === "copied"
              ? "コピー済み"
              : copyState === "failed"
              ? "コピー失敗"
              : "コピー"}
          </button>
          <input
            ref={qasmFileInputRef}
            type="file"
            accept=".qasm,.qasm2,.openqasm,.txt"
            onChange={importOpenQasmFile}
            className="hidden"
          />
        </div>
      </div>
      <div className="crt-scanlines">
        <textarea
          value={editedCode}
          onChange={(e) => {
            const nextCode = e.target.value;
            setEditedCode(nextCode);
            if (selectedFormat === "openqasm") setEditorOpenqasm(nextCode);
            if (copyState !== "idle") setCopyState("idle");
          }}
          onBlur={() => {
            if (selectedFormat === "openqasm") commitEditorOpenqasm(editedCode);
          }}
          spellCheck={false}
          className="min-h-96 w-full resize-y border-0 bg-[var(--code-bg)] p-4 font-mono text-xs leading-relaxed outline-none"
        />
      </div>
      <DirectSimulationPanel
        code={directRunCode.code}
        source={directRunCode.source}
        framework={runFramework}
        simulator={runSimulator}
        simulatorOptions={runSimulatorOptions}
        onFrameworkChange={setRunFramework}
        onSimulatorChange={setRunSimulator}
      />
      <AppBuilderPanel
        openqasm={liveOpenqasm}
        sourceCode={code.code}
        report={report}
        convertedCodes={liveConvertedCodes}
      />
      {openqasm && editorOpenqasm && editorCanRender && (
        <CircuitEditor
          openqasm={editorOpenqasm}
          onChange={(nextOpenqasm) => {
            commitEditorOpenqasm(nextOpenqasm);
            if (selectedFormat === "source") {
              setSelectedFormat(convertedFormatId(selectedSourceFramework));
            }
            if (copyState !== "idle") setCopyState("idle");
          }}
        />
      )}
      {openqasm && editorOpenqasm && editorCanRender && (
        <BlochSpherePanel openqasm={editorOpenqasm} />
      )}
    </section>
  );
}

function DirectSimulationPanel({
  code,
  source,
  framework,
  simulator,
  simulatorOptions,
  onFrameworkChange,
  onSimulatorChange,
}: {
  code: string;
  source: "source" | "openqasm" | "converted";
  framework: QuantumFramework;
  simulator: SimulatorPreference;
  simulatorOptions: SimulatorOption[];
  onFrameworkChange: (framework: QuantumFramework) => void;
  onSimulatorChange: (simulator: SimulatorPreference) => void;
}) {
  const [result, setResult] = useState<DirectSimulationResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setResult(null);
  }, [code]);

  const run = async () => {
    if (!code.trim() || running) return;
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, framework, simulator, source }),
      });
      const payload = (await response.json()) as DirectSimulationResult;
      setResult(payload);
    } catch (err) {
      setResult({
        ok: false,
        stderr: err instanceof Error ? err.message : String(err),
        parsed: null,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="border-t border-[var(--border)] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em]">
            シミュレーション実行
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            編集したコード、または現在の回路から生成したコードを実行します
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running || !code.trim()}
          className="rounded-sm border border-[var(--ink)] px-4 py-2 text-xs font-medium transition hover:bg-[var(--ink)] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          {running ? "実行中" : "実行"}
        </button>
      </div>

      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[180px_220px_minmax(0,1fr)]">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            フレームワーク
          </span>
          <select
            value={framework}
            onChange={(event) =>
              onFrameworkChange(event.target.value as QuantumFramework)
            }
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)]"
          >
            {QUANTUM_FRAMEWORKS.map((item) => (
              <option key={item} value={item}>
                {getFrameworkLabel(item)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            シミュレータ
          </span>
          <select
            value={simulator}
            onChange={(event) =>
              onSimulatorChange(event.target.value as SimulatorPreference)
            }
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)]"
          >
            {simulatorOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end text-xs leading-relaxed text-[var(--muted)]">
          入力: {source}.{" "}
          {source === "source"
            ? "最終ソースコードでは、コード側がそのシミュレータを使う場合にのみ選択が反映されます。"
            : "OpenQASM由来コードでは、選択したシミュレータをwrapperに注入します。"}
        </div>
      </div>

      {result && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-[var(--ink)] px-2 py-0.5 text-xs font-medium">
              {result.ok ? "成功" : "失敗"}
            </span>
            {result.durationMs != null && (
              <span className="font-mono text-xs text-[var(--muted)]">
                {(result.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {result.parsed != null && <ResultVisualization result={result.parsed} />}

          {result.stderr && result.stderr.trim() && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--fg)]">
                stderr
              </summary>
              <pre className="!m-0 !mt-2">{result.stderr}</pre>
            </details>
          )}

          {result.stdout && result.stdout.trim() && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--muted)]">
                stdout
              </summary>
              <pre className="!m-0 !mt-2">{result.stdout}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function AppBuilderPanel({
  openqasm,
  sourceCode,
  report,
  convertedCodes,
}: {
  openqasm: string;
  sourceCode: string;
  report: AnalysisReport | null;
  convertedCodes: Partial<Record<QuantumFramework, string>>;
}) {
  const defaultIdea = getDefaultAppIdea(report);
  const [instructions, setInstructions] = useState("");
  const [generatedApp, setGeneratedApp] = useState<GeneratedQuantumApp | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateApp = async () => {
    if (!openqasm.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setGeneratedApp(null);
    try {
      const response = await fetch("/api/app-builder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          openqasm,
          sourceCode,
          convertedCodes,
          customization: instructions,
          report,
        }),
      });
      const payload = (await response.json()) as
        | GeneratedQuantumApp
        | { error?: string };
      if (!response.ok || isAppBuilderError(payload)) {
        throw new Error(
          isAppBuilderError(payload)
            ? payload.error ?? "アプリ生成に失敗しました"
            : "アプリ生成に失敗しました",
        );
      }
      setGeneratedApp(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="border-t border-[var(--border)] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em]">
            アプリ生成
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            最終量子アルゴリズムを小さな実用アプリに変換します
          </div>
        </div>
        <button
          type="button"
          onClick={generateApp}
          disabled={generating || !openqasm.trim()}
          className="rounded-sm border border-[var(--ink)] px-4 py-2 text-xs font-medium transition hover:bg-[var(--ink)] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          {generating ? "生成中" : "アプリ生成"}
        </button>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-3">
          <div>
            <ReportSubheading>提案されるアプリ方向性</ReportSubheading>
            <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3 text-sm leading-relaxed">
              {defaultIdea}
            </div>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              カスタム指示
            </span>
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="例: 研究者向けではなく金融担当者向けにする。資産名は Stock A/B/C にする。結果を説明するカードを追加する。"
              className="min-h-28 resize-y rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--ink)]"
            />
          </label>
        </div>

        <div className="flex flex-col gap-3">
          {error && (
            <div className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface)] p-3 text-sm">
              {error}
            </div>
          )}

          {generatedApp ? (
            <div className="rounded-sm border border-[var(--border)] bg-white">
              <div className="border-b border-[var(--border)] px-3 py-2">
                <div className="text-sm font-semibold">{generatedApp.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                  {generatedApp.concept}
                </div>
              </div>
              {generatedApp.usageNotes.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 px-6 py-3 text-xs leading-relaxed text-[var(--muted)]">
                  {generatedApp.usageNotes.map((note, index) => (
                    <li key={`${index}-${note.slice(0, 32)}`}>{note}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 border-t border-[var(--border)] p-3">
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      "namekoq-generated-app.html",
                      generatedApp.html,
                      "text/html",
                    )
                  }
                  className="rounded-sm border border-[var(--ink)] px-3 py-2 text-xs font-medium transition hover:bg-[var(--ink)] hover:text-white"
                >
                  HTMLをダウンロード
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(generatedApp.html)}
                  className="rounded-sm border border-[var(--border-strong)] px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)]"
                >
                  HTMLをコピー
                </button>
              </div>
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center rounded-sm border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-center text-sm text-[var(--muted)]">
              アプリを生成すると、ダウンロード可能な単一HTMLプロトタイプが作成されます。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function isAppBuilderError(
  value: GeneratedQuantumApp | { error?: string },
): value is { error?: string } {
  return "error" in value;
}

function AnalysisReportPanel({ report }: { report: AnalysisReport }) {
  const resultItems = report.simulation?.parsed
    ? extractReportResultItems(report.simulation.parsed)
    : [];
  const counts = report.simulation?.parsed ? findCounts(report.simulation.parsed) : null;
  const topCounts = counts
    ? Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];
  const maxCount = topCounts.reduce((max, [, value]) => Math.max(max, value), 0);
  const exportBaseName = createReportFilenameBase(report);
  const markdown = createReportMarkdown(report);
  const json = JSON.stringify(report, null, 2);
  const detailedAnalysis = createReportDetailedAnalysis(report);
  const frameworkLabel =
    report.plan?.framework ?? report.simulation?.framework ?? "framework未指定";
  const algorithmLabel = report.plan?.algorithm ?? "algorithm未指定";
  const verificationLabel =
    report.verification?.aligned == null
      ? "未検証"
      : report.verification.aligned
      ? "整合"
      : "要確認";

  return (
    <section className="overflow-hidden rounded-md border border-[var(--border-strong)] bg-white shadow-[0_18px_45px_rgba(17,24,39,0.08)]">
      <div className="border-b border-[var(--border)] bg-[linear-gradient(180deg,#ffffff_0%,#f7f7f7_100%)] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold uppercase tracking-[0.18em]">
                分析レポート
              </div>
              <ReportStatusPill tone={report.verification?.aligned ? "ok" : "warn"}>
                {verificationLabel}
              </ReportStatusPill>
            </div>
            <div className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              {report.createdAt} / 再現可能な実行サマリー
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                downloadText(`${exportBaseName}.md`, markdown, "text/markdown")
              }
              className="rounded-sm border border-[var(--border-strong)] bg-white px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)] hover:bg-[var(--surface)]"
            >
              MD出力
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(`${exportBaseName}.json`, json, "application/json")
              }
              className="rounded-sm border border-[var(--border-strong)] bg-white px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)] hover:bg-[var(--surface)]"
            >
              JSON出力
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-sm border border-[var(--border)] bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
              Framework
            </div>
            <div className="mt-1 truncate font-mono text-sm">{frameworkLabel}</div>
          </div>
          <div className="rounded-sm border border-[var(--border)] bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
              Algorithm
            </div>
            <div className="mt-1 truncate font-mono text-sm">{algorithmLabel}</div>
          </div>
          <div className="rounded-sm border border-[var(--border)] bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
              Artifacts
            </div>
            <div className="mt-1 font-mono text-sm">{report.artifacts.length}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 bg-[#fbfbfb] p-4 sm:p-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)]">
        <div className="flex flex-col gap-4">
          <ReportCard>
            <ReportHeading>概要</ReportHeading>
            <MarkdownContent
              text={
                getReportOverviewText(report.assistantSummary) ??
                "実行計画、シミュレーション結果、検証結果を以下にまとめます。"
              }
            />
          </ReportCard>

          {detailedAnalysis && (
            <ReportCard>
              <ReportHeading>詳しい分析</ReportHeading>
              <MarkdownContent text={detailedAnalysis} />
            </ReportCard>
          )}

          <ReportCard>
            <ReportHeading>問題設定</ReportHeading>
            <div className="rounded-sm border border-[var(--border)] bg-white p-3 text-sm leading-relaxed shadow-[inset_3px_0_0_var(--ink)]">
              {report.userRequest}
            </div>
          </ReportCard>

          {report.plan && (
            <ReportCard>
              <ReportHeading>手法</ReportHeading>
              <div className="grid gap-2 sm:grid-cols-2">
                <ReportField
                  label="タスク種別"
                  value={
                    report.plan.task_type
                      ? getTaskTypeLabel(report.plan.task_type)
                      : undefined
                  }
                />
                <ReportField
                  label="研究質問"
                  value={report.plan.research_question}
                />
                <ReportField label="フレームワーク" value={report.plan.framework} />
                <ReportField label="アルゴリズム" value={report.plan.algorithm} />
                <ReportField
                  label="量子ビット数"
                  value={
                    report.plan.qubits_estimate != null
                      ? `${report.plan.qubits_estimate}`
                      : undefined
                  }
                />
                <ReportField
                  label="実行時間見積もり"
                  value={
                    report.plan.expected_runtime_sec != null
                      ? `${report.plan.expected_runtime_sec}s`
                      : undefined
                  }
                />
              </div>
              {report.plan.problem_summary && (
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                  {report.plan.problem_summary}
                </p>
              )}
              {report.plan.algorithm_rationale && (
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                  {report.plan.algorithm_rationale}
                </p>
              )}
              {report.plan.method && (
                <div className="mt-3">
                  <ReportSubheading>研究方法</ReportSubheading>
                  <pre className="!m-0 !max-h-72 !text-xs">
                    {JSON.stringify(report.plan.method, null, 2)}
                  </pre>
                </div>
              )}
              {report.plan.sources_used?.length ? (
                <div className="mt-3">
                  <ReportSubheading>参照ソース</ReportSubheading>
                  <pre className="!m-0 !max-h-72 !text-xs">
                    {JSON.stringify(report.plan.sources_used, null, 2)}
                  </pre>
                </div>
              ) : null}
              {report.plan.validation_plan && (
                <div className="mt-3">
                  <ReportSubheading>検証計画</ReportSubheading>
                  <pre className="!m-0 !max-h-72 !text-xs">
                    {JSON.stringify(report.plan.validation_plan, null, 2)}
                  </pre>
                </div>
              )}
              {report.plan.parameters &&
                Object.keys(report.plan.parameters).length > 0 && (
                  <div className="mt-3">
                    <ReportSubheading>パラメータ</ReportSubheading>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(report.plan.parameters).map(([key, value]) => (
                        <ReportField
                          key={key}
                          label={key}
                          value={formatReportValue(value)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              {hasNonEmptyList(report.plan.uncertainty) && (
                <div className="mt-3">
                  <ReportSubheading>不確実性</ReportSubheading>
                  <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-[var(--muted)]">
                    {report.plan.uncertainty?.map((item, index) => (
                      <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {hasNonEmptyList(report.plan.limitations) && (
                <div className="mt-3">
                  <ReportSubheading>制約</ReportSubheading>
                  <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-[var(--muted)]">
                    {report.plan.limitations?.map((item, index) => (
                      <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report.plan.research_validation && (
                <div className="mt-3">
                  <ReportSubheading>研究検証プロトコル</ReportSubheading>
                  <pre className="!m-0 !max-h-72 !text-xs">
                    {JSON.stringify(report.plan.research_validation, null, 2)}
                  </pre>
                </div>
              )}
            </ReportCard>
          )}

          {report.verification && (
            <ReportCard>
              <ReportHeading>検証</ReportHeading>
              <div className="flex flex-wrap items-center gap-2">
                <ReportStatusPill tone={report.verification.aligned ? "ok" : "warn"}>
                  {report.verification.aligned ? "整合" : "要確認"}
                </ReportStatusPill>
                {report.verification.confidence && (
                  <span className="text-xs text-[var(--muted)]">
                    信頼度: {report.verification.confidence}
                  </span>
                )}
              </div>
              {report.verification.summary && (
                <p className="mt-2 text-sm leading-relaxed">
                  {report.verification.summary}
                </p>
              )}
              {report.verification.mismatches &&
                report.verification.mismatches.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2">
                    {report.verification.mismatches.map((item) => (
                      <li
                        key={`${item.aspect}-${item.expected}-${item.actual}`}
                        className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-2 text-xs"
                      >
                        <div className="font-mono">{item.aspect}</div>
                        <div className="mt-1 text-[var(--muted)]">
                          期待: {item.expected}
                        </div>
                        <div className="text-[var(--muted)]">
                          実際: {item.actual}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
            </ReportCard>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <ReportCard>
            <ReportHeading>主要結果</ReportHeading>
            {resultItems.length > 0 ? (
              <div className="grid gap-2">
                {resultItems.map((metric) => (
                  <ReportMetric
                    key={metric.key}
                    label={metric.key}
                    value={metric.value}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-[var(--muted)]">
                数値指標は検出されませんでした。
              </div>
            )}
          </ReportCard>

          {topCounts.length > 0 && (
            <ReportCard>
              <ReportHeading>上位測定結果</ReportHeading>
              <div className="grid gap-2">
                {topCounts.map(([state, value]) => (
                  <ReportCountBar
                    key={state}
                    state={state}
                    value={value}
                    max={maxCount}
                  />
                ))}
              </div>
            </ReportCard>
          )}

          <ReportCard>
            <ReportHeading>成果物</ReportHeading>
            <div className="flex flex-wrap gap-2">
              {report.artifacts.map((artifact) => (
                <span
                  key={artifact}
                  className="rounded-sm border border-[var(--border)] bg-white px-2 py-1 text-xs shadow-sm"
                >
                  {artifact}
                </span>
              ))}
            </div>
          </ReportCard>

          {report.openqasm && (
            <ReportCard>
              <ReportHeading>OpenQASM</ReportHeading>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <ReportStatusPill tone={report.openqasm.ok ? "ok" : "warn"}>
                  {report.openqasm.ok ? "抽出済み" : "利用不可"}
                </ReportStatusPill>
                <span className="text-[var(--muted)]">
                  {report.openqasm.ok ? "回路表現を利用できます" : "抽出失敗または不完全"}
                  {report.openqasm.version ? ` / v${report.openqasm.version}` : ""}
                </span>
              </div>
              {report.openqasm.notes && report.openqasm.notes.length > 0 && (
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-[var(--muted)]">
                  {report.openqasm.notes.map((note, index) => (
                    <li key={`${index}-${note.slice(0, 24)}`}>{note}</li>
                  ))}
                </ul>
              )}
              {report.openqasm.error && (
                <div className="mt-2 text-xs text-[var(--muted)]">
                  {report.openqasm.error}
                </div>
              )}
            </ReportCard>
          )}

          {report.limitations.length > 0 && (
            <ReportCard>
              <ReportHeading>制約</ReportHeading>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-[var(--muted)]">
                {report.limitations.map((item, index) => (
                  <li key={`${index}-${item.slice(0, 32)}`}>{item}</li>
                ))}
              </ul>
            </ReportCard>
          )}
        </div>
      </div>
    </section>
  );
}

function ReportCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[var(--border)] bg-white p-4 shadow-[0_8px_24px_rgba(17,24,39,0.045)]">
      {children}
    </section>
  );
}

function ReportHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
      <span className="h-px w-5 bg-[var(--border-strong)]" aria-hidden="true" />
      {children}
    </div>
  );
}

function ReportSubheading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
      {children}
    </div>
  );
}

function ReportField({ label, value }: { label: string; value?: unknown }) {
  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-sm">
        {value == null || value === "" ? "-" : String(value)}
      </div>
    </div>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
      <div className="truncate font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-1 break-words text-lg font-semibold">{value}</div>
    </div>
  );
}

function ReportStatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "ok" | "warn";
}) {
  return (
    <span
      className={[
        "rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
        tone === "ok"
          ? "border-[#14813d] bg-[#eefaf2] text-[#116932]"
          : "border-[#9a6a10] bg-[#fff8e8] text-[#73500d]",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function ReportCountBar({
  state,
  value,
  max,
}: {
  state: string;
  value: number;
  max: number;
}) {
  const width = max > 0 ? Math.max(8, Math.round((value / max) * 100)) : 0;

  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-mono">{state}</span>
        <span className="shrink-0 font-mono text-xs text-[var(--muted)]">
          {formatNumber(value)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-[var(--ink)]"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
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
  const isOpenQasm = toolName === "convert_to_openqasm";
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

  if (isOpenQasm) {
    return (
      <OpenQasmToolPart
        toolName={toolName}
        state={state}
        active={active}
        failed={failed}
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

function OpenQasmToolPart({
  toolName,
  state,
  active,
  failed,
  output,
  errorText,
}: {
  toolName: string;
  state: string;
  active: boolean;
  failed: boolean;
  output: CombinedOutput | undefined;
  errorText: string | undefined;
}) {
  return (
    <ToolCard
      toolName={toolName}
      state={state}
      active={active}
      failed={failed}
      durationMs={output?.durationMs}
    >
      <div className="flex flex-col gap-3 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-[var(--ink)] px-2 py-0.5 text-xs font-medium">
            {output?.ok ? "抽出済み" : failed ? "要確認" : "抽出中"}
          </span>
          {output?.framework && (
            <span className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs">
              {getFrameworkLabel(output.framework)}
            </span>
          )}
          {output?.openqasmVersion && (
            <span className="font-mono text-xs text-[var(--muted)]">
              OpenQASM {output.openqasmVersion}
            </span>
          )}
        </div>

        {output?.openqasmError && (
          <div className="text-xs text-[var(--fg)]">
            {output.openqasmError}
          </div>
        )}

        {output?.ok && (
          <div className="text-xs text-[var(--muted)]">
            OpenQASM と変換コードは最終出力で確認できます。
          </div>
        )}
      </div>

      {errorText && (
        <div className="px-3 py-2 text-xs text-[var(--fg)]">{errorText}</div>
      )}
    </ToolCard>
  );
}

function EditableCode({ initialCode }: { initialCode: string }) {
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const lastInitialRef = useRef(initialCode);

  // initialCode が変わったらローカル編集をリセットする。
  if (lastInitialRef.current !== initialCode) {
    lastInitialRef.current = initialCode;
    if (editedCode !== null) setEditedCode(null);
  }

  const code = editedCode ?? initialCode;

  return (
    <details className="border-t border-[var(--border)]">
      <summary className="cursor-pointer px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--fg)]">
        生成コードを表示/編集（{code.split("\n").length}行）
      </summary>
      <textarea
        value={code}
        onChange={(e) => setEditedCode(e.target.value)}
        spellCheck={false}
        className="min-h-80 w-full resize-y border-0 border-t border-[var(--border)] bg-[var(--code-bg)] p-4 font-mono text-xs leading-relaxed outline-none"
      />
      <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
        編集内容はこのパネル内のローカル下書きです。
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
            指標
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
            測定分布
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
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setCollapsed(false), 60);
    return () => clearTimeout(t);
  }, []);

  const entries = Object.entries(counts)
    .filter(([, value]) => typeof value === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const max = Math.max(...entries.map(([, value]) => value), 1);
  const equalWidth = `${(100 / Math.max(entries.length, 1)).toFixed(1)}%`;

  return (
    <div className="rounded-sm border border-[var(--border)]">
      {entries.map(([state, value]) => {
        const finalWidth = `${Math.max(2, (value / max) * 100)}%`;
        const width = collapsed ? equalWidth : finalWidth;
        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
        return (
          <div
            key={state}
            className="grid grid-cols-[72px_minmax(0,1fr)_96px] items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0"
          >
            <div className="font-mono text-sm">{state}</div>
            <div className="h-3 overflow-hidden rounded-full bg-[var(--surface-strong)]">
              <div
                className="h-full bg-[var(--ink)]"
                style={{
                  width,
                  transition: collapsed ? "none" : "width 0.7s cubic-bezier(0.34, 1.4, 0.64, 1)",
                }}
              />
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

function OscilloscopeWave() {
  return (
    <svg
      width="32" height="10" viewBox="0 0 32 10"
      style={{ overflow: "hidden", display: "inline-block", verticalAlign: "middle" }}
      aria-hidden="true"
    >
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          from="0,0"
          to="-16,0"
          dur="1.2s"
          repeatCount="indefinite"
        />
        <path
          d="M-16,5 C-14,5 -14,1.5 -12,1.5 C-10,1.5 -10,5 -8,5 C-6,5 -6,8.5 -4,8.5 C-2,8.5 -2,5 0,5 C2,5 2,1.5 4,1.5 C6,1.5 6,5 8,5 C10,5 10,8.5 12,8.5 C14,8.5 14,5 16,5 C18,5 18,1.5 20,1.5 C22,1.5 22,5 24,5 C26,5 26,8.5 28,8.5 C30,8.5 30,5 32,5 C34,5 34,1.5 36,1.5 C38,1.5 38,5 40,5 C42,5 42,8.5 44,8.5 C46,8.5 46,5 48,5"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
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
          {active && <OscilloscopeWave />}
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
          {plan?.task_type && (
            <span className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs">
              {getTaskTypeLabel(plan.task_type)}
            </span>
          )}
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
              {plan.qubits_estimate} qubit
            </span>
          )}
          {plan?.expected_runtime_sec != null && (
            <span className="text-xs text-[var(--muted)]">
              約 {plan.expected_runtime_sec}s
            </span>
          )}
        </div>

        {plan?.research_question && (
          <div className="text-sm">
            <span className="text-[var(--muted)]">研究質問: </span>
            {plan.research_question}
          </div>
        )}

        {plan?.problem_summary && (
          <div className="text-sm">
            <span className="text-[var(--muted)]">タスク: </span>
            {plan.problem_summary}
          </div>
        )}

        {plan?.algorithm_rationale && (
          <div className="text-xs leading-relaxed text-[var(--muted)]">
            <span>選定理由: </span>
            {plan.algorithm_rationale}
          </div>
        )}

        {plan?.method?.approach && (
          <div className="text-xs leading-relaxed text-[var(--muted)]">
            <span>方法: </span>
            {plan.method.approach}
          </div>
        )}

        {plan?.parameters && Object.keys(plan.parameters).length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-[var(--muted)]">
              パラメータ
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

        {plan?.sources_used && plan.sources_used.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--fg)]">
              参照ソース
            </summary>
            <pre className="!mt-1 !text-xs">
              {JSON.stringify(plan.sources_used, null, 2)}
            </pre>
          </details>
        )}

        {plan?.validation_plan && (
          <details>
            <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--fg)]">
              検証計画
            </summary>
            <pre className="!mt-1 !text-xs">
              {JSON.stringify(plan.validation_plan, null, 2)}
            </pre>
          </details>
        )}

        {(hasNonEmptyList(plan?.uncertainty) ||
          hasNonEmptyList(plan?.limitations)) && (
          <details>
            <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--fg)]">
              不確実性と制約
            </summary>
            <pre className="!mt-1 !text-xs">
              {JSON.stringify(
                {
                  uncertainty: plan?.uncertainty ?? [],
                  limitations: plan?.limitations ?? [],
                },
                null,
                2,
              )}
            </pre>
          </details>
        )}

        {plan?.research_validation && (
          <details>
            <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--fg)]">
              研究検証プロトコル
            </summary>
            <pre className="!mt-1 !text-xs">
              {JSON.stringify(plan.research_validation, null, 2)}
            </pre>
          </details>
        )}

        {plan?.expected_output_keys && plan.expected_output_keys.length > 0 && (
          <div className="text-xs text-[var(--muted)]">
            <span>期待される出力キー: </span>
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

function hasNonEmptyList(items?: string[]): boolean {
  return Array.isArray(items) && items.some((item) => item.trim().length > 0);
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
    aligned === true ? "整合" : aligned === false ? "要確認" : "確認中";

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
                信頼度: {output.confidence}
              </span>
            )}
          </div>

          {output.summary && (
            <div className="whitespace-pre-wrap text-sm">{output.summary}</div>
          )}

          {output.mismatches && output.mismatches.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-[var(--muted)]">
                不一致
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
                修正案
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
            検証入力
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
      title: "計画",
      detail: "要望を研究計画に変換",
      state: "waiting",
    },
    {
      id: "simulate",
      title: "シミュレーション",
      detail: "選択されたフレームワークのシミュレータで実行",
      state: "waiting",
    },
    {
      id: "verify_intent_alignment",
      title: "検証",
      detail: "要望、計画、コード、結果の整合性を確認",
      state: "waiting",
    },
    {
      id: "openqasm",
      title: "OpenQASM",
      detail: "回路部分をOpenQASMとして抽出",
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
      if (step.id === "openqasm") {
        return candidate.type === "tool-convert_to_openqasm";
      }
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
    } else if (step.id === "verify_intent_alignment") {
      step.state =
        part.output?.aligned === true
          ? "done"
          : part.output?.aligned === false
          ? "error"
          : "active";
    } else {
      step.state =
        part.output?.ok === true
          ? "done"
          : part.output?.ok === false
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
  if (toolName === "convert_to_openqasm") return "04 / convert_to_openqasm";
  return toolName;
}

function isSimulationToolType(type: string): boolean {
  return (
    type === "tool-simulate_qiskit" ||
    type === "tool-simulate_pennylane" ||
    type === "tool-simulate_cirq"
  );
}

function getFrameworkFromSimulationToolType(
  type: string,
): QuantumFramework | undefined {
  if (type === "tool-simulate_qiskit") return "qiskit";
  if (type === "tool-simulate_pennylane") return "pennylane";
  if (type === "tool-simulate_cirq") return "cirq";
  return undefined;
}

function getFinalGeneratedCode(
  messages: UIMessage[],
  busy: boolean,
): FinalGeneratedCode | null {
  if (busy) return null;

  const toolParts = getLatestRunToolParts(messages);

  for (const part of [...toolParts].reverse()) {
    if (!isSimulationToolType(part.type)) continue;
    if (part.output?.ok !== true || !part.input?.code) continue;
    return {
      code: part.input.code,
      toolName: part.type.replace(/^tool-/, ""),
      framework: getFrameworkFromSimulationToolType(part.type),
      purpose: part.input.purpose,
    };
  }

  return null;
}

function getFinalOpenQasm(
  messages: UIMessage[],
  busy: boolean,
): FinalOpenQasm | null {
  if (busy) return null;

  const toolParts = getLatestRunToolParts(messages);

  for (const part of [...toolParts].reverse()) {
    if (part.type !== "tool-convert_to_openqasm") continue;
    if (part.output?.ok !== true || !part.output.openqasm) continue;
    return {
      openqasm: part.output.openqasm,
      framework: part.output.framework,
      openqasmVersion: part.output.openqasmVersion,
      editorOpenqasm: part.output.editorOpenqasm,
      convertedFrameworkCodes: part.output.convertedFrameworkCodes,
      extractionCode: part.output.extractionCode,
      notes: part.output.notes,
    };
  }

  return null;
}

function getFinalAnalysisReport(
  messages: UIMessage[],
  busy: boolean,
): AnalysisReport | null {
  if (busy) return null;

  const toolParts = getLatestRunToolParts(messages);

  const planPart = [...toolParts]
    .reverse()
    .find((part) => part.type === "tool-request_plan" && part.output?.plan);
  const simulationPart = [...toolParts]
    .reverse()
    .find((part) => isSimulationToolType(part.type) && part.output?.ok === true);
  const verifyPart = [...toolParts]
    .reverse()
    .find((part) => part.type === "tool-verify_intent_alignment" && part.output);
  const openqasmPart = [...toolParts]
    .reverse()
    .find((part) => part.type === "tool-convert_to_openqasm" && part.output);

  if (!planPart && !simulationPart && !verifyPart) return null;

  const userRequest = stripAdvancedSettings(getLatestMessageText(messages, "user"));
  const assistantSummary = getLatestAssistantText(messages);
  const artifacts = [
    simulationPart?.input?.code ? "Pythonソース" : null,
    openqasmPart?.output?.openqasm ? "OpenQASM" : null,
    openqasmPart?.output?.convertedFrameworkCodes
      ? "フレームワーク変換コード"
      : null,
    "Markdownレポート",
    "JSONレポート",
  ].filter((item): item is string => Boolean(item));
  const limitations = buildReportLimitations({
    simulationPart,
    verifyPart,
    openqasmPart,
  });

  return {
    title: "namekoQ 分析レポート",
    createdAt: new Date().toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    userRequest,
    assistantSummary,
    plan: planPart?.output?.plan,
    simulation: simulationPart
      ? {
          toolName: simulationPart.type.replace(/^tool-/, ""),
          framework: getFrameworkFromSimulationToolType(simulationPart.type),
          purpose: simulationPart.input?.purpose,
          durationMs: simulationPart.output?.durationMs,
          parsed: simulationPart.output?.parsed,
          stderr: simulationPart.output?.stderr,
        }
      : undefined,
    verification: verifyPart?.output
      ? {
          aligned: verifyPart.output.aligned,
          confidence: verifyPart.output.confidence,
          mismatches: verifyPart.output.mismatches,
          suggestions: verifyPart.output.suggestions,
          summary: verifyPart.output.summary,
          durationMs: verifyPart.output.durationMs,
        }
      : undefined,
    openqasm: openqasmPart?.output
      ? {
          ok: openqasmPart.output.ok,
          framework: openqasmPart.output.framework,
          version: openqasmPart.output.openqasmVersion,
          notes: openqasmPart.output.notes,
          error: openqasmPart.output.openqasmError,
        }
      : undefined,
    artifacts,
    limitations,
  };
}

function getLatestRunToolParts(messages: UIMessage[]): ToolPartShape[] {
  const latestUserIndex = findLatestMessageIndex(messages, "user");
  const scopedMessages =
    latestUserIndex >= 0 ? messages.slice(latestUserIndex + 1) : messages;
  return getToolParts(scopedMessages);
}

function getToolParts(messages: UIMessage[]): ToolPartShape[] {
  return messages
    .flatMap((message) => message.parts)
    .filter((part): part is UIMessage["parts"][number] & { type: string } =>
      part.type.startsWith("tool-"),
    )
    .map((part) => part as ToolPartShape);
}

function findLatestMessageIndex(
  messages: UIMessage[],
  role: "user" | "assistant",
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === role) return i;
  }
  return -1;
}

function getLatestMessageText(
  messages: UIMessage[],
  role: "user" | "assistant",
): string {
  const message = [...messages].reverse().find((item) => item.role === role);
  if (!message) return "";
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
      part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function getLatestAssistantText(messages: UIMessage[]): string | undefined {
  const text = getLatestMessageText(messages, "assistant");
  return text.length > 0 ? text : undefined;
}

function stripAdvancedSettings(text: string): string {
  return text.split("\n\n追加設定:")[0]?.trim() ?? text.trim();
}

function getReportOverviewText(summary?: string): string | undefined {
  if (!summary?.trim()) return undefined;

  const lines = summary.replace(/\r\n/g, "\n").split("\n");
  const overview: string[] = [];
  let inCode = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      if (overview.length > 0) break;
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    if (/^---+$/.test(line)) {
      if (overview.length > 0) break;
      continue;
    }

    if (/^\|.*\|$/.test(line)) {
      if (overview.length > 0) break;
      continue;
    }

    if (/^#{2,4}\s+/.test(line)) {
      if (overview.length > 0) break;
      continue;
    }

    if (!line) {
      if (overview.length > 0 && overview[overview.length - 1] !== "") {
        overview.push("");
      }
      continue;
    }

    overview.push(rawLine);
    if (overview.filter((item) => item.trim()).length >= 4) break;
  }

  const text = overview.join("\n").trim();
  return text.length > 0 ? text : summary.trim();
}

function createReportDetailedAnalysis(report: AnalysisReport): string {
  const narrative = getAssistantAnalysisText(report.assistantSummary);
  const generatedInsights = createReportInsightLines(report);
  const sections: string[] = [];

  if (narrative) sections.push(narrative);
  if (generatedInsights.length > 0) {
    sections.push(
      compactMarkdownLines([
        "### 追加分析",
        "",
        ...generatedInsights.map((item) => `- ${item}`),
      ]),
    );
  }

  return sections.join("\n\n").trim();
}

function getAssistantAnalysisText(summary?: string): string | undefined {
  if (!summary?.trim()) return undefined;

  const lines = summary.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let inCode = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    if (/^#{2,4}\s+.*OpenQASM/i.test(line)) break;
    if (/^#{2,4}\s+.*成果物/.test(line)) break;
    if (/^#{2,4}\s+.*コード/.test(line)) break;
    if (/^---+$/.test(line)) break;

    kept.push(rawLine);
  }

  const text = compactMarkdownLines(kept).trim();
  return text.length > 0 ? text : undefined;
}

function createReportInsightLines(report: AnalysisReport): string[] {
  const insights: string[] = [];
  const counts = report.simulation?.parsed ? findCounts(report.simulation.parsed) : null;
  const entries = counts
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])
    : [];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  if (report.plan?.problem_summary) {
    insights.push(`問題設定: ${report.plan.problem_summary}`);
  }
  if (report.plan?.research_question) {
    insights.push(`研究質問: ${report.plan.research_question}`);
  }
  if (report.plan?.method?.approach) {
    insights.push(`研究方法: ${report.plan.method.approach}`);
  }
  if (report.plan?.validation_plan?.checks?.length) {
    insights.push(
      `検証計画: ${report.plan.validation_plan.checks.slice(0, 3).join(", ")}`,
    );
  }
  if (report.plan?.algorithm_rationale) {
    insights.push(`手法選定: ${report.plan.algorithm_rationale}`);
  }
  if (report.plan?.research_validation?.approximation_strategy) {
    insights.push(
      `近似方針: ${report.plan.research_validation.approximation_strategy}`,
    );
  }
  if (report.plan?.research_validation?.baseline_methods?.length) {
    insights.push(
      `ベースライン: ${report.plan.research_validation.baseline_methods.join(", ")}`,
    );
  }

  if (entries.length > 0 && total > 0) {
    const [topState, topValue] = entries[0];
    const topPct = formatPercent(topValue / total);
    const observedStates = entries.map(([state]) => state).join(", ");
    insights.push(
      `測定分布: ${formatNumber(total)} shots 中、最頻状態は \`${topState}\` の ${formatNumber(topValue)} 回（${topPct}）です。`,
    );
    insights.push(`観測された状態: ${observedStates}`);

    if (entries.length === 2) {
      const [, secondValue] = entries[1];
      const gap = Math.abs(topValue - secondValue);
      insights.push(
        `上位2状態の差は ${formatNumber(gap)} 回（${formatPercent(gap / total)}）で、ほぼ均等な重ね合わせか、明確な偏りがあるかを確認できます。`,
      );
    } else if (entries.length > 2) {
      const covered = entries.slice(0, 3).reduce((sum, [, value]) => sum + value, 0);
      insights.push(
        `上位3状態で全体の ${formatPercent(covered / total)} を占めています。残りの状態はノイズ、回路設計、または確率分布の広がりとして確認対象になります。`,
      );
    }
  }

  const resultItems = report.simulation?.parsed
    ? extractReportResultItems(report.simulation.parsed)
    : [];
  if (resultItems.length > 0) {
    insights.push(
      `主要指標: ${resultItems
        .slice(0, 5)
        .map((item) => `${item.key}=${item.value}`)
        .join(", ")}`,
    );
  }

  if (report.verification?.summary) {
    insights.push(`検証結果: ${report.verification.summary}`);
  }
  if (report.verification?.aligned === false) {
    insights.push("要確認: critic が要望との不一致を検出しています。不一致項目と修正案を優先して確認してください。");
  } else if (report.verification?.aligned === true) {
    insights.push("整合性: critic は実行内容とユーザー要望がおおむね整合していると判定しています。");
  }

  if (report.openqasm?.ok) {
    insights.push(
      `再利用性: OpenQASM${report.openqasm.version ? ` ${report.openqasm.version}` : ""} を抽出済みなので、回路の再実行や他フレームワークへの移植に使えます。`,
    );
  }

  return Array.from(new Set(insights));
}

function buildReportLimitations({
  simulationPart,
  verifyPart,
  openqasmPart,
}: {
  simulationPart?: ToolPartShape;
  verifyPart?: ToolPartShape;
  openqasmPart?: ToolPartShape;
}): string[] {
  const items = new Set<string>();
  items.add(
    "LLMが生成したコードは、研究上の結論に使う前に必ずレビューしてください。",
  );
  items.add(
    "OpenQASM成果物は回路部分のみを表します。Hamiltonian、optimizer、古典後処理は含まれない場合があります。",
  );

  if (simulationPart?.output?.stderr?.trim()) {
    items.add("シミュレーションでstderrが出力されました。詳細ログを確認してください。");
  }
  if (verifyPart?.output?.aligned === false) {
    items.add("criticは、この実行が要望と完全には整合していないと判定しました。");
  }
  if (verifyPart?.output?.suggestions?.length) {
    for (const suggestion of verifyPart.output.suggestions.slice(0, 3)) {
      items.add(suggestion);
    }
  }
  if (openqasmPart?.output?.ok === false || openqasmPart?.output?.openqasmError) {
    items.add("この実行ではOpenQASM抽出が不完全、または失敗しました。");
  }
  if (openqasmPart?.output?.notes?.length) {
    for (const note of openqasmPart.output.notes.slice(0, 4)) {
      items.add(note);
    }
  }

  return Array.from(items);
}

function getDefaultAppIdea(report: AnalysisReport | null): string {
  const algorithm = report?.plan?.algorithm ?? "";
  const result = isRecord(report?.simulation?.parsed)
    ? report?.simulation?.parsed
    : {};

  if (/qaoa/i.test(algorithm)) {
    if (result && ("selected_assets" in result || "counts_top" in result)) {
      return "QAOAの測定結果を使った意思決定ダッシュボード。上位bitstring、候補選択、目的関数値を比較し、最終候補を確認できるようにします。";
    }
    return "QAOA候補解の最適化結果ビューア。解を選ぶ前にbitstring分布と制約充足を比較できます。";
  }

  if (/vqe/i.test(algorithm)) {
    return "VQE結果の実験レポート兼エネルギー確認ツール。推定エネルギー、パラメータ、既知参照との差、モデル上の制約を確認できます。";
  }

  if (/grover/i.test(algorithm)) {
    return "Grover結果の探索デモアプリ。ターゲット、観測された上位状態、成功確率を表示します。";
  }

  if (/qpe|phase/i.test(algorithm)) {
    return "位相推定アプリ。推定位相、候補bitstring、ターゲット値との差を比較します。";
  }

  if (/bell|ghz/i.test(algorithm)) {
    return "Bell/GHZ結果のエンタングルメント測定ビューア。相関した測定結果と回路成果物を表示します。";
  }

  return "最終量子回路と実行結果から作る小さな分析アプリ。単に回路を表示するだけでなく、結果の解釈と活用を支援します。";
}

function createReportMarkdown(report: AnalysisReport): string {
  const resultItems = report.simulation?.parsed
    ? extractReportResultItems(report.simulation.parsed)
    : [];
  const counts = report.simulation?.parsed ? findCounts(report.simulation.parsed) : null;
  const topCounts = counts
    ? Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    : [];
  const detailedAnalysis = createReportDetailedAnalysis(report);

  return compactMarkdownLines([
    `# ${report.title}`,
    "",
    `- 作成日時: ${report.createdAt}`,
    `- タスク種別: ${
      report.plan?.task_type ? getTaskTypeLabel(report.plan.task_type) : "-"
    }`,
    `- フレームワーク: ${report.plan?.framework ?? report.simulation?.framework ?? "-"}`,
    `- アルゴリズム: ${report.plan?.algorithm ?? "-"}`,
    `- 検証: ${
      report.verification?.aligned == null
        ? "-"
        : report.verification.aligned
        ? "整合"
        : "要確認"
    }`,
    "",
    "## 概要",
    "",
    getReportOverviewText(report.assistantSummary) ??
      "最終サマリーは取得できませんでした。",
    "",
    ...(detailedAnalysis
      ? [
          "## 詳しい分析",
          "",
          detailedAnalysis,
          "",
        ]
      : []),
    "",
    "## ユーザー要望",
    "",
    report.userRequest || "-",
    "",
    "## 手法",
    "",
    `- 研究質問: ${report.plan?.research_question ?? "-"}`,
    `- ドメイン: ${report.plan?.domain ?? "-"}`,
    `- フレームワーク: ${report.plan?.framework ?? "-"}`,
    `- アルゴリズム: ${report.plan?.algorithm ?? "-"}`,
    `- 量子ビット数: ${report.plan?.qubits_estimate ?? "-"}`,
    `- 実行時間見積もり: ${
      report.plan?.expected_runtime_sec != null
        ? `${report.plan.expected_runtime_sec}s`
        : "-"
    }`,
    "",
    report.plan?.problem_summary ? `問題概要: ${report.plan.problem_summary}` : "",
    report.plan?.algorithm_rationale
      ? `選定理由: ${report.plan.algorithm_rationale}`
      : "",
    "",
    ...(report.plan?.method
      ? [
          "## 研究方法",
          "",
          "```json",
          JSON.stringify(report.plan.method, null, 2),
          "```",
          "",
        ]
      : []),
    ...(report.plan?.sources_used?.length
      ? [
          "## 参照ソース",
          "",
          "```json",
          JSON.stringify(report.plan.sources_used, null, 2),
          "```",
          "",
        ]
      : []),
    "## パラメータ",
    "",
    "```json",
    JSON.stringify(report.plan?.parameters ?? {}, null, 2),
    "```",
    "",
    ...(report.plan?.validation_plan
      ? [
          "## 検証計画",
          "",
          "```json",
          JSON.stringify(report.plan.validation_plan, null, 2),
          "```",
          "",
        ]
      : []),
    ...(hasNonEmptyList(report.plan?.uncertainty) ||
    hasNonEmptyList(report.plan?.limitations)
      ? [
          "## 不確実性と制約",
          "",
          "```json",
          JSON.stringify(
            {
              uncertainty: report.plan?.uncertainty ?? [],
              limitations: report.plan?.limitations ?? [],
            },
            null,
            2,
          ),
          "```",
          "",
        ]
      : []),
    ...(report.plan?.research_validation
      ? [
          "## 研究検証プロトコル",
          "",
          "```json",
          JSON.stringify(report.plan.research_validation, null, 2),
          "```",
          "",
        ]
      : []),
    "## 主要結果",
    "",
    ...(resultItems.length > 0
      ? resultItems.map((metric) => `- ${metric.key}: ${metric.value}`)
      : ["- スカラー指標は検出されませんでした。"]),
    "",
    ...(topCounts.length > 0
      ? [
          "## 測定結果",
          "",
          "| State | Count |",
          "|---|---:|",
          ...topCounts.map(([state, value]) => `| ${state} | ${value} |`),
          "",
        ]
      : []),
    "## 検証",
    "",
    `- 整合: ${report.verification?.aligned ?? "-"}`,
    `- 信頼度: ${report.verification?.confidence ?? "-"}`,
    report.verification?.summary ?? "",
    "",
    ...(report.verification?.mismatches?.length
      ? [
          "### 不一致",
          "",
          ...report.verification.mismatches.map(
            (item) =>
              `- ${item.aspect}: 期待 ${item.expected}; 実際 ${item.actual}`,
          ),
          "",
        ]
      : []),
    ...(report.verification?.suggestions?.length
      ? [
          "### 修正案",
          "",
          ...report.verification.suggestions.map((item) => `- ${item}`),
          "",
        ]
      : []),
    "## OpenQASM",
    "",
    `- 状態: ${report.openqasm?.ok ? "抽出済み" : "利用不可"}`,
    `- バージョン: ${report.openqasm?.version ?? "-"}`,
    ...(report.openqasm?.notes?.length
      ? ["", ...report.openqasm.notes.map((note) => `- ${note}`)]
      : []),
    report.openqasm?.error ? `\nエラー: ${report.openqasm.error}` : "",
    "",
    "## 制約",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
    "## 成果物",
    "",
    ...report.artifacts.map((artifact) => `- ${artifact}`),
    "",
  ]);
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function compactMarkdownLines(lines: Array<string | undefined>): string {
  const compacted: string[] = [];
  for (const line of lines) {
    if (line === undefined) continue;
    const isBlank = line.trim() === "";
    const previousBlank = compacted[compacted.length - 1]?.trim() === "";
    if (isBlank && previousBlank) continue;
    compacted.push(line);
  }
  return compacted.join("\n").trim() + "\n";
}

function createReportFilenameBase(report: AnalysisReport): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/T/, "_")
    .slice(0, 19);
  const algorithm = sanitizeFilenamePart(report.plan?.algorithm ?? "run");
  const framework = sanitizeFilenamePart(
    report.plan?.framework ?? report.simulation?.framework ?? "quantum",
  );
  return `namekoq-report_${framework}_${algorithm}_${timestamp}`;
}

function sanitizeFilenamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function extractReportResultItems(
  value: unknown,
): Array<{ key: string; value: string }> {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([key]) => !["counts", "counts_top", "measurement_counts"].includes(key))
    .map(([key, item]) => ({ key, value: formatReportValue(item) }))
    .filter((item) => item.value.length > 0)
    .slice(0, 12);
}

function formatReportValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  if (Array.isArray(value)) {
    const rendered = JSON.stringify(value);
    return rendered.length > 180 ? `${rendered.slice(0, 177)}...` : rendered;
  }
  if (isRecord(value)) {
    const rendered = JSON.stringify(value);
    return rendered.length > 220 ? `${rendered.slice(0, 217)}...` : rendered;
  }
  return String(value);
}

function withAdvancedSettings(
  text: string,
  settings: {
    accuracyMode: AccuracyMode;
    framework: FrameworkPreference;
    simulator: SimulatorPreference;
    shots: string;
    maxIterations: string;
  },
): string {
  const directives: string[] = [];

  if (settings.accuracyMode === "research") {
    directives.push(
      "研究精度モードで実行する",
      "request_plan の task_type / research_question / sources_used / method / validation_plan / uncertainty / limitations を必ず具体化する",
      "request_plan の research_validation に assumptions / approximation_strategy / baseline_methods / validation_checks / failure_modes を必ず入れる",
      "論文レベルのフルスケール再現が 16 qubit / 120秒制限で無理な場合は、縮小インスタンスまたはベンチマーク版として実行し、できない理由を明示する",
      "可能な範囲で古典ベースライン、厳密対角化、小規模既知解、複数seed、収束履歴、制約充足などを検証する",
      "結果dictには seed, assumptions, approximation_notes, validation_checks, baseline_comparison, convergence_trace を可能な限り含める",
      "論文と同等の精度・再現性を確認できない場合は、その限界を最終回答で明示する",
    );
  }

  if (settings.framework !== "auto") {
    directives.push(
      `フレームワークは ${getFrameworkLabel(settings.framework)} を使う`,
      "別フレームワークからの変換ではなく、選択したフレームワークのネイティブコードを生成する",
    );
  }

  const simulatorOption = getSimulatorOption(settings.simulator);
  if (settings.simulator !== "auto" && simulatorOption?.directive) {
    directives.push(
      `シミュレータは ${simulatorOption.label} を使う`,
      simulatorOption.directive,
    );
  }

  if (settings.shots !== "auto") {
    directives.push(`shots は ${settings.shots} にする`);
  }
  if (settings.maxIterations !== "auto") {
    directives.push(
      `VQE/QAOA の max_iterations は ${settings.maxIterations} にする`,
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

function withAttachmentContext(text: string, files: File[]): string {
  if (files.length === 0) return text;

  return [
    text.trim(),
    "",
    "添付ファイル:",
    ...files.map(
      (file, index) =>
        `- ${index + 1}. ${file.name} (${inferMediaType(file)}, ${formatFileSize(file.size)})`,
    ),
    "",
    "添付ファイルの内容を参照し、画像・PDF・コード・データの情報を問題設定や検証に反映してください。",
  ].join("\n");
}

function dedupeFiles(files: File[]): File[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = [file.name, file.size, file.lastModified].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fileToUIPart(file: File): Promise<FileUIPart> {
  return {
    type: "file",
    mediaType: inferMediaType(file),
    filename: file.name,
    url: await readFileAsDataUrl(file),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("ファイルを読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
}

function inferMediaType(file: File): string {
  if (file.type) return file.type;

  const extension = getFileExtension(file.name);
  return (
    FALLBACK_MEDIA_TYPES[extension] ??
    inferImageMediaTypeFromExtension(extension) ??
    "application/octet-stream"
  );
}

function inferImageMediaTypeFromExtension(extension: string): string | null {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return null;
}

function getFileExtension(filename: string): string {
  const lastSegment = filename.split(/[\\/]/).pop() ?? filename;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) return "";
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

function fileExtensionLabel(filename: string): string {
  const extension = getFileExtension(filename);
  return extension ? extension.slice(0, 5).toUpperCase() : "FILE";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toLocaleString("ja-JP", {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  })} ${units[unitIndex]}`;
}

function getFrameworkLabel(framework: QuantumFramework): string {
  if (framework === "pennylane") return "PennyLane";
  if (framework === "cirq") return "Cirq";
  return "Qiskit";
}

function getTaskTypeLabel(taskType: NonNullable<PlanShape["task_type"]>): string {
  const labels: Record<NonNullable<PlanShape["task_type"]>, string> = {
    literature_review: "文献調査",
    derivation_check: "数式確認",
    data_analysis: "データ解析",
    quantum_simulation: "量子シミュレーション",
    paper_reproduction: "論文再現",
    experiment_design: "実験設計",
    general_research: "汎用研究",
    other: "その他",
  };
  return labels[taskType] ?? taskType;
}

function getFrameworkPreferenceLabel(framework: FrameworkPreference): string {
  if (framework === "auto") return "自動";
  return getFrameworkLabel(framework);
}

function getSimulatorOptions(framework: FrameworkPreference): SimulatorOption[] {
  if (framework === "auto") return [SIMULATOR_OPTIONS[0]];
  return SIMULATOR_OPTIONS.filter(
    (option) => option.id === "auto" || option.framework === framework,
  );
}

function getSimulatorOption(
  simulator: SimulatorPreference,
): SimulatorOption | undefined {
  return SIMULATOR_OPTIONS.find((option) => option.id === simulator);
}

function convertedFormatId(framework: QuantumFramework): OutputFormatId {
  return `converted:${framework}`;
}

function normalizeOpenQasmForEditor(openqasm: string): string {
  if (!openqasm) return "";

  return openqasm
    .replace(/[αΑ]/g, "alpha")
    .replace(/[βΒ]/g, "beta")
    .replace(/[γΓ]/g, "gamma")
    .replace(/[δΔ]/g, "delta")
    .replace(/[θΘ]/g, "theta")
    .replace(/[λΛ]/g, "lambda")
    .replace(/[μΜ]/g, "mu")
    .replace(/[πΠ]/g, "pi")
    .replace(/[φΦ]/g, "phi")
    .replace(/[ψΨ]/g, "psi")
    .replace(/[ωΩ]/g, "omega")
    .replace(/[^\x00-\x7F]/g, "_");
}

function getEditorCompatibleOpenQasm(openqasm: FinalOpenQasm | null): string {
  const preferred = normalizeOpenQasmForEditor(openqasm?.editorOpenqasm ?? "");
  if (isEditorCompatibleOpenQasm(preferred)) return preferred;

  const fallback = normalizeOpenQasmForEditor(openqasm?.openqasm ?? "");
  if (isEditorCompatibleOpenQasm(fallback)) return fallback;

  return "";
}

function isEditorCompatibleOpenQasm(openqasm: string): boolean {
  const trimmed = openqasm.trimStart();
  if (!trimmed) return false;
  if (!trimmed.startsWith("OPENQASM 2")) return false;

  return !openqasm.split("\n").some((line) => {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("//")) return false;
    return stripped.includes("=");
  });
}

function createDirectRunCode({
  selectedFormat,
  editedCode,
  liveOpenqasm,
  liveOpenqasmVersion,
  targetFramework,
  simulator,
}: {
  selectedFormat: OutputFormatId;
  editedCode: string;
  liveOpenqasm: string;
  liveOpenqasmVersion?: string;
  targetFramework: QuantumFramework;
  simulator: SimulatorPreference;
}): { code: string; source: "source" | "openqasm" | "converted" } {
  if (selectedFormat === "source") {
    return { code: editedCode, source: "source" };
  }

  if (liveOpenqasm) {
    return {
      code: createClientFrameworkConversionCode({
        target: targetFramework,
        openqasm: liveOpenqasm,
        openqasmVersion: liveOpenqasmVersion,
        simulator,
      }),
      source: selectedFormat === "openqasm" ? "openqasm" : "converted",
    };
  }

  return { code: editedCode, source: "converted" };
}

function inferOpenQasmVersion(
  openqasm: string,
  fallback?: string | null,
): string | null {
  const trimmed = openqasm.trimStart();
  if (trimmed.startsWith("OPENQASM 3")) return "3.0";
  if (trimmed.startsWith("OPENQASM 2")) return "2.0";
  return fallback ?? null;
}

function createClientFrameworkConversionCodes({
  openqasm,
  openqasmVersion,
}: {
  openqasm: string;
  openqasmVersion?: string;
}): Partial<Record<QuantumFramework, string>> {
  return Object.fromEntries(
    QUANTUM_FRAMEWORKS.map((framework) => [
      framework,
      createClientFrameworkConversionCode({
        target: framework,
        openqasm,
        openqasmVersion,
      }),
    ]),
  );
}

function createClientFrameworkConversionCode({
  target,
  openqasm,
  openqasmVersion,
  simulator = "auto",
}: {
  target: QuantumFramework;
  openqasm: string;
  openqasmVersion?: string;
  simulator?: SimulatorPreference;
}) {
  const qasmLiteral = JSON.stringify(openqasm);
  const isQasm3 =
    openqasmVersion === "3.0" || openqasm.trimStart().startsWith("OPENQASM 3");
  const qiskitMethod =
    simulator === "qiskit_aer_statevector"
      ? "method='statevector'"
      : simulator === "qiskit_aer_density_matrix"
      ? "method='density_matrix'"
      : simulator === "qiskit_aer_mps"
      ? "method='matrix_product_state'"
      : "";
  const pennylaneDevice =
    simulator === "pennylane_default_mixed"
      ? "default.mixed"
      : simulator === "pennylane_lightning_qubit"
      ? "lightning.qubit"
      : "default.qubit";
  const cirqSimulator =
    simulator === "cirq_density_matrix"
      ? "cirq.DensityMatrixSimulator()"
      : simulator === "cirq_clifford"
      ? "cirq.CliffordSimulator()"
      : "cirq.Simulator()";

  if (target === "qiskit") {
    return `
from qiskit import qasm2, qasm3
from qiskit_aer import AerSimulator

openqasm = ${qasmLiteral}

qc = ${isQasm3 ? "qasm3.loads(openqasm)" : "qasm2.loads(openqasm)"}

simulator = AerSimulator(${qiskitMethod})
result = simulator.run(qc, shots=1024).result()
payload = {"simulator": "AerSimulator${qiskitMethod ? `(${qiskitMethod})` : "()"}"}
try:
    payload["counts"] = result.get_counts()
except Exception:
    payload["result"] = str(result)
print(payload)
`.trim();
  }

  if (target === "pennylane") {
    return `
import re
import pennylane as qml

openqasm = ${qasmLiteral}

def infer_wires(qasm: str) -> int:
    qasm2 = re.search(r"qreg\\s+\\w+\\[(\\d+)\\]", qasm)
    if qasm2:
        return int(qasm2.group(1))
    qasm3 = re.search(r"qubit\\[(\\d+)\\]\\s+\\w+", qasm)
    if qasm3:
        return int(qasm3.group(1))
    return 1

quantum_fn = ${isQasm3 ? "qml.from_qasm3(openqasm)" : "qml.from_qasm(openqasm)"}
n_wires = infer_wires(openqasm)
dev = qml.device(${JSON.stringify(pennylaneDevice)}, wires=n_wires)

@qml.qnode(dev)
def circuit():
    quantum_fn()
    return qml.probs(wires=range(n_wires))

probs = circuit()
print({"probabilities": probs.tolist(), "wires": n_wires, "simulator": ${JSON.stringify(pennylaneDevice)}})
`.trim();
  }

  return `
# Requires cirq-core plus the optional parser dependency:
#   pip install ply
import cirq
from cirq.contrib.qasm_import import circuit_from_qasm

openqasm = ${qasmLiteral}

if openqasm.lstrip().startswith("OPENQASM 3"):
    from qiskit import qasm2, qasm3
    openqasm = qasm2.dumps(qasm3.loads(openqasm))

circuit = circuit_from_qasm(openqasm)
simulator = ${cirqSimulator}
result = simulator.run(circuit, repetitions=1024)
print({"measurements": {k: v.tolist() for k, v in result.measurements.items()}, "simulator": ${JSON.stringify(cirqSimulator)}})
`.trim();
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

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("ja-JP", {
    maximumFractionDigits: 1,
    style: "percent",
  });
}

function getStepStateLabel(state: ActivityStep["state"]): string {
  if (state === "active") return "実行中";
  if (state === "done") return "完了";
  if (state === "error") return "確認";
  return "待機";
}
