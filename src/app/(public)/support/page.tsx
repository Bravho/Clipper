import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = {
  title: "Support — RClipper",
  description:
    "Contact RClipper support. Email us with questions about your account, credits, video requests, publishing, billing, or account deletion.",
};

const SUPPORT_EMAIL = "pillarth@gmail.com";

function mailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

const faqs: Array<{ q: string; qTh: string; a: ReactNode }> = [
  {
    q: "How long does a video take?",
    qTh: "ใช้เวลาทำคลิปนานแค่ไหน?",
    a: (
      <>
        AI Track videos are typically ready in about 30 minutes. Each Step may take 
        some time depending how many and how large of the material files. If 
        your request has been waiting noticeably longer than this, email us with 
        your request ID.
      </>
    ),
  },
  {
    q: "How do credits work?",
    qTh: "เครดิตทำงานอย่างไร?",
    a: (
      <>
        Each video request normally costs 100 credits, but there are typically 
        promotions for discount and monthly packages for a user to choose. You
        can top up credits by available payment methods, such as In-App Purchase
        for Apple IOS, or Google Play Billing for Android, from the Credits 
        screen in your account. If a payment was charged but credits were not 
        added, email us the payment reference and we will correct the balance.
      </>
    ),
  },
  {
    q: "I cannot sign in or did not get the verification email.",
    qTh: "เข้าสู่ระบบไม่ได้ หรือไม่ได้รับอีเมลยืนยัน",
    a: (
      <>
        Check your spam folder first, then use the resend option on the
        verification screen. If it still does not arrive, email us from the
        address you registered with and we will verify the account manually.
      </>
    ),
  },
  {
    q: "How do I connect or disconnect a social account?",
    qTh: "เชื่อมต่อหรือยกเลิกการเชื่อมต่อบัญชีโซเชียลอย่างไร?",
    a: (
      <>
        Open Channel Management in your dashboard to connect or remove TikTok,
        Facebook, Instagram, and YouTube accounts. Disconnecting revokes our
        access immediately and stops any scheduled posts to that channel.
      </>
    ),
  },
  {
    q: "How do I delete my account and data?",
    qTh: "ลบบัญชีและข้อมูลอย่างไร?",
    a: (
      <>
        You can delete your account at any time from the Account screen. If you
        cannot sign in, see the{" "}
        <Link href="/delete-account" className="text-blue-700 underline">
          account deletion request page
        </Link>
        .
      </>
    ),
  },
  {
    q: "I want a refund or have a billing question.",
    qTh: "ต้องการขอคืนเงิน หรือมีคำถามเรื่องการชำระเงิน",
    a: (
      <>
        Email us with the date of the charge and the payment reference. We
        review billing issues case by case and respond within two business
        days.
      </>
    ),
  },
];

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <p className="text-sm font-medium text-blue-700">Support</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">
          RClipper Support
        </h1>
        <p className="mt-1 text-lg text-slate-700">ฝ่ายสนับสนุน RClipper</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Questions about your account, credits, a video request, publishing, or
          billing? Contact us using the details below — you do not need an
          account to reach us.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          มีคำถามเกี่ยวกับบัญชี เครดิต คำขอวิดีโอ การเผยแพร่ หรือการชำระเงิน
          ติดต่อเราได้ตามรายละเอียดด้านล่าง โดยไม่จำเป็นต้องมีบัญชีผู้ใช้
        </p>
      </div>

      {/* Primary contact */}
      <Card>
        <h2 className="text-base font-semibold text-slate-900">
          Contact us / ติดต่อเรา
        </h2>
        <dl className="mt-4 space-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-900">Email</dt>
            <dd className="mt-1">
              <a
                href={mailto("RClipper support request")}
                className="text-blue-700 underline"
              >
                {SUPPORT_EMAIL}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              Response time / เวลาตอบกลับ
            </dt>
            <dd className="mt-1 text-slate-700">
              We reply to every email within 2 business days.
              <br />
              เราตอบกลับทุกอีเมลภายใน 2 วันทำการ
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              Support hours / เวลาทำการ
            </dt>
            <dd className="mt-1 text-slate-700">
              Monday–Friday, 09:00–18:00 (GMT+7, Indochina Time)
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              Languages / ภาษาที่ให้บริการ
            </dt>
            <dd className="mt-1 text-slate-700">ไทย · English</dd>
          </div>
        </dl>
      </Card>

      {/* What to include */}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-slate-900">
          What to include in your message
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          ข้อมูลที่ควรระบุเมื่อติดต่อเรา
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
          <li>The email address registered to your RClipper account</li>
          <li>
            The request ID, if your question is about a specific video request
          </li>
          <li>Whether you are using the iOS app, Android app, or the website</li>
          <li>
            A short description of what you expected and what happened instead
          </li>
          <li>A screenshot, if the issue is something you can see on screen</li>
        </ul>
      </Card>

      {/* Quick links by topic */}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-slate-900">
          Email us by topic
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { label: "Account or sign-in help", subject: "Account help" },
            { label: "Credits, billing, or refund", subject: "Billing question" },
            { label: "Problem with a video request", subject: "Video request issue" },
            { label: "Publishing or social accounts", subject: "Publishing issue" },
            { label: "Report content or a privacy request", subject: "Content or privacy request" },
            { label: "Account deletion", subject: "Account deletion request" },
          ].map((item) => (
            <a
              key={item.subject}
              href={mailto(item.subject)}
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
            >
              {item.label}
            </a>
          ))}
        </div>
      </Card>

      {/* FAQ */}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-slate-900">
          Frequently asked questions
        </h2>
        <p className="mt-1 text-sm text-slate-600">คำถามที่พบบ่อย</p>
        <div className="mt-4 space-y-5">
          {faqs.map((faq) => (
            <div key={faq.q}>
              <h3 className="text-sm font-semibold text-slate-900">{faq.q}</h3>
              <p className="text-sm text-slate-500">{faq.qTh}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Policies */}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-slate-900">
          Policies and account tools
        </h2>
        <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href={ROUTES.TERMS} className="text-blue-700 underline">
            Terms of Service
          </Link>
          <Link href={ROUTES.PRIVACY} className="text-blue-700 underline">
            Privacy Policy
          </Link>
          <Link href={ROUTES.OWNERSHIP} className="text-blue-700 underline">
            Content Ownership
          </Link>
          <Link href="/delete-account" className="text-blue-700 underline">
            Delete your account
          </Link>
          <Link href={ROUTES.LOGIN} className="text-blue-700 underline">
            Sign in
          </Link>
        </nav>
      </Card>

      <p className="mt-6 text-xs leading-relaxed text-slate-500">
        RClipper is an AI video editor and video editing service for tourism,
        restaurant, and small business operators in Thailand. Support is provided by the
        RClipper team at the email address above.
      </p>
    </div>
  );
}
