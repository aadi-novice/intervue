import type { Metadata, Viewport } from "next";
import { Roboto_Flex } from "next/font/google";
import "@material-symbols/font-400/rounded.css";
import "./globals.css";
import { defaultThemeCss } from "./theme/generate-theme";
import { themeInitScript } from "./theme/theme-script";
import { Providers } from "@/components/providers";

const robotoFlex = Roboto_Flex({
  variable: "--font-roboto-flex",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Intervue | AI Recruitment Platform",
  description: "Intervue — AI-assisted hiring: resume ranking, interview notes and candidate comparison.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={robotoFlex.variable} suppressHydrationWarning>
      <head>
        {/* Sets .light/.dark on <html> before first paint (no theme flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* M3 colour tokens generated from the seed; swap per-org later. */}
        <style id="md-sys-color" dangerouslySetInnerHTML={{ __html: defaultThemeCss }} />
      </head>
      <body className="min-h-full bg-surface text-on-surface body-m antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
