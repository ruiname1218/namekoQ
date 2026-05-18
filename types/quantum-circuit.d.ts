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
    insertColumn(colIndex?: number): void;
    appendQubits(numQubits: number): void;
    numCols(): number;
  }
}

declare module "quantum-circuit/dist/quantum-circuit.min.js" {
  export { default } from "quantum-circuit";
}
