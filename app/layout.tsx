import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Sidebar from "@/components/sidebar";
import { AuthProvider } from "@/components/auth-provider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Crypto Trading System",
  description: "BTC ETH SOL BNB Automated Trading",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="antialiased bg-zinc-950 text-zinc-100 h-screen flex overflow-hidden">
        <AuthProvider>
          <Sidebar />
          <main className="flex-1 overflow-y-auto">{children}</main>
          <Toaster richColors closeButton theme="dark" />
        </AuthProvider>
      </body>
    </html>
  );
}
