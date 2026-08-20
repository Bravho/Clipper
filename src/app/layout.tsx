import type { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import SessionProvider from "./providers";
import { Navbar } from "@/components/layout/Navbar";
import { PortalNavProvider } from "@/components/layout/PortalNav";
import { Footer } from "@/components/layout/Footer";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { WebPushRegistration } from "@/components/pwa/WebPushRegistration";
import { NativeDeepLinkHandler } from "@/components/mobile/NativeDeepLinkHandler";
import { AppleReturnRecovery } from "@/components/mobile/AppleReturnRecovery";
import { NativePushRegistration } from "@/components/mobile/NativePushRegistration";
import { initEditorSeedData } from "@/seed/editorSeedData";
import { getServerLocale } from "@/i18n/server";
import "./globals.css";

// Seed editor profiles into the in-memory mock store on first server render
initEditorSeedData();

export const metadata: Metadata = {
  title: {
    default: "RClipper — AI Video Editor and Video Editing Services",
    template: "%s | RClipper",
  },
  description:
    "AI ตัดต่อวิดีโอ และบริการตัดต่อวิดีโอ สำหรับธุรกิจท่องเที่ยวและร้านอาหารในไทย — ทำคลิปเร็ว ราคาถูกด้วย AI หรือเลือก editor ที่เข้าใจ algorithm และตลาดต่างชาติ พร้อม distribution ผ่าน Travy",
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
      <body className="flex min-h-screen w-full flex-col overflow-x-hidden">
        <SessionProvider session={session} locale={locale}>
          <PortalNavProvider>
            <ServiceWorkerRegister />
            <WebPushRegistration />
            <NativeDeepLinkHandler />
            {/* Must sit above the session-dependent pieces: it runs on a cold
                start where there is no session *yet*, precisely because the
                Apple sign-in that would have created one was interrupted. */}
            <AppleReturnRecovery />
            <NativePushRegistration />
            <Navbar />
            {/* min-w-0 lets flex children shrink below their content width,
                which is what stops wide cards/tables forcing a page-level
                horizontal scroll on phones. */}
            <main className="w-full min-w-0 flex-1">{children}</main>
            <Footer />
          </PortalNavProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
