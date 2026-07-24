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
  metadataBase: new URL(process.env.FRONTEND_URL || "https://localhost:3000"),
  title: "RAGVED — your notes, made searchable",
  description:
    "Upload your course material once. Ask anything, from definitions to derivations, and see exactly where each answer comes from.",
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: [{ url: "/logo.png", type: "image/png" }],
  },
  authors: [{ name: "Vedant Raj Purohit", url: "https://github.com/vedantrajpurohit" }],
  creator: "vedantrajpurohit",
  openGraph: {
    title: "RAGVED — your notes, made searchable",
    description:
      "Upload your course material once. Ask anything, from definitions to derivations, and see exactly where each answer comes from.",
    type: "website",
    images: [{ url: "/logo.png", width: 642, height: 507, alt: "RAGVED" }],
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