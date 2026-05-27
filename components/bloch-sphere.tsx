"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  // Azimuth / elevation in radians — user can drag to rotate
  const [az, setAz] = useState(35 * (Math.PI / 180));
  const [el, setEl] = useState(20 * (Math.PI / 180));
  const dragRef = useRef<{ x: number; y: number; az: number; el: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return;
      // Prevent page scroll while rotating the sphere
      if ("touches" in e) e.preventDefault();
      const clientX =
        "touches" in e
          ? (e as TouchEvent).touches[0].clientX
          : (e as MouseEvent).clientX;
      const clientY =
        "touches" in e
          ? (e as TouchEvent).touches[0].clientY
          : (e as MouseEvent).clientY;
      const dx = clientX - dragRef.current.x;
      const dy = clientY - dragRef.current.y;
      setAz(dragRef.current.az - dx * 0.012);
      setEl(
        Math.max(
          -Math.PI / 2 + 0.05,
          Math.min(Math.PI / 2 - 0.05, dragRef.current.el - dy * 0.012),
        ),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  const CX = 140;
  const CY = 140;
  const R = 100;

  const cosA = Math.cos(az);
  const sinA = Math.sin(az);
  const cosB = Math.cos(el);
  const sinB = Math.sin(el);

  // Orthographic projection: right-hand coords (x=right, y=into-screen, z=up)
  // depth > 0 means farther from viewer (back hemisphere)
  function proj(x: number, y: number, z: number) {
    return {
      sx: CX + R * (cosA * x - sinA * y),
      sy: CY - R * (sinA * sinB * x + cosA * sinB * y + cosB * z),
      depth: sinA * cosB * x + cosA * cosB * y - sinB * z,
    };
  }

  type Pt3 = ReturnType<typeof proj>;

  // Latitude circle at height z0 ∈ [-1, 1]
  function latitudePts(z0: number, n = 80): Pt3[] {
    const r2 = Math.sqrt(Math.max(0, 1 - z0 * z0));
    return Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return proj(r2 * Math.cos(t), r2 * Math.sin(t), z0);
    });
  }

  // Meridian arc at azimuth phi, from north pole to south pole
  function meridianPts(phi: number, n = 80): Pt3[] {
    return Array.from({ length: n }, (_, i) => {
      const t = (i / (n - 1)) * Math.PI;
      return proj(
        Math.sin(t) * Math.cos(phi),
        Math.sin(t) * Math.sin(phi),
        Math.cos(t),
      );
    });
  }

  // Split a closed/open ring of points into solid (front) and dashed (back) path strings
  function splitPaths(pts: Pt3[]): { front: string; back: string } {
    const frontParts: string[] = [];
    const backParts: string[] = [];
    if (pts.length === 0) return { front: "", back: "" };
    let inFront = pts[0].depth <= 0;
    let seg = `M ${pts[0].sx.toFixed(2)} ${pts[0].sy.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const isFront = p.depth <= 0;
      if (isFront !== inFront) {
        (inFront ? frontParts : backParts).push(seg);
        seg = `M ${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`;
        inFront = isFront;
      } else {
        seg += ` L ${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`;
      }
    }
    (inFront ? frontParts : backParts).push(seg);
    return { front: frontParts.join(" "), back: backParts.join(" ") };
  }

  // Simple polyline path string
  function arcPath(pts: Pt3[]): string {
    return pts.reduce(
      (acc, p, i) =>
        acc +
        (i === 0
          ? `M ${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`
          : ` L ${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`),
      "",
    );
  }

  // Grid geometry
  const equatorPaths = splitPaths(latitudePts(0));
  const lat50paths = splitPaths(latitudePts(0.5));
  const latN50paths = splitPaths(latitudePts(-0.5));
  const mer0paths = splitPaths(meridianPts(0));
  const mer90paths = splitPaths(meridianPts(Math.PI / 2));

  // Poles and axes
  const poleN = proj(0, 0, 1);
  const poleS = proj(0, 0, -1);
  const axX1 = proj(-1.28, 0, 0);
  const axX2 = proj(1.28, 0, 0);
  const axY1 = proj(0, -1.28, 0);
  const axY2 = proj(0, 1.28, 0);
  const axZ1 = proj(0, 0, -1.28);
  const axZ2 = proj(0, 0, 1.28);

  // State vector
  const tip = proj(vector.x, vector.y, vector.z);
  const shadowTip = proj(vector.x, vector.y, 0); // equatorial projection

  // Angle arcs
  const thetaRad = (vector.thetaDeg * Math.PI) / 180;
  const phiRad = (vector.phiDeg * Math.PI) / 180;
  const N_ARC = 24;

  const thetaArcD = arcPath(
    Array.from({ length: N_ARC }, (_, i) => {
      const t = (i / (N_ARC - 1)) * thetaRad;
      return proj(
        0.38 * Math.sin(t) * Math.cos(phiRad),
        0.38 * Math.sin(t) * Math.sin(phiRad),
        0.38 * Math.cos(t),
      );
    }),
  );
  const thetaMid = proj(
    0.47 * Math.sin(thetaRad / 2) * Math.cos(phiRad),
    0.47 * Math.sin(thetaRad / 2) * Math.sin(phiRad),
    0.47 * Math.cos(thetaRad / 2),
  );

  const phiArcD = arcPath(
    Array.from({ length: N_ARC }, (_, i) => {
      const t = (i / (N_ARC - 1)) * phiRad;
      return proj(0.22 * Math.cos(t), 0.22 * Math.sin(t), 0);
    }),
  );
  const phiMid = proj(
    0.30 * Math.cos(phiRad / 2),
    0.30 * Math.sin(phiRad / 2),
    0,
  );

  const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, az, el };
    e.preventDefault();
  };
  const onTouchStart = (e: React.TouchEvent) => {
    dragRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      az,
      el,
    };
    e.preventDefault(); // prevent page scroll on touch-drag start
  };

  return (
    <div className="flex min-h-80 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--surface)]">
      <svg
        viewBox="0 0 280 280"
        role="img"
        aria-label={`Bloch sphere q${vector.wire}`}
        className="h-full max-h-80 w-full max-w-80 cursor-grab select-none active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        <defs>
          <radialGradient id="bloch-sphere-grad" cx="40%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#f0f0f0" />
            <stop offset="100%" stopColor="#dfdfdf" />
          </radialGradient>
          <radialGradient id="bloch-gloss" cx="34%" cy="24%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          {/* State-vector arrowhead */}
          <marker
            id="bh-vec"
            markerHeight="7"
            markerWidth="7"
            orient="auto-start-reverse"
            refX="5.5"
            refY="3.5"
            viewBox="0 0 7 7"
          >
            <path d="M0,0.5 L6,3.5 L0,6.5 Z" fill="#111111" />
          </marker>
          {/* Axis arrowhead */}
          <marker
            id="bh-ax"
            markerHeight="5"
            markerWidth="5"
            orient="auto"
            refX="4"
            refY="2.5"
            viewBox="0 0 5 5"
          >
            <path d="M0,0 L5,2.5 L0,5 Z" fill="#b0b0b0" />
          </marker>
        </defs>

        {/* ── Back hemisphere (dashed) ───────────────────────────── */}
        <path d={equatorPaths.back} fill="none" stroke="#c0c0c0" strokeWidth="0.8" strokeDasharray="3 3" />
        <path d={lat50paths.back} fill="none" stroke="#d0d0d0" strokeWidth="0.6" strokeDasharray="2 3" />
        <path d={latN50paths.back} fill="none" stroke="#d0d0d0" strokeWidth="0.6" strokeDasharray="2 3" />
        <path d={mer0paths.back} fill="none" stroke="#d0d0d0" strokeWidth="0.6" strokeDasharray="2 3" />
        <path d={mer90paths.back} fill="none" stroke="#d0d0d0" strokeWidth="0.6" strokeDasharray="2 3" />

        {/* Back axis stubs */}
        <line x1={axX1.sx} y1={axX1.sy} x2={CX} y2={CY} stroke="#d0d0d0" strokeWidth="0.8" strokeDasharray="3 3" />
        <line x1={axY1.sx} y1={axY1.sy} x2={CX} y2={CY} stroke="#d0d0d0" strokeWidth="0.8" strokeDasharray="3 3" />
        <line x1={axZ1.sx} y1={axZ1.sy} x2={CX} y2={CY} stroke="#d0d0d0" strokeWidth="0.8" strokeDasharray="3 3" />

        {/* ── Sphere ──────────────────────────────────────────────── */}
        <circle cx={CX} cy={CY} r={R} fill="url(#bloch-sphere-grad)" stroke="#b8b8b8" strokeWidth="1.2" />
        <circle cx={CX} cy={CY} r={R} fill="url(#bloch-gloss)" />

        {/* ── Front hemisphere ────────────────────────────────────── */}
        <path d={equatorPaths.front} fill="none" stroke="#a0a0a0" strokeWidth="1" />
        <path d={lat50paths.front} fill="none" stroke="#c0c0c0" strokeWidth="0.7" />
        <path d={latN50paths.front} fill="none" stroke="#c0c0c0" strokeWidth="0.7" />
        <path d={mer0paths.front} fill="none" stroke="#c0c0c0" strokeWidth="0.7" />
        <path d={mer90paths.front} fill="none" stroke="#c0c0c0" strokeWidth="0.7" />

        {/* Front axes */}
        <line x1={CX} y1={CY} x2={axX2.sx} y2={axX2.sy} stroke="#b0b0b0" strokeWidth="1" markerEnd="url(#bh-ax)" />
        <line x1={CX} y1={CY} x2={axY2.sx} y2={axY2.sy} stroke="#b0b0b0" strokeWidth="1" markerEnd="url(#bh-ax)" />
        <line x1={CX} y1={CY} x2={axZ2.sx} y2={axZ2.sy} stroke="#b0b0b0" strokeWidth="1" markerEnd="url(#bh-ax)" />

        {/* Axis labels */}
        <text x={axX2.sx + 7} y={axX2.sy + 4} fill="#999" fontFamily={MONO} fontSize="10">x</text>
        <text x={axY2.sx + 7} y={axY2.sy + 4} fill="#999" fontFamily={MONO} fontSize="10">y</text>
        <text x={axZ2.sx - 4} y={axZ2.sy - 6} fill="#999" fontFamily={MONO} fontSize="10">z</text>

        {/* Pole labels */}
        <text x={poleN.sx - 5} y={poleN.sy - 9} fill="#444" fontFamily={MONO} fontSize="11" fontWeight="600">|0⟩</text>
        <text x={poleS.sx - 5} y={poleS.sy + 16} fill="#444" fontFamily={MONO} fontSize="11" fontWeight="600">|1⟩</text>

        {/* ── Equatorial drop shadow ───────────────────────────────── */}
        {Math.abs(vector.z) > 0.04 && (
          <>
            <line
              x1={shadowTip.sx}
              y1={shadowTip.sy}
              x2={tip.sx}
              y2={tip.sy}
              stroke="#c8c8c8"
              strokeWidth="0.9"
              strokeDasharray="3 2"
            />
            <circle cx={shadowTip.sx} cy={shadowTip.sy} r="2.5" fill="none" stroke="#bbbbbb" strokeWidth="0.9" />
          </>
        )}

        {/* ── φ arc (azimuthal angle) ──────────────────────────────── */}
        {Math.abs(vector.phiDeg) > 3 && Math.abs(vector.z) < 0.98 && (
          <>
            <path d={phiArcD} fill="none" stroke="#7070bb" strokeWidth="1" strokeDasharray="2 2" />
            <text x={phiMid.sx + 3} y={phiMid.sy - 2} fill="#7070bb" fontFamily={MONO} fontSize="9">φ</text>
          </>
        )}

        {/* ── θ arc (polar angle) ──────────────────────────────────── */}
        {Math.abs(vector.thetaDeg) > 3 && (
          <>
            <path d={thetaArcD} fill="none" stroke="#bb7070" strokeWidth="1" strokeDasharray="2 2" />
            <text x={thetaMid.sx + 3} y={thetaMid.sy - 2} fill="#bb7070" fontFamily={MONO} fontSize="9">θ</text>
          </>
        )}

        {/* ── State vector ─────────────────────────────────────────── */}
        <line
          x1={CX}
          y1={CY}
          x2={tip.sx}
          y2={tip.sy}
          stroke="#111111"
          strokeWidth="2.2"
          markerEnd="url(#bh-vec)"
        />
        <circle cx={CX} cy={CY} r="2.5" fill="#333" />
        <circle cx={tip.sx} cy={tip.sy} r="4.5" fill="#111111" />
        <circle cx={tip.sx} cy={tip.sy} r="2" fill="white" opacity="0.55" />

        {/* ── Info overlay ─────────────────────────────────────────── */}
        <text x="12" y="22" fill="#888" fontFamily={MONO} fontSize="10.5">
          q{vector.wire}
        </text>
        <text x="12" y="36" fill="#aaa" fontFamily={MONO} fontSize="8.5">
          ({formatScalar(vector.x)}, {formatScalar(vector.y)}, {formatScalar(vector.z)})
        </text>
        <text x="12" y="264" fill="#bbb" fontFamily={MONO} fontSize="8">
          θ {formatScalar(vector.thetaDeg)}°  φ {formatScalar(vector.phiDeg)}°
        </text>
        <text x="12" y="275" fill="#ccc" fontFamily={MONO} fontSize="7.5">
          drag to rotate
        </text>
      </svg>
    </div>
  );
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
