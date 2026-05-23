import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "namekoQ - Quantum Application Agent",
  description: "A quantum application generation AI agent for domain experts",
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
