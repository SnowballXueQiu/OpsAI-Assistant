import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linux服务器智能运维助手",
  description: "Linux monitoring, log analysis and Ollama-based diagnostics"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

