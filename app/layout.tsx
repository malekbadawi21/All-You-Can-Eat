import type { Metadata } from "next";
import { Baloo_2 } from "next/font/google";
import "./globals.css";

// Baloo 2 is the rounded geometric face the whole site runs on — UI and the
// lettering baked into the 3D scene alike. The 3D layer can't use this loader
// (troika needs a real font file, not a CSS variable), so the same family also
// lives at /public/fonts/Baloo2-Bold.ttf. Keep the two in step.
const baloo = Baloo_2({
  subsets: ["latin"],
  variable: "--font-baloo",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "AYCE — All You Can Eat",
  description: "Smart fast food recommendations for your health and fitness goals.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${baloo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
