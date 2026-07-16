import type { Metadata } from "next";
import { Geist, Geist_Mono, Lora } from "next/font/google";

import "./globals.css";
import "./index-theme.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-sample-serif",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Index — your course PDFs, in one place",
  description:
    "Upload lecture PDFs, ask in plain language, and get answers with the page they came from.",
  openGraph: {
    title: "Index — ask your notes like a friend who read the chapter",
    description: "Drop in PDFs, ask definitions, formulas, or summaries — with sources.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="sample-root min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}