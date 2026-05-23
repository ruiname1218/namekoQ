import { Chat } from "@/components/chat";

const EXAMPLES = [
  {
    domain: "Chemistry",
    text: "Compute the ground-state energy of the H2 molecule with VQE. Use a bond length of 0.735 Å.",
  },
  {
    domain: "Chemistry",
    text: "Run a VQE bond-length scan for H2 from 0.5 to 2.0 Å and identify the most stable point.",
  },
  {
    domain: "Finance",
    text: "Solve a portfolio optimization problem with QAOA: choose 2 assets out of 3.",
  },
  {
    domain: "Smoke test",
    text: "Create a Bell state and measure it.",
  },
];

export default function Page() {
  return (
    <main className="min-h-screen bg-white px-5 py-4 sm:px-8">
      <header className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-white">
        <div className="text-sm font-semibold uppercase tracking-[0.35em]">
          namekoQ
        </div>
        <div className="hidden text-xs uppercase tracking-[0.22em] text-[var(--muted)] sm:block">
          Quantum
        </div>
      </header>
      <Chat examples={EXAMPLES} />
    </main>
  );
}
