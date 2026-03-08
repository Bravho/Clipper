import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import SessionProvider from "./providers";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Clipper — Managed Short-Video Production",
    template: "%s | Clipper",
  },
  description:
    "Clipper is a managed short-video production and distribution platform. Submit your brief, and our team creates and publishes your promotional clip.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en" className={inter.className}>
      <body className="flex min-h-screen flex-col">
        <SessionProvider session={session}>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
