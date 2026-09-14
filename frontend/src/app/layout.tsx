import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HomeruAI - ほめるAIノート",
  description: "勉強のプロセスをほめてモチベーションを高める学習支援ノートアプリ",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

