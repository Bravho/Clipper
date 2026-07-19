import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { redirect } from "next/navigation";
import { getRoleHomePath } from "@/config/routes";
import { ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { Button } from "@/components/ui/Button";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-slate-900 py-24 px-4 text-center text-white">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative mx-auto max-w-4xl">
          <div className="mb-6 flex items-center justify-center gap-3">
            <Image src="/logo.png" alt="RClipper logo" width={56} height={56} className="rounded-xl" />
            <span className="text-3xl font-bold tracking-tight text-white">RClipper</span>
          </div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-700/20 px-4 py-1.5 text-sm font-medium text-blue-400 ring-1 ring-blue-700/40">
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            Marketplace สำหรับเจ้าของธุรกิจท่องเที่ยว ร้านอาหารและเครื่องดื่ม ที่ไม่มีเวลาทำคลิปโปรโมทด้วยตนเอง
          </div>
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            ทำคลิปโฆษณา<br />
            <span className="text-blue-400">ไม่ต้องรอ ไม่ต้องมีความรู้ด้านตัดต่อ</span>
          </h1>
          <p className="mx-auto mb-3 max-w-2xl text-lg text-slate-300">
            ส่ง brief — เลือก{" "}
            <span className="font-semibold text-white">AI ตัดต่อเสร็จ ภายใน 24 ชม.</span>{" "}
            หรือ{" "}
            <span className="font-semibold text-white">
              Editor ที่เชี่ยวชาญ เพื่อเข้าถึงโฆษณาให้คนไทยและนักท่องเที่ยวต่างชาติสนใจ
            </span>
          </p>
          <p className="mx-auto mb-10 max-w-xl text-base text-slate-400">
            ส่งออกไฟล์ในอัตราส่วนที่เหมาะกับ{" "}
            <span className="font-medium text-white">Travy</span>, TikTok,
            Instagram, YouTube และช่องทางอื่นๆ — ดาวน์โหลดแล้วโพสต์ได้ทันที
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href={ROUTES.SIGNUP}>
              <Button size="lg" className="min-w-[200px]">
                เริ่มต้นใช้งาน
              </Button>
            </Link>
            <Link href={ROUTES.LOGIN}>
              <Button
                variant="outline"
                size="lg"
                className="min-w-[140px] border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                เข้าสู่ระบบ
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="bg-slate-800 py-5 px-4 border-b border-slate-700">
        <div className="mx-auto max-w-5xl grid grid-cols-2 gap-4 sm:grid-cols-4 text-center">
          {[
            { value: "24 ชม.", label: "เร็วที่สุดสำหรับ AI track" },
            { value: "3 ภาษา", label: "Subtitle ไทย · อังกฤษ · จีน" },
            { value: "Travy", label: "แพลตฟอร์มวิดีโอท่องเที่ยวไทย" },
            { value: "฿49", label: "ราคาเริ่มต้นต่อคลิป" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <span className="text-xl font-bold text-white">{s.value}</span>
              <span className="text-xs text-slate-400">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Two tracks */}
      <section className="py-20 px-4 bg-white">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-3 text-center text-3xl font-bold text-slate-900">
            เลือกแบบที่ใช่สำหรับธุรกิจคุณ
          </h2>
          <p className="mb-12 text-center text-slate-500">
            ทั้งสองแบบรวม subtitle หลายภาษาและไฟล์หลายอัตราส่วนพร้อมโพสต์ในราคาเดียวกัน
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            {/* AI track */}
            <div className="rounded-2xl border-2 border-blue-100 bg-blue-50 p-8 flex flex-col">
              <div className="mb-4 inline-block self-start rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white uppercase tracking-wider">
                AI Track
              </div>
              <h3 className="mb-3 text-2xl font-bold text-slate-900">
                ไว · ถูก · ไม่ต้องรู้เรื่องวิดีโอ
              </h3>
              <p className="mb-6 text-slate-600 leading-relaxed flex-1">
                ส่งรูป วิดีโอ หรือแค่คำบรรยาย AI จัดการตัดต่อ ใส่ subtitle
                ไทย-อังกฤษ-จีน และส่งออกไฟล์หลายอัตราส่วนให้พร้อมดาวน์โหลด
                เหมาะสำหรับธุรกิจที่ต้องการคอนเทนต์สม่ำเสมอในราคาประหยัด
              </p>
              <ul className="mb-8 space-y-2.5 text-sm text-slate-700">
                {[
                  "Subtitle 3 ภาษา: ไทย · อังกฤษ · จีน",
                  "Export 4 ratio: 9:16 · 16:9 · 1:1 · 4:5",
                  "ไฟล์พร้อมโพสต์ ดาวน์โหลดได้ทันที",
                  "ผลลัพธ์ภายใน 24–48 ชั่วโมง",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={ROUTES.SIGNUP} className="block w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 text-center text-sm transition-colors">
                เริ่มด้วย AI
              </Link>
            </div>

            {/* Editor track */}
            <div className="rounded-2xl border-2 border-amber-100 bg-amber-50 p-8 flex flex-col">
              <div className="mb-4 inline-block self-start rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white uppercase tracking-wider">
                Editor Track
              </div>
              <h3 className="mb-3 text-2xl font-bold text-slate-900">
                เจาะลึก · เข้าใจตลาด · เพิ่ม Reach
              </h3>
              <p className="mb-6 text-slate-600 leading-relaxed flex-1">
                เลือก Editor ที่เชี่ยวชาญ TikTok / YouTube algorithm และเข้าใจ
                พฤติกรรมนักท่องเที่ยวต่างชาติ เหมาะสำหรับธุรกิจที่ต้องการ
                engagement สูง เจาะกลุ่มจีน เกาหลี ญี่ปุ่น และ Western
              </p>
              <ul className="mb-8 space-y-2.5 text-sm text-slate-700">
                {[
                  "Editor รู้จัก algorithm ของแต่ละ platform",
                  "สคริปต์และ hook เฉพาะตลาดต่างชาติ",
                  "Voice-over และ narration หลายภาษา",
                  "ปรึกษา strategy ก่อนผลิต",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-amber-500 flex items-center justify-center text-white text-[10px] font-bold">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={ROUTES.SIGNUP} className="block w-full rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 px-4 text-center text-sm transition-colors">
                เลือก Editor
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* For who */}
      <section className="border-t border-slate-200 bg-slate-50 py-16 px-4 text-center">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-3 text-2xl font-bold text-slate-900">
            RClipper สำหรับใคร?
          </h2>
          <p className="mb-10 text-slate-500">
            ออกแบบมาสำหรับธุรกิจในไทยที่ต้องการดึงดูดลูกค้าทั้งไทยและต่างชาติ
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { icon: "🏨", label: "โรงแรม & ที่พัก", sub: "Hostel · Resort · Villa" },
              { icon: "🍜", label: "ร้านอาหาร & Café", sub: "Street food · Fine dining" },
              { icon: "🛶", label: "Tour & Activity", sub: "Kayak · Dive · Safari" },
              { icon: "🛍️", label: "ร้านค้า & Local Brand", sub: "ของที่ระลึก · Craft" },
            ].map((a) => (
              <div
                key={a.label}
                className="rounded-xl bg-white p-6 shadow-sm border border-slate-100"
              >
                <div className="mb-3 text-3xl">{a.icon}</div>
                <div className="font-semibold text-slate-900 text-sm">{a.label}</div>
                <div className="text-xs text-slate-500 mt-1">{a.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 bg-white">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold text-slate-900">
            ง่ายมาก — แค่ 4 ขั้น
          </h2>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: "1",
                title: "สมัครฟรี",
                desc: "สมัครด้วย Google หรืออีเมล เริ่มต้นที่ 0 เครดิต แล้วเลือกเติมเครดิตเมื่อต้องการ",
              },
              {
                step: "2",
                title: "ส่ง brief + ไฟล์",
                desc: "กรอกรายละเอียด บอกสไตล์และกลุ่มเป้าหมาย อัพโหลดวิดีโอหรือรูปสูงสุด 5 ไฟล์",
              },
              {
                step: "3",
                title: "AI หรือ Editor ลงมือ",
                desc: "ทีมผลิตคลิปภายใน 2 วันทำการ AI track เร็วกว่า Editor track ปรึกษาก่อนผลิต",
              },
              {
                step: "4",
                title: "รับคลิปพร้อมโพสต์",
                desc: "ดาวน์โหลดคลิปทุกอัตราส่วน พร้อมนำไปโพสต์บนช่องทางของคุณได้ทันที",
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

      {/* Distribution — Travy highlight */}
      <section className="bg-slate-900 py-16 px-4 text-center text-white border-t border-slate-700">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 inline-block rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white ring-1 ring-white/20">
            พร้อมสำหรับทุกช่องทาง
          </div>
          <h2 className="mb-4 text-2xl font-bold">
            ไฟล์พร้อมโพสต์ทุกช่องทาง รวมถึงแอป Travy และเว็บไซต์ Travy.buzz
          </h2>
          <p className="mb-8 text-slate-400 max-w-xl mx-auto">
            Travy คือแอปวิดีโอท่องเที่ยวของไทย พร้อมเว็บไซต์ Travy.buzz ที่นักท่องเที่ยวต่างชาติใช้
            ค้นหาประสบการณ์ในไทย — เราส่งออกไฟล์ในอัตราส่วนที่เหมาะกับแต่ละช่องทางให้พร้อมโพสต์
            และคลิปที่คัดเลือกอาจได้รับการนำไปเผยแพร่บนช่องทางของ RClipper
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { name: "Travy", highlight: true },
              { name: "TikTok" },
              { name: "Instagram" },
              { name: "Facebook" },
              { name: "YouTube" },
              { name: "CDN / Direct Link" },
            ].map((ch) => (
              <span
                key={ch.name}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                  ch.highlight
                    ? "bg-blue-600 text-white ring-2 ring-blue-400"
                    : "border border-slate-700 bg-slate-800 text-slate-300"
                }`}
              >
                {ch.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 text-center bg-white">
        <div className="mx-auto max-w-xl">
          <h2 className="mb-4 text-3xl font-bold text-slate-900">
            พร้อมทำคลิปแรกหรือยัง?
          </h2>
          <p className="mb-2 text-slate-600">
            สมัครฟรี เริ่มต้นที่ 0 เครดิต — ไม่ต้องใส่บัตรเครดิต
          </p>
          <p className="mb-8 text-sm text-slate-400">
            เติมเครดิตผ่าน PromptPay หรือ Credit card เมื่อพร้อมเริ่มทำคลิป
          </p>
          <Link href={ROUTES.SIGNUP}>
            <Button size="lg" className="min-w-[220px]">
              สร้างบัญชีฟรี — เริ่มเลย
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
