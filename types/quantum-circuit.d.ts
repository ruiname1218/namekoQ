declare module "quantum-circuit" {
  type GateOptions = {
    params?: Record<string, string | number>;
    creg?: { name: string; bit: number };
    condition?: Record<string, unknown>;
  };

  type GateCell = {
    id: string;
    name: string;
    connector: number;
    options?: GateOptions;
  } | null;

  export default class QuantumCircuit {
    constructor(numQubits?: number);
    numQubits: number;
    gates: GateCell[][];
    importQASM(input: string, errorCallback?: (errors: string[]) => void): void;
    exportToQASM(
      options?: Record<string, unknown>,
      exportAsGateName?: false | string,
      circuitReplacement?: boolean,
      insideSubmodule?: boolean,
    ): string;
    addGate(
      gateName: string,
      column: number,
      wires: number | number[],
      options?: GateOptions,
    ): string;
    removeGate(id: string): void;
    /** Remove gate at the given column/wire position (stable across re-imports unlike ID-based removal). */
    removeGateAt(column: number, wire: number): void;
    removeMeasurementAndClassicalControl(): void;
    insertColumn(colIndex?: number): void;
    appendQubits(numQubits: number): void;
    numCols(): number;
    run(
      initialValues?: number[] | null,
      options?: Record<string, unknown>,
    ): void;
    angles(): Array<{
      theta: number;
      phi: number;
      thetaDeg: number;
      phiDeg: number;
      radius: number;
      x: number;
      y: number;
      z: number;
    }>;
  }
}

declare module "quantum-circuit/dist/quantum-circuit.min.js" {
  export { default } from "quantum-circuit";
}
