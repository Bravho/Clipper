import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Clipper Platform Terms of Service — Version 1.0.0",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <p className="text-sm font-medium text-blue-700">Legal</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-slate-500">Version 1.0.0 — Effective January 1, 2024</p>
      </div>

      <Card>
        <div className="prose prose-slate max-w-none space-y-6 text-sm text-slate-700 leading-relaxed">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-xs">
            <strong>Placeholder:</strong> This is a placeholder page. Full Terms of Service
            content will be added before public launch. By using this platform
            you agree to these terms when finalised.
          </div>

          <section>
            <h2 className="text-base font-semibold text-slate-900">1. Service Description</h2>
            <p>
              Clipper is a managed short-video production and distribution service.
              You submit a brief and source materials; our team creates and publishes
              a promotional clip on your behalf.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">2. Account Registration</h2>
            <p>
              You must be at least 18 years old to create an account. You are
              responsible for maintaining the confidentiality of your credentials.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">3. Credits and Payments</h2>
            <p>
              New requester accounts receive 30 complimentary credits. Credits are
              non-transferable and have no cash value. Credit terms may change with
              notice.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">4. Content Ownership</h2>
            <p>
              See our Ownership and Usage Rights policy for full details on who owns
              the final edited clip and what rights you retain.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">5. Contact</h2>
            <p>
              For questions about these terms, please contact us through the platform.
            </p>
          </section>
        </div>
      </Card>
    </div>
  );
}
