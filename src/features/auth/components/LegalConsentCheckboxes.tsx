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
        ข้อตกลงที่จำเป็น
      </p>

      <Checkbox
        id="acceptTerms"
        name="acceptTerms"
        checked={values.acceptTerms ?? false}
        onChange={handleChange("acceptTerms")}
        error={errors.acceptTerms}
        label={
          <>
            ฉันยอมรับ{" "}
            <Link
              href={ROUTES.TERMS}
              target="_blank"
              className="text-blue-700 underline hover:text-blue-800"
            >
              ข้อกำหนดการใช้งาน
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
            ฉันรับทราบ{" "}
            <Link
              href={ROUTES.OWNERSHIP}
              target="_blank"
              className="text-blue-700 underline hover:text-blue-800"
            >
              นโยบายสิทธิ์ความเป็นเจ้าของ
            </Link>{" "}
            และเข้าใจว่าคลิปที่ตัดต่อแล้วเป็นของผู้ดำเนินการแพลตฟอร์ม
            โดยฉันสามารถแชร์ต่อบนช่องทางของตนเองได้
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
            ฉันได้อ่านและยอมรับ{" "}
            <Link
              href={ROUTES.PRIVACY}
              target="_blank"
              className="text-blue-700 underline hover:text-blue-800"
            >
              นโยบายความเป็นส่วนตัว
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
            ฉันเข้าใจว่าไฟล์ต้นฉบับที่อัพโหลดจะถูกเก็บตาม{" "}
            <Link
              href={ROUTES.PRIVACY}
              target="_blank"
              className="text-blue-700 underline hover:text-blue-800"
            >
              นโยบายการจัดเก็บข้อมูล
            </Link>{" "}
            และอาจถูกลบหลังจาก 90 วัน
          </>
        }
      />
    </div>
  );
}
