import type { Metadata } from "next";
import { Lora } from "next/font/google";

import "./sample.css";

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-sample-serif",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Index — Preview",
  description: "Design preview — not connected to production.",
  robots: "noindex, nofollow",
};

export default function SampleLayout({ children }: { children: React.ReactNode }) {
  return <div className={`sample-root ${lora.variable} antialiased`}>{children}</div>;
}