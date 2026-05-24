import { Chat } from "@/components/chat";

const EXAMPLES = [
  {
    domain: "化学",
    text: "H2分子の基底状態エネルギーをVQEで計算して。bond lengthは0.735 Å。",
  },
  {
    domain: "化学",
    text: "VQEで H2 の bond length を 0.5〜2.0 Å の間で振って、最安定点を見つけて。",
  },
  {
    domain: "金融",
    text: "3資産のうち2つを選ぶポートフォリオ最適化をQAOAで解いて。",
  },
  {
    domain: "動作確認",
    text: "Bell状態を作って測定してみて。",
  },
];

export default function Page() {
  return (
    <main className="min-h-screen bg-white px-5 py-4 sm:px-8">
      <header className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-white">
        <div className="flex items-center gap-3">
          <img
            src="/namekoq-icon.svg"
            alt=""
            className="h-8 w-8 rounded-full object-contain"
            aria-hidden="true"
          />
          <div className="text-sm font-semibold uppercase tracking-[0.35em]">
            namekoQ
          </div>
        </div>
        <div className="hidden text-xs uppercase tracking-[0.22em] text-[var(--muted)] sm:block">
          量子
        </div>
      </header>
      <Chat examples={EXAMPLES} />
    </main>
  );
}
