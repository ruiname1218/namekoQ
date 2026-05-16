import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "namekoQ - Quantum Application Agent",
  description: "ドメイン専門家向けの量子アプリケーション生成AIエージェント",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
