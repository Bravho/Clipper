import type { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import SessionProvider from "./providers";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { NativePushRegistration } from "@/components/mobile/NativePushRegistration";
import { NativeDeepLinkHandler } from "@/components/mobile/NativeDeepLinkHandler";
import { initEditorSeedData } from "@/seed/editorSeedData";
import { getServerLocale } from "@/i18n/server";
import "./globals.css";

// Seed editor profiles into the in-memory mock store on first server render
initEditorSeedData();

export const metadata: Metadata = {
  title: {
    default: "RClipper — Video Editing Marketplace",
    template: "%s | RClipper",
  },
  description:
    "Video editing marketplace สำหรับธุรกิจท่องเที่ยวและร้านอาหารในไทย — ทำคลิปเร็ว ราคาถูกด้วย AI หรือเลือก editor ที่เข้าใจ algorithm และตลาดต่างชาติ พร้อม distribution ผ่าน Travy",
  manifest: "/manifest.webmanifest",
  applicationName: "RClipper",
  appleWebApp: {
    capable: true,
    title: "RClipper",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/logo.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const locale = getServerLocale();

  return (
    <html lang={locale}>
      <body className="flex min-h-screen flex-col">
        <SessionProvider session={session} locale={locale}>
          <ServiceWorkerRegister />
          <NativePushRegistration />
          <NativeDeepLinkHandler />
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
