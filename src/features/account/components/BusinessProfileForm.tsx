"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";

interface BusinessProfile {
  id: string;
  userId: string;
  businessName: string;
  category: string;
  location: string | null;
  description: string | null;
  menuDetails: string | null;
}

interface Props {
  initialProfile: BusinessProfile | null;
}

interface FormValues {
  businessName: string;
  category: string;
  location: string;
  description: string;
  menuDetails: string;
}

export function BusinessProfileForm({ initialProfile }: Props) {
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      businessName: initialProfile?.businessName ?? "",
      category: initialProfile?.category ?? "",
      location: initialProfile?.location ?? "",
      description: initialProfile?.description ?? "",
      menuDetails: initialProfile?.menuDetails ?? "",
    },
  });

  const onSubmit = async (data: FormValues) => {
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถบันทึกข้อมูลได้");
      }

      setSuccessMsg("บันทึกข้อมูลโปรไฟล์ธุรกิจเรียบร้อยแล้ว");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ข้อมูลธุรกิจของฉัน</CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          ข้อมูลตรงนี้จะใช้เพื่อกรอกแบบฟอร์มขอสร้างวิดีโอ (Intake Form) ให้คุณโดยอัตโนมัติ เพื่อความสะดวกในการสร้างวิดีโอถัดไป
        </p>
      </CardHeader>
      
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-6 pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="ชื่อธุรกิจ / ร้านค้า *"
            placeholder="เช่น กะเพราแท้คาเฟ่, สมใจโฮสเทล"
            {...register("businessName", { required: "กรุณาระบุชื่อธุรกิจ" })}
            error={errors.businessName?.message}
          />
          <Input
            label="ประเภทธุรกิจ *"
            placeholder="เช่น ร้านอาหาร, ร้านกาแฟ, โรงแรม, สปา"
            {...register("category", { required: "กรุณาระบุประเภทธุรกิจ" })}
            error={errors.category?.message}
          />
        </div>

        <Input
          label="ที่ตั้ง / พิกัดร้าน"
          placeholder="เช่น ถนนสีลม กรุงเทพฯ (ตรงข้าม BTS ศาลาแดง)"
          {...register("location")}
        />

        <Textarea
          label="รายละเอียดธุรกิจ / ร้านค้า"
          placeholder="เช่น ร้านอาหารกะเพราสูตรโบราณ รสชาติจัดจ้าน ใช้วัตถุดิบคุณภาพสูง เน้นเสิร์ฟเร็วทันใจ..."
          rows={3}
          {...register("description")}
        />

        <Textarea
          label="รายละเอียดเมนูเด่น / สินค้าเด่น"
          placeholder="เช่น ข้าวกะเพราเนื้อสับไข่ดาวกรอบ, ชาไทยเย็นสูตรเข้มข้น, บริการนวดอโรม่าแบบดั้งเดิม..."
          rows={3}
          {...register("menuDetails")}
        />

        {successMsg && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {successMsg}
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting}>
            บันทึกข้อมูลธุรกิจ
          </Button>
        </div>
      </form>
    </Card>
  );
}
