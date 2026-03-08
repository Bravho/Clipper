import Link from "next/link";
import { Checkbox } from "@/components/ui/Checkbox";
import { ROUTES } from "@/config/routes";

interface LegalConsentCheckboxesProps {
  errors?: {
    acceptTerms?: string;
    acceptOwnership?: string;
    acceptPrivacy?: string;
    acceptStorage?: string;
  };
  onChange?: (field: string, value: boolean) => void;
  values?: {
    acceptTerms?: boolean;
    acceptOwnership?: boolean;
    acceptPrivacy?: boolean;
    acceptStorage?: boolean;
  };
}

/**
 * Legal consent checkboxes shown on the signup form.
 * Intentionally a controlled or ref-based component — the parent
 * form (react-hook-form or state) owns the values.
 */
export function LegalConsentCheckboxes({
  errors = {},
  onChange,
  values = {},
}: LegalConsentCheckboxesProps) {
  const handleChange =
    (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(field, e.target.checked);
    };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Required agreements
      </p>

      <Checkbox
        id="acceptTerms"
        name="acceptTerms"
        checked={values.acceptTerms ?? false}
        onChange={handleChange("acceptTerms")}
        error={errors.acceptTerms}
        label={
          <>
            I agree to the{" "}
            <Link
              href={ROUTES.TERMS}
              target="_blank"
              className="text-blue-700 underline hover:text-blue-800"
            >
              Terms of Service
            </Link>
          </>
        }
      />

      <Checkbox
        id="acceptOwnership"
        name="acceptOwnership"
        checked={values.acceptOwnership ?? false}
        onChange={handleChange("acceptOwnership")}
        error={errors.acceptOwnership}
        label={
          <>
            I acknowledge the{" "}
            <Link
              href={ROUTES.OWNERSHIP}
              target="_blank"
              className="text-blue-700 underline hover:text-blue-800"
            >
              Ownership and Usage Rights
            </Link>{" "}
            policy. I understand that the final edited clip belongs to the
            platform operator, and I may reshare it on my own channels.
          </>
        }
      />

      <Checkbox
        id="acceptPrivacy"
        name="acceptPrivacy"
        checked={values.acceptPrivacy ?? false}
        onChange={handleChange("acceptPrivacy")}
        error={errors.acceptPrivacy}
        label={
          <>
            I have read and accept the{" "}
            <Link
              href={ROUTES.PRIVACY}
              target="_blank"
              className="text-blue-700 underline hover:text-blue-800"
            >
              Privacy Policy
            </Link>
          </>
        }
      />

      <Checkbox
        id="acceptStorage"
        name="acceptStorage"
        checked={values.acceptStorage ?? false}
        onChange={handleChange("acceptStorage")}
        error={errors.acceptStorage}
        label={
          <>
            I understand that uploaded source files are retained only according
            to the platform's{" "}
            <Link
              href={ROUTES.PRIVACY}
              target="_blank"
              className="text-blue-700 underline hover:text-blue-800"
            >
              Storage and Retention policy
            </Link>{" "}
            and may be deleted after 90 days.
          </>
        }
      />
    </div>
  );
}
