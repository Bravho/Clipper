import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { redirect } from "next/navigation";
import { getRoleHomePath } from "@/config/routes";
import { ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { Button } from "@/components/ui/Button";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  // Redirect authenticated users to their dashboard
  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="bg-slate-900 py-24 px-4 text-center text-white">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 inline-block rounded-full bg-blue-700/20 px-4 py-1.5 text-sm font-medium text-blue-400 ring-1 ring-blue-700/40">
            Managed Short-Video Production
          </div>
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Your promotional clip,{" "}
            <span className="text-blue-400">handled end-to-end.</span>
          </h1>
          <p className="mx-auto mb-10 max-w-xl text-lg text-slate-300">
            Submit your brief and source files. Our team edits and publishes a
            polished 30-second clip to TikTok, Instagram, YouTube, and more.
            You get a shareable link — we handle everything else.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href={ROUTES.SIGNUP}>
              <Button size="lg" className="min-w-[180px]">
                Get started free
              </Button>
            </Link>
            <Link href={ROUTES.LOGIN}>
              <Button variant="outline" size="lg" className="min-w-[140px] border-slate-600 text-slate-300 hover:bg-slate-800">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Credits call-out */}
      <section className="border-b border-slate-200 bg-blue-50 py-6 px-4 text-center">
        <p className="text-sm font-medium text-blue-800">
          New accounts receive{" "}
          <span className="font-bold text-blue-900">30 free credits</span> —
          enough to get started right away.
        </p>
      </section>

      {/* How it works */}
      <section className="py-20 px-4">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold text-slate-900">
            How it works
          </h2>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: "1",
                title: "Create an account",
                desc: "Sign up in seconds with Google or email. You get 30 free credits immediately.",
              },
              {
                step: "2",
                title: "Submit your brief",
                desc: "Fill in your clip brief, describe the style and audience, and upload up to 5 source files.",
              },
              {
                step: "3",
                title: "We handle production",
                desc: "Our team edits your clip within 2 business days and schedules it for publishing.",
              },
              {
                step: "4",
                title: "Track and share",
                desc: "Monitor your request, get notified when published, and reshare your clip freely.",
              },
            ].map((item) => (
              <div key={item.step} className="flex flex-col gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-700 text-white font-bold text-sm">
                  {item.step}
                </div>
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Publishing channels */}
      <section className="border-t border-slate-200 bg-slate-50 py-16 px-4 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-2xl font-bold text-slate-900">
            Published where it matters
          </h2>
          <p className="mb-8 text-slate-600">
            We publish your clip to the channels you choose.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {["TikTok", "Instagram", "Facebook", "YouTube", "Tvent App", "CDN / Direct Link"].map(
              (ch) => (
                <span
                  key={ch}
                  className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm"
                >
                  {ch}
                </span>
              )
            )}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 text-center">
        <div className="mx-auto max-w-xl">
          <h2 className="mb-4 text-3xl font-bold text-slate-900">
            Ready to get your first clip?
          </h2>
          <p className="mb-8 text-slate-600">
            Create your free account in under a minute.
          </p>
          <Link href={ROUTES.SIGNUP}>
            <Button size="lg" className="min-w-[200px]">
              Create free account
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
