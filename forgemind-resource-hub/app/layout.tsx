import type { Metadata } from "next";
import "./globals.css";
import { ForgeHubAuthGate } from "./ForgeHubAuthGate";
export const metadata: Metadata = {
  title: "ForgeMind Resource Hub",
  description: "面向 ForgeMind 的设备、材料与产品资源中枢。",
  openGraph: { title: "ForgeMind Resource Hub", description: "选择工业资源，参数化改模，并导出 ForgeMind 资源包。", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "ForgeMind Resource Hub", description: "选择工业资源，参数化改模，并导出 ForgeMind 资源包。", images: ["/og.png"] },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body><ForgeHubAuthGate>{children}</ForgeHubAuthGate></body></html>; }
