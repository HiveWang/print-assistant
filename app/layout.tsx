import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "打印助手 · 内网安全打印",
  description:
    "面向办公内网的批量文件打印工作台，支持网络打印机、任务进度与会话隔离。",
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
