"use client";

import { useMemo, useState } from "react";
import QuantumCircuit from "quantum-circuit/dist/quantum-circuit.min.js";

type GateName =
  | "h"
  | "x"
  | "y"
  | "z"
  | "s"
  | "t"
  | "rx"
  | "ry"
  | "rz"
  | "cx"
  | "cz"
  | "swap"
  | "measure";

interface GateDefinition {
  name: GateName;
  label: string;
  arity: 1 | 2;
  defaultParam?: string;
}

interface GateCell {
  id: string;
  name: GateName;
  connector: number;
  options?: GateOptions;
}

interface GateOptions {
  params?: Record<string, string | number>;
  creg?: { name: string; bit: number };
  condition?: Record<string, unknown>;
}

interface EditorGate {
  id: string;
  name: GateName;
  column: number;
  wires: number[];
  options?: GateOptions;
}

interface CircuitModel {
  circuit: QuantumCircuit;
  qubits: number;
  columns: number;
  cells: Array<Array<GateCell | null>>;
  gates: EditorGate[];
  errors: string[];
}

const PALETTE: GateDefinition[] = [
  { name: "h", label: "H", arity: 1 },
  { name: "x", label: "X", arity: 1 },
  { name: "y", label: "Y", arity: 1 },
  { name: "z", label: "Z", arity: 1 },
  { name: "s", label: "S", arity: 1 },
  { name: "t", label: "T", arity: 1 },
  { name: "rx", label: "RX", arity: 1, defaultParam: "pi/2" },
  { name: "ry", label: "RY", arity: 1, defaultParam: "pi/2" },
  { name: "rz", label: "RZ", arity: 1, defaultParam: "pi/2" },
  { name: "cx", label: "CX", arity: 2 },
  { name: "cz", label: "CZ", arity: 2 },
  { name: "swap", label: "SWAP", arity: 2 },
  { name: "measure", label: "M", arity: 1 },
];

const SUPPORTED_GATES = new Set(PALETTE.map((gate) => gate.name));
const MIN_COLUMNS = 6;

export function CircuitEditor({
  openqasm,
  onChange,
}: {
  openqasm: string;
  onChange: (nextOpenqasm: string) => void;
}) {
  const model = useMemo(() => readCircuit(openqasm), [openqasm]);
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);
  const displayColumns = Math.max(model.columns + 1, MIN_COLUMNS);
  const selectedGate = model.gates.find((gate) => gate.id === selectedGateId);

  const commit = (mutate: (circuit: QuantumCircuit) => string | void) => {
    const next = readCircuit(openqasm).circuit;
    const nextSelectedGateId = mutate(next);
    onChange(exportCircuit(next));
    if (nextSelectedGateId) setSelectedGateId(nextSelectedGateId);
  };

  const addGate = (gateName: GateName, column: number, wire: number) => {
    commit((circuit) =>
      placeGate(circuit, gateName, column, wire, gateOptions(gateName, wire)),
    );
  };

  const moveGate = (gateId: string, column: number, wire: number) => {
    const gate = model.gates.find((item) => item.id === gateId);
    if (!gate) return;
    commit((circuit) => {
      circuit.removeGateAt(gate.column, gate.wires[0]);
      return placeGate(
        circuit,
        gate.name,
        column,
        wire,
        normalizeOptions(gate.options),
      );
    });
  };

  const updateGateWires = (gateId: string, wireIndex: number, wire: number) => {
    const gate = model.gates.find((item) => item.id === gateId);
    if (!gate) return;
    const nextWires = [...gate.wires];
    nextWires[wireIndex] = wire;
    if (new Set(nextWires).size !== nextWires.length) return;

    commit((circuit) => {
      circuit.removeGateAt(gate.column, gate.wires[0]);
      return placeGateAtWires(
        circuit,
        gate.name,
        gate.column,
        nextWires,
        normalizeOptions(gate.options),
      );
    });
  };

  const updateGateOptions = (gateId: string, options: GateOptions) => {
    const gate = model.gates.find((item) => item.id === gateId);
    if (!gate) return;
    commit((circuit) => {
      circuit.removeGateAt(gate.column, gate.wires[0]);
      return placeGateAtWires(circuit, gate.name, gate.column, gate.wires, options);
    });
  };

  const removeGate = (gateId: string) => {
    const gate = model.gates.find((item) => item.id === gateId);
    if (!gate) return;
    // Use positional removal — gate IDs are re-generated on every QASM import,
    // so the stored ID never matches the freshly-parsed circuit inside commit().
    commit((circuit) => circuit.removeGateAt(gate.column, gate.wires[0]));
    setSelectedGateId(null);
  };

  const addColumn = () => {
    commit((circuit) => circuit.insertColumn(circuit.numCols()));
  };

  const addQubit = () => {
    commit((circuit) => circuit.appendQubits(1));
  };

  const handleDrop = (event: React.DragEvent, column: number, wire: number) => {
    event.preventDefault();
    const payload = parseDragPayload(event.dataTransfer.getData("application/json"));
    if (!payload) return;
    if (payload.type === "palette") {
      addGate(payload.gate, column, wire);
    } else {
      moveGate(payload.id, column, wire);
    }
  };

  return (
    <section className="border-t border-[var(--border)] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em]">
            回路エディター
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            OpenQASM 2.0互換の回路エディター
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addColumn}
            className="rounded-sm border border-[var(--border-strong)] px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)]"
          >
            列を追加
          </button>
          <button
            type="button"
            onClick={addQubit}
            className="rounded-sm border border-[var(--border-strong)] px-3 py-2 text-xs font-medium transition hover:border-[var(--ink)]"
          >
            qubitを追加
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[160px_minmax(0,1fr)]">
        <aside>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            ゲート
          </div>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
            {PALETTE.map((gate) => (
              <button
                key={gate.name}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/json",
                    JSON.stringify({ type: "palette", gate: gate.name }),
                  );
                }}
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-2 font-mono text-xs font-semibold transition hover:border-[var(--ink)] hover:bg-white"
              >
                {gate.label}
              </button>
            ))}
          </div>

          {selectedGate && (
            <div className="mt-4 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                選択中
              </div>
              <div className="mt-2 font-mono text-sm uppercase">
                {selectedGate.name}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                q{selectedGate.wires.join(", q")} / t{selectedGate.column}
              </div>

              <div className="mt-3 flex flex-col gap-3">
                {selectedGate.wires.map((wire, wireIndex) => (
                  <label key={`${selectedGate.id}-${wireIndex}`} className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      {wireControlLabel(selectedGate.name, wireIndex)}
                    </span>
                    <select
                      value={wire}
                      onChange={(event) =>
                        updateGateWires(
                          selectedGate.id,
                          wireIndex,
                          Number(event.target.value),
                        )
                      }
                      className="rounded-sm border border-[var(--border)] bg-white px-2 py-1.5 text-xs outline-none focus:border-[var(--ink)]"
                    >
                      {Array.from({ length: model.qubits }).map((_, candidateWire) => (
                        <option
                          key={candidateWire}
                          value={candidateWire}
                          disabled={
                            candidateWire !== wire &&
                            selectedGate.wires.includes(candidateWire)
                          }
                        >
                          q{candidateWire}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}

                {isRotationGate(selectedGate.name) && (
                  <label key={selectedGate.id} className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      theta
                    </span>
                    <input
                      defaultValue={getTheta(selectedGate.options)}
                      onBlur={(event) => {
                        const theta = event.currentTarget.value.trim() || "0";
                        updateGateOptions(selectedGate.id, {
                          ...normalizeOptions(selectedGate.options),
                          params: { theta },
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      className="rounded-sm border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-xs outline-none focus:border-[var(--ink)]"
                    />
                  </label>
                )}

                {selectedGate.name === "measure" && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      古典bit
                    </span>
                    <input
                      type="number"
                      min={0}
                      defaultValue={getClassicalBit(selectedGate.options)}
                      onBlur={(event) => {
                        const bit = Math.max(0, Number(event.currentTarget.value) || 0);
                        updateGateOptions(selectedGate.id, {
                          ...normalizeOptions(selectedGate.options),
                          creg: { name: "c", bit },
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      className="rounded-sm border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-xs outline-none focus:border-[var(--ink)]"
                    />
                  </label>
                )}
              </div>

              <button
                type="button"
                onClick={() => removeGate(selectedGate.id)}
                className="mt-3 w-full rounded-sm border border-[var(--ink)] px-2 py-2 text-xs font-medium transition hover:bg-[var(--ink)] hover:text-white"
              >
                削除
              </button>
            </div>
          )}
        </aside>

        <div className="min-w-0">
          {model.errors.length > 0 && (
            <div className="mb-3 rounded-sm border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--fg)]">
              {model.errors.join(" / ")}
            </div>
          )}
          {model.errors.length === 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1">
                有効なOpenQASM
              </span>
              <span>{model.qubits} qubit</span>
              <span>{model.gates.length} gate</span>
            </div>
          )}

          <div className="overflow-auto rounded-sm border border-[var(--border)] bg-white p-3">
            <div
              className="grid gap-y-2"
              style={{
                minWidth: `${displayColumns * 58 + 56}px`,
              }}
            >
              <div
                className="grid items-center gap-2"
                style={{
                  gridTemplateColumns: `48px repeat(${displayColumns}, 50px)`,
                }}
              >
                <div />
                {Array.from({ length: displayColumns }).map((_, column) => (
                  <div
                    key={`t${column}`}
                    className="text-center font-mono text-[10px] text-[var(--muted)]"
                  >
                    t{column}
                  </div>
                ))}
              </div>

              {Array.from({ length: model.qubits }).map((_, wire) => (
                <div
                  key={`wire-${wire}`}
                  className="grid items-center gap-2"
                  style={{
                    gridTemplateColumns: `48px repeat(${displayColumns}, 50px)`,
                  }}
                >
                  <div className="font-mono text-xs text-[var(--muted)]">
                    q{wire}
                  </div>
                  {Array.from({ length: displayColumns }).map((_, column) => {
                    const cell = model.cells[wire]?.[column] ?? null;
                    const gate = cell
                      ? model.gates.find((item) => item.id === cell.id)
                      : null;
                    const selected = cell?.id === selectedGateId;
                    return (
                      <DropCell
                        key={`${wire}-${column}`}
                        wire={wire}
                        column={column}
                        hasGate={!!cell}
                        onDrop={(event) => handleDrop(event, column, wire)}
                      >
                        {/* 2-qubit gate connector — extends into the row-gap above/below */}
                        {gate && gate.wires.length > 1 && gate.wires.includes(wire - 1) && (
                          <div
                            aria-hidden="true"
                            className="absolute left-1/2 z-10 w-px -translate-x-px bg-[var(--border-strong)]"
                            style={{ bottom: "100%", height: "10px" }}
                          />
                        )}
                        {gate && gate.wires.length > 1 && gate.wires.includes(wire + 1) && (
                          <div
                            aria-hidden="true"
                            className="absolute left-1/2 z-10 w-px -translate-x-px bg-[var(--border-strong)]"
                            style={{ top: "100%", height: "10px" }}
                          />
                        )}
                        {cell && gate && (
                          <button
                            type="button"
                            draggable
                            onClick={() => setSelectedGateId(cell.id)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                "application/json",
                                JSON.stringify({ type: "gate", id: cell.id }),
                              );
                            }}
                            className={[
                              "relative z-10 grid h-8 min-w-8 place-items-center rounded-sm border bg-white px-2 font-mono text-xs font-semibold shadow-sm",
                              selected
                                ? "border-[var(--ink)]"
                                : "border-[var(--border-strong)]",
                            ].join(" ")}
                          >
                            {cellLabel(gate, cell)}
                          </button>
                        )}
                      </DropCell>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 text-xs text-[var(--muted)]">
            Drag gates onto the grid. Drag existing gates to move them.
          </div>
        </div>
      </div>
    </section>
  );
}

function DropCell({
  hasGate,
  onDrop,
  children,
}: {
  wire: number;
  column: number;
  hasGate: boolean;
  onDrop: (event: React.DragEvent) => void;
  children: React.ReactNode;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!isDragOver) setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        // Only clear when leaving the cell itself, not a child element
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsDragOver(false);
        }
      }}
      onDrop={(event) => {
        setIsDragOver(false);
        onDrop(event);
      }}
      className={[
        "relative grid h-10 place-items-center border transition",
        "before:absolute before:left-0 before:right-0 before:top-1/2 before:h-px before:bg-[var(--border-strong)] before:content-['']",
        isDragOver
          ? "border-solid border-[var(--ink)] bg-[var(--surface-strong)]"
          : hasGate
          ? "border-solid border-[var(--border)] bg-white"
          : "border-dashed border-[var(--border)] bg-[var(--surface)] hover:border-[var(--ink)]",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function readCircuit(openqasm: string): CircuitModel {
  const circuit = new QuantumCircuit(1);
  const errors: string[] = [];

  try {
    circuit.importQASM(openqasm, (items) => {
      if (items.length > 0) errors.push(...items.map(formatImportError));
    });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const cells = circuit.gates as Array<Array<GateCell | null>>;
  return {
    circuit,
    qubits: Math.max(circuit.numQubits || 1, 1),
    columns: Math.max(circuit.numCols ? circuit.numCols() : 0, 0),
    cells,
    gates: collectGates(cells),
    errors,
  };
}

function collectGates(cells: Array<Array<GateCell | null>>): EditorGate[] {
  const grouped = new Map<string, EditorGate>();

  cells.forEach((row, wire) => {
    row.forEach((cell, column) => {
      if (!cell || !SUPPORTED_GATES.has(cell.name)) return;
      const existing = grouped.get(cell.id);
      if (existing) {
        existing.wires[cell.connector] = wire;
      } else {
        const wires: number[] = [];
        wires[cell.connector] = wire;
        grouped.set(cell.id, {
          id: cell.id,
          name: cell.name,
          column,
          wires,
          options: cell.options,
        });
      }
    });
  });

  return Array.from(grouped.values())
    .map((gate) => ({
      ...gate,
      wires: gate.wires.filter((wire) => Number.isInteger(wire)),
    }))
    .sort(
      (a, b) =>
        a.column - b.column ||
        Math.min(...a.wires) - Math.min(...b.wires),
    );
}

function exportCircuit(circuit: QuantumCircuit): string {
  return circuit.exportToQASM({ compatibilityMode: true }, false);
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

function placeGate(
  circuit: QuantumCircuit,
  gateName: GateName,
  column: number,
  wire: number,
  options: GateOptions,
): string {
  const wires = resolveGateWires(circuit, gateName, wire);
  return placeGateAtWires(circuit, gateName, column, wires, options);
}

function placeGateAtWires(
  circuit: QuantumCircuit,
  gateName: GateName,
  column: number,
  wires: number[],
  options: GateOptions,
): string {
  const maxWire = Math.max(...wires);
  if (maxWire + 1 > circuit.numQubits) {
    circuit.appendQubits(maxWire + 1 - circuit.numQubits);
  }
  const targetColumn = ensureEmptyPlace(circuit, column, wires);
  return circuit.addGate(gateName, targetColumn, wires, options);
}

function resolveGateWires(
  circuit: QuantumCircuit,
  gateName: GateName,
  wire: number,
): number[] {
  const definition = getGateDefinition(gateName);
  if (definition.arity === 1) return [wire];
  if (circuit.numQubits < 2) circuit.appendQubits(2 - circuit.numQubits);
  return [wire, chooseAdjacentWire(wire, circuit.numQubits)];
}

function ensureEmptyPlace(
  circuit: QuantumCircuit,
  column: number,
  wires: number[],
): number {
  const occupied = wires.some((wire) => circuit.gates[wire]?.[column]);
  if (!occupied) return column;
  circuit.insertColumn(column);
  return column;
}

function getGateDefinition(name: GateName): GateDefinition {
  return PALETTE.find((gate) => gate.name === name) ?? PALETTE[0];
}

function isRotationGate(name: GateName): boolean {
  return name === "rx" || name === "ry" || name === "rz";
}

function getTheta(options: GateOptions | undefined): string {
  const theta = options?.params?.theta;
  return typeof theta === "number" || typeof theta === "string"
    ? String(theta)
    : "pi/2";
}

function getClassicalBit(options: GateOptions | undefined): number {
  return Math.max(0, Number(options?.creg?.bit) || 0);
}

function wireControlLabel(name: GateName, wireIndex: number): string {
  if (name === "cx" || name === "cz") {
    return wireIndex === 0 ? "control" : "target";
  }
  if (name === "swap") return wireIndex === 0 ? "wire a" : "wire b";
  return "target";
}

function gateOptions(name: GateName, wire: number): GateOptions {
  if (name === "measure") return { creg: { name: "c", bit: wire } };
  if (name === "rx" || name === "ry" || name === "rz") {
    return { params: { theta: "pi/2" } };
  }
  return {};
}

function normalizeOptions(options: GateOptions | undefined): GateOptions {
  if (!options) return {};
  return JSON.parse(JSON.stringify(options)) as GateOptions;
}

function chooseAdjacentWire(wire: number, qubits: number): number {
  if (qubits <= 1) return wire;
  return wire < qubits - 1 ? wire + 1 : wire - 1;
}

function cellLabel(gate: EditorGate, cell: GateCell): string {
  const name = gate.name.toUpperCase();
  if (gate.wires.length === 1) return name === "MEASURE" ? "M" : name;
  if (gate.name === "swap") return "×";
  if (cell.connector === 0) return "●";
  if (gate.name === "cx") return "X";
  if (gate.name === "cz") return "Z";
  return name;
}

function parseDragPayload(
  value: string,
):
  | { type: "palette"; gate: GateName }
  | { type: "gate"; id: string }
  | null {
  try {
    const parsed = JSON.parse(value) as
      | { type?: unknown; gate?: unknown; id?: unknown }
      | null;
    if (!parsed || typeof parsed.type !== "string") return null;
    if (
      parsed.type === "palette" &&
      typeof parsed.gate === "string" &&
      SUPPORTED_GATES.has(parsed.gate as GateName)
    ) {
      return { type: "palette", gate: parsed.gate as GateName };
    }
    if (parsed.type === "gate" && typeof parsed.id === "string") {
      return { type: "gate", id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
