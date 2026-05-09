import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import SessionProvider from "./providers";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { initEditorSeedData } from "@/seed/editorSeedData";
import "./globals.css";

// Seed editor profiles into the in-memory mock store on first server render
initEditorSeedData();

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "RClipper — Video Editing Marketplace",
    template: "%s | RClipper",
  },
  description:
    "Video editing marketplace สำหรับธุรกิจท่องเที่ยวและร้านอาหารในไทย — ทำคลิปเร็ว ราคาถูกด้วย AI หรือเลือก editor ที่เข้าใจ algorithm และตลาดต่างชาติ พร้อม distribution ผ่าน Tvent",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="th" className={inter.className}>
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
