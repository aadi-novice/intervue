import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Neuro-Hiring | AI Recruitment Platform",
  description:
    "Neuro-Minimalist AI hiring platform — precision hiring for high-growth tech teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full antialiased dark",
        geist.variable,
        inter.variable,
        geistMono.variable
      )}
    >
      <body className="min-h-full flex flex-col bg-[#10131a] text-[#e1e2ec]">
        {children}
      </body>
    </html>
  );
}
