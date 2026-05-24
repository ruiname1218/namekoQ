"use client";

import { useEffect, useMemo, useState } from "react";
import QuantumCircuit from "quantum-circuit/dist/quantum-circuit.min.js";

interface BlochVector {
  wire: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  thetaDeg: number;
  phiDeg: number;
}

interface BlochAnalysis {
  vectors: BlochVector[];
  errors: string[];
  warnings: string[];
}

interface BlochAngle {
  x: number;
  y: number;
  z: number;
  radius: number;
  thetaDeg: number;
  phiDeg: number;
}

interface GateCell {
  name: string;
}

const MAX_BLOCH_QUBITS = 10;

export function BlochSpherePanel({ openqasm }: { openqasm: string }) {
  const analysis = useMemo(() => analyzeBloch(openqasm), [openqasm]);
  const [selectedWire, setSelectedWire] = useState(0);
  const selectedVector =
    analysis.vectors.find((vector) => vector.wire === selectedWire) ??
    analysis.vectors[0];

  useEffect(() => {
    if (!analysis.vectors.some((vector) => vector.wire === selectedWire)) {
      setSelectedWire(analysis.vectors[0]?.wire ?? 0);
    }
  }, [analysis.vectors, selectedWire]);

  return (
    <section className="border-t border-[var(--border)] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em]">
            Bloch球
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            測定前の単一qubit状態
          </div>
        </div>
        {selectedVector && (
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
            Qubit
            <select
              value={selectedVector.wire}
              onChange={(event) => setSelectedWire(Number(event.target.value))}
              className="rounded-sm border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-xs text-[var(--fg)] outline-none focus:border-[var(--ink)]"
            >
              {analysis.vectors.map((vector) => (
                <option key={vector.wire} value={vector.wire}>
                  q{vector.wire}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {analysis.errors.length > 0 ? (
        <div className="p-4 text-sm text-[var(--muted)]">
          {analysis.errors.join(" / ")}
        </div>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
          {selectedVector && <BlochSphere vector={selectedVector} />}

          <div className="min-w-0">
            {analysis.warnings.length > 0 && (
              <div className="mb-3 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
                {analysis.warnings.join(" / ")}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {analysis.vectors.map((vector) => (
                <button
                  key={vector.wire}
                  type="button"
                  onClick={() => setSelectedWire(vector.wire)}
                  className={[
                    "rounded-sm border px-3 py-2 text-left transition",
                    selectedVector?.wire === vector.wire
                      ? "border-[var(--ink)] bg-white"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold">
                      q{vector.wire}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      r {formatScalar(vector.radius)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px] text-[var(--muted)]">
                    <span>x {formatScalar(vector.x)}</span>
                    <span>y {formatScalar(vector.y)}</span>
                    <span>z {formatScalar(vector.z)}</span>
                  </div>
                </button>
              ))}
            </div>

            {selectedVector && (
              <div className="mt-4 grid gap-2 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--muted)] sm:grid-cols-3">
                <span>theta {formatScalar(selectedVector.thetaDeg)} deg</span>
                <span>phi {formatScalar(selectedVector.phiDeg)} deg</span>
                <span>
                  purity {formatScalar((1 + selectedVector.radius ** 2) / 2)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function BlochSphere({ vector }: { vector: BlochVector }) {
  const center = { x: 140, y: 140 };
  const radius = 96;
  const tip = projectBloch(vector, center, radius);
  const xAxis = [projectBloch({ x: -1, y: 0, z: 0 }, center, radius), projectBloch({ x: 1, y: 0, z: 0 }, center, radius)];
  const yAxis = [projectBloch({ x: 0, y: -1, z: 0 }, center, radius), projectBloch({ x: 0, y: 1, z: 0 }, center, radius)];
  const zAxis = [projectBloch({ x: 0, y: 0, z: -1 }, center, radius), projectBloch({ x: 0, y: 0, z: 1 }, center, radius)];

  return (
    <div className="flex min-h-80 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--surface)]">
      <svg
        viewBox="0 0 280 280"
        role="img"
        aria-label={`Bloch sphere q${vector.wire}`}
        className="h-full max-h-80 w-full max-w-80"
      >
        <defs>
          <radialGradient id="bloch-sphere-fill" cx="42%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#eeeeee" />
          </radialGradient>
          <marker
            id="bloch-arrow"
            markerHeight="8"
            markerWidth="8"
            orient="auto-start-reverse"
            refX="6"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="#111111" />
          </marker>
        </defs>

        <circle
          cx={center.x}
          cy={center.y}
          r={radius}
          fill="url(#bloch-sphere-fill)"
          stroke="#b8b8b8"
          strokeWidth="1.25"
        />
        <ellipse
          cx={center.x}
          cy={center.y}
          rx={radius}
          ry={32}
          fill="none"
          stroke="#d5d5d5"
          strokeWidth="1"
        />
        <path
          d={`M ${center.x - radius} ${center.y} Q ${center.x} ${center.y - 34} ${center.x + radius} ${center.y}`}
          fill="none"
          stroke="#cfcfcf"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <Axis from={xAxis[0]} to={xAxis[1]} label="x" />
        <Axis from={yAxis[0]} to={yAxis[1]} label="y" />
        <Axis from={zAxis[0]} to={zAxis[1]} label="z" />
        <line
          x1={center.x}
          y1={center.y}
          x2={tip.x}
          y2={tip.y}
          stroke="#111111"
          strokeWidth="2.5"
          markerEnd="url(#bloch-arrow)"
        />
        <circle cx={center.x} cy={center.y} r="3" fill="#111111" />
        <circle cx={tip.x} cy={tip.y} r="4" fill="#111111" />
        <text
          x="14"
          y="26"
          fill="#6f6f6f"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fontSize="12"
        >
          q{vector.wire}
        </text>
        <text
          x="14"
          y="44"
          fill="#6f6f6f"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fontSize="11"
        >
          vector ({formatScalar(vector.x)}, {formatScalar(vector.y)},{" "}
          {formatScalar(vector.z)})
        </text>
      </svg>
    </div>
  );
}

function Axis({
  from,
  to,
  label,
}: {
  from: Point;
  to: Point;
  label: string;
}) {
  return (
    <>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="#a9a9a9"
        strokeWidth="1"
      />
      <text
        x={to.x + (to.x >= 140 ? 8 : -12)}
        y={to.y + (to.y >= 140 ? 12 : -8)}
        fill="#6f6f6f"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        fontSize="12"
      >
        {label}
      </text>
    </>
  );
}

interface Point {
  x: number;
  y: number;
}

function projectBloch(
  vector: Pick<BlochVector, "x" | "y" | "z">,
  center: Point,
  radius: number,
): Point {
  return {
    x: center.x + radius * (0.82 * vector.x - 0.42 * vector.y),
    y: center.y + radius * (-0.88 * vector.z + 0.36 * vector.y),
  };
}

function analyzeBloch(openqasm: string): BlochAnalysis {
  const errors: string[] = [];
  const warnings: string[] = [];
  const source = openqasm.trim();

  if (!source) {
    return { vectors: [], errors: ["OpenQASMが空です。"], warnings };
  }

  if (source.startsWith("OPENQASM 3")) {
    return {
      vectors: [],
      errors: ["Bloch球表示は現在OpenQASM 2.0入力に対応しています。"],
      warnings,
    };
  }

  try {
    const parsed = new QuantumCircuit(1);
    parsed.importQASM(source, (items) => {
      if (items.length > 0) errors.push(...items.map(formatImportError));
    });
    if (errors.length > 0) return { vectors: [], errors, warnings };

    if (parsed.numQubits > MAX_BLOCH_QUBITS) {
      return {
        vectors: [],
        errors: [
          `Bloch sphere is limited to ${MAX_BLOCH_QUBITS} qubits for browser simulation.`,
        ],
        warnings,
      };
    }

    if (hasMeasurement(parsed)) {
      warnings.push("この可視化ではmeasure gateを無視します。");
    }

    const simulation = new QuantumCircuit(1);
    simulation.importQASM(source, (items) => {
      if (items.length > 0) errors.push(...items.map(formatImportError));
    });
    if (errors.length > 0) return { vectors: [], errors, warnings };

    simulation.removeMeasurementAndClassicalControl();
    simulation.run(null, { partitioning: false });

    const vectors = simulation.angles().map((angle: BlochAngle, wire: number) => ({
      wire,
      x: clampUnit(angle.x),
      y: clampUnit(angle.y),
      z: clampUnit(angle.z),
      radius: clamp(angle.radius, 0, 1),
      thetaDeg: normalizeNearZero(angle.thetaDeg),
      phiDeg: normalizeNearZero(angle.phiDeg),
    }));

    return { vectors, errors, warnings };
  } catch (err) {
    return {
      vectors: [],
      errors: [err instanceof Error ? err.message : String(err)],
      warnings,
    };
  }
}

function hasMeasurement(circuit: QuantumCircuit): boolean {
  return circuit.gates.some((row) =>
    row.some((gate) => Boolean(gate && (gate as GateCell).name === "measure")),
  );
}

function formatImportError(item: unknown): string {
  if (isRecord(item)) {
    const line = typeof item.line === "number" ? item.line : null;
    const col = typeof item.col === "number" ? item.col : null;
    const msg = typeof item.msg === "string" ? item.msg : String(item);
    if (line !== null && col !== null) return `line ${line}:${col} ${msg}`;
    return msg;
  }
  return String(item);
}

function formatScalar(value: number): string {
  if (!Number.isFinite(value)) return "0.000";
  return normalizeNearZero(value).toFixed(3);
}

function clampUnit(value: number): number {
  return clamp(normalizeNearZero(value), -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeNearZero(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
