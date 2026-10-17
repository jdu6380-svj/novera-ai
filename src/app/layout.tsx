import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novera AI · 企业知识智能系统",
  description: "将企业知识转化为可检索、可分析、可验证的智能资产。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
