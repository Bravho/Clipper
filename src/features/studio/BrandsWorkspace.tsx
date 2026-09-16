"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import type { StudioBrand } from "@/domain/models/Studio";
import { useStudioStore } from "./useStudioStore";

const blank = { name: "", product: "", audience: "", promise: "", tone: "" };

export function BrandsWorkspace() {
  const { store, ready, update, persistence, syncPending } = useStudioStore();
  const [form, setForm] = useState(blank);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    const brand: StudioBrand = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      product: form.product.trim(),
      audience: form.audience.trim(),
      promise: form.promise.trim(),
      tone: form.tone.trim(),
      createdAt: new Date().toISOString(),
    };
    update((current) => ({
      ...current,
      brands: [...current.brands, brand],
      selectedBrandId: current.selectedBrandId || brand.id,
    }));
    setForm(blank);
  }

  function remove(id: string) {
    update((current) => ({
      ...current,
      brands: current.brands.filter((brand) => brand.id !== id),
      selectedBrandId: current.selectedBrandId === id ? "" : current.selectedBrandId,
    }));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-slate-950">Brand Workspace</h2>
          <p className="mt-1 text-sm text-slate-500">
            เก็บเฉพาะข้อมูลที่จำเป็นต่อการเขียนโฆษณา ไม่ต้องตั้งค่าระบบที่ซับซ้อน
          </p>
          {ready && (
            <p className={`mt-2 text-xs font-medium ${persistence === "database" ? "text-emerald-700" : "text-amber-700"}`}>
              {persistence === "database"
                ? "ซิงก์กับ PostgreSQL แล้ว"
                : persistence === "local"
                  ? syncPending
                    ? "บันทึกในเครื่องแล้ว — ระบบจะซิงก์ไป PostgreSQL เมื่อเชื่อมต่อได้"
                    : "บันทึกอย่างถาวรในฐานข้อมูล SQLite ภายในเครื่อง"
                  : "กำลังใช้ข้อมูลสำรองใน browser — ตรวจสอบพื้นที่จัดเก็บในเครื่อง"}
            </p>
          )}
        </div>
        {!ready ? (
          <Card><p className="text-sm text-slate-500">กำลังโหลดข้อมูล…</p></Card>
        ) : store.brands.length === 0 ? (
          <Card className="border-dashed text-center">
            <p className="font-medium text-slate-800">ยังไม่มีแบรนด์</p>
            <p className="mt-1 text-sm text-slate-500">เพิ่มแบรนด์แรกด้วยแบบฟอร์มด้านขวา</p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {store.brands.map((brand) => (
              <Card key={brand.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">{brand.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">{brand.product || "ยังไม่ได้ระบุสินค้า"}</p>
                  </div>
                  <button onClick={() => remove(brand.id)} className="text-xs text-slate-400 hover:text-red-600">
                    ลบ
                  </button>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div><dt className="text-xs font-medium uppercase text-slate-400">Audience</dt><dd className="mt-0.5 text-slate-700">{brand.audience || "—"}</dd></div>
                  <div><dt className="text-xs font-medium uppercase text-slate-400">Brand promise</dt><dd className="mt-0.5 text-slate-700">{brand.promise || "—"}</dd></div>
                  <div><dt className="text-xs font-medium uppercase text-slate-400">Tone</dt><dd className="mt-0.5 text-slate-700">{brand.tone || "—"}</dd></div>
                </dl>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Card className="h-fit lg:sticky lg:top-4">
        <CardHeader>
          <CardTitle>เพิ่มแบรนด์</CardTitle>
          <CardDescription>5 ช่องนี้เพียงพอสำหรับเริ่มสร้างสคริปต์</CardDescription>
        </CardHeader>
        <form onSubmit={save} className="space-y-4">
          <Input label="ชื่อแบรนด์ *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="สินค้าหรือบริการหลัก" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} />
          <Textarea label="ลูกค้าเป้าหมาย" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="เช่น เจ้าของร้านอาหารที่ไม่มีเวลาทำคอนเทนต์" />
          <Textarea label="คำสัญญาหลักของแบรนด์" value={form.promise} onChange={(e) => setForm({ ...form, promise: e.target.value })} placeholder="ลูกค้าจะได้ผลลัพธ์อะไร" />
          <Input label="น้ำเสียง" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder="เช่น จริงใจ กระชับ เป็นผู้เชี่ยวชาญ" />
          <Button type="submit" fullWidth>บันทึกแบรนด์</Button>
        </form>
      </Card>
    </div>
  );
}
