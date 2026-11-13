"use client";
import dynamic from "next/dynamic";

// CesiumJS needs `window` and WebGL, so the explorer only renders in the browser.
const Explorer = dynamic(() => import("@/components/Explorer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center text-sm text-slate-300">ULAANBAATAR 3D ачаалж байна…</div>
  ),
});

export default function Page() {
  return <Explorer />;
}
