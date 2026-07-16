"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SampleRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <main className="mx-auto max-w-5xl px-5 py-16 text-center">
      <p className="text-sm text-[var(--sample-muted)]">Redirecting to Index…</p>
    </main>
  );
}