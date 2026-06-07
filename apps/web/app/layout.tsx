import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DNDMind",
  description: "AI Dungeon Master command center",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
