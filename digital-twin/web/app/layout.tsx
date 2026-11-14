import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ULAANBAATAR 3D",
  description: "Real-world 3D digital twin of Ulaanbaatar built from open geographic data.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn">
      <head>
        <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
