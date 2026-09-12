import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // STUB (Stage 11): real title and description arrive with the landing page.
  title: "IndeedAutoWeb",
  description: "Account layer. Phase 1.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
