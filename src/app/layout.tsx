import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Keta Retail — Retail operations",
  description: "Retail operations and point of sale, built for Ghanaian businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GH">
      <body>{children}</body>
    </html>
  );
}
