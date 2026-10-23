"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { MOTION_TEMPLATES } from "@/config/motionTemplates";
import { TEXT_GRAPHIC_STYLE_IDS } from "@/config/textGraphicStyles";
import { BACKGROUND_MUSIC_TRACKS } from "@/config/backgroundMusic";
import type {
  CampaignStats,
  CampaignTemplate,
  Merchant,
  MerchantCampaign,
} from "@/domain/models/MerchantCampaign";
import { CampaignQrCard } from "@/features/campaigns/admin/CampaignQrCard";

/**
 * Merchant Campaigns — the operator page (two e-mail addresses only).
 *
 * Shops → quick-video templates (look, text style, colour, opening/closing
 * card texts, default sentence and sound) → campaigns (discount, creator
 * reward, cooldown, dates, status) with a printable QR and live counts.
 *
 * English only, like the rest of the admin surface (see `config/adminNav.ts`).
 */

type Json<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };
type MerchantRow = Json<Merchant>;
type TemplateRow = Json<CampaignTemplate>;
type CampaignRow = Json<MerchantCampaign> & { qrLink: string; stats: CampaignStats };

interface Overview {
  merchants: MerchantRow[];
  templates: TemplateRow[];
  campaigns: CampaignRow[];
}

async function api<T>(path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/campaign-admin${path}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json as T;
}

const TABS = ["campaigns", "shops", "templates"] as const;
type Tab = (typeof TABS)[number];

const CLIP_SOUND = "clip_sound";

export function CampaignAdmin() {
  const [tab, setTab] = useState<Tab>("campaigns");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api<Overview>(""));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setFlash(null);
      setError(null);
      try {
        await action();
        setFlash(label);
        await reload();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [reload]
  );

  return (
    <div className="flex w-full flex-col gap-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Shop Campaigns</h1>
        <p className="mt-1 text-sm text-slate-600">
          Customers scan the shop QR in the RClipper app, shoot one clip, and the phone makes a branded video ending
          with their referral code. Nothing is rendered on the server.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              "min-h-[40px] flex-1 rounded-md text-sm font-medium capitalize",
              tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
            )}
          >
            {id}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {flash && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{flash}</p>}

      {!data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : tab === "shops" ? (
        <ShopsTab data={data} run={run} />
      ) : tab === "templates" ? (
        <TemplatesTab data={data} run={run} />
      ) : (
        <CampaignsTab data={data} run={run} goTo={setTab} />
      )}
    </div>
  );
}

type Run = (label: string, action: () => Promise<unknown>) => Promise<boolean>;

// ── Shops ────────────────────────────────────────────────────────────────────

const EMPTY_SHOP = { name: "", category: "", location: "", address: "", phone: "", notes: "" };

function ShopsTab({ data, run }: { data: Overview; run: Run }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_SHOP);

  const startEdit = (shop: MerchantRow | null) => {
    setEditing(shop?.id ?? "new");
    setForm(
      shop
        ? { name: shop.name, category: shop.category, location: shop.location, address: shop.address, phone: shop.phone, notes: shop.notes }
        : EMPTY_SHOP
    );
  };

  const save = async () => {
    const ok = await run(
      editing === "new" ? "Shop created" : "Shop saved",
      () => (editing === "new" ? api("/merchants", "POST", form) : api(`/merchants/${editing}`, "PATCH", form))
    );
    if (ok) setEditing(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <Card title={editing === "new" ? "New shop" : "Edit shop"}>
          <Grid>
            <Field label="Shop name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Kind of shop (chip on the opening card)" placeholder="CAFÉ" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
            <Field label="Location / branch" placeholder="Nimman, Chiang Mai" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          </Grid>
          <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          <Field label="Notes (internal)" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} multiline />
          <Actions>
            <Primary onClick={() => void save()}>Save shop</Primary>
            <Secondary onClick={() => setEditing(null)}>Cancel</Secondary>
          </Actions>
        </Card>
      ) : (
        <Primary onClick={() => startEdit(null)}>+ New shop</Primary>
      )}

      {data.merchants.length === 0 && <Empty>No shops yet.</Empty>}
      {data.merchants.map((shop) => (
        <Card key={shop.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-slate-900">
                {shop.name} {shop.status === "archived" && <Badge tone="slate">archived</Badge>}
              </p>
              <p className="text-sm text-slate-600">
                {[shop.category, shop.location].filter(Boolean).join(" · ") || "—"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {data.templates.filter((t) => t.merchantId === shop.id).length} templates ·{" "}
                {data.campaigns.filter((c) => c.merchantId === shop.id).length} campaigns
              </p>
            </div>
            <div className="flex gap-2">
              <Secondary onClick={() => startEdit(shop)}>Edit</Secondary>
              <Secondary
                onClick={() =>
                  void run(shop.status === "archived" ? "Shop restored" : "Shop archived", () =>
                    api(`/merchants/${shop.id}`, "PATCH", { status: shop.status === "archived" ? "active" : "archived" })
                  )
                }
              >
                {shop.status === "archived" ? "Restore" : "Archive"}
              </Secondary>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────

function emptyTemplate(merchantId: string) {
  return {
    merchantId,
    name: "",
    motionTemplateId: "clean_frame",
    textStyleId: "premium",
    accentColor: "#D7262E",
    introKicker: "",
    introTitle: "",
    introSub: "",
    ctaTitle: "",
    ctaPlace: "",
    defaultStatement: "",
    defaultMusicTrackId: CLIP_SOUND,
    captionLanguage: "th" as "th" | "en",
  };
}
type TemplateForm = ReturnType<typeof emptyTemplate>;

function TemplatesTab({ data, run }: { data: Overview; run: Run }) {
  const activeShops = data.merchants.filter((m) => m.status === "active");
  const [shopId, setShopId] = useState(activeShops[0]?.id ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyTemplate(shopId));
  const shop = data.merchants.find((m) => m.id === (editing ? form.merchantId : shopId));

  const startEdit = (template: TemplateRow | null) => {
    if (template) {
      setEditing(template.id);
      setForm({
        merchantId: template.merchantId,
        name: template.name,
        motionTemplateId: template.motionTemplateId,
        textStyleId: template.textStyleId,
        accentColor: template.accentColor,
        introKicker: template.introKicker,
        introTitle: template.introTitle,
        introSub: template.introSub,
        ctaTitle: template.ctaTitle,
        ctaPlace: template.ctaPlace,
        defaultStatement: template.defaultStatement,
        defaultMusicTrackId: template.defaultMusicTrackId,
        captionLanguage: template.captionLanguage,
      });
    } else {
      setEditing("new");
      setForm(emptyTemplate(shopId));
    }
  };

  const save = async () => {
    const { merchantId: _merchantId, ...rest } = form;
    const ok = await run(editing === "new" ? "Template created" : "Template saved", () =>
      editing === "new" ? api("/templates", "POST", form) : api(`/templates/${editing}`, "PATCH", rest)
    );
    if (ok) setEditing(null);
  };

  if (activeShops.length === 0) return <Empty>Create a shop first.</Empty>;

  const set = <K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) => setForm({ ...form, [key]: value });
  const en = form.captionLanguage === "en";

  return (
    <div className="flex flex-col gap-4">
      {!editing && (
        <Card>
          <label className="text-sm font-medium text-slate-700">Shop</label>
          <select
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
          >
            {activeShops.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <div className="mt-3">
            <Primary onClick={() => startEdit(null)}>+ New template for this shop</Primary>
          </div>
        </Card>
      )}

      {editing && (
        <Card title={`${editing === "new" ? "New" : "Edit"} template — ${shop?.name ?? ""}`}>
          <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
            <div className="flex flex-col gap-3">
              <Field label="Template name *" value={form.name} onChange={(v) => set("name", v)} />
              <Grid>
                <Select
                  label="Look (frame & decoration)"
                  value={form.motionTemplateId}
                  onChange={(v) => set("motionTemplateId", v)}
                  options={MOTION_TEMPLATES.map((m) => ({ value: m.id, label: `${m.name} (${m.id})` }))}
                />
                <Select
                  label="Text style"
                  value={form.textStyleId}
                  onChange={(v) => set("textStyleId", v)}
                  options={TEXT_GRAPHIC_STYLE_IDS.map((id) => ({ value: id, label: id }))}
                />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Brand colour</span>
                  <input
                    type="color"
                    value={form.accentColor}
                    onChange={(e) => set("accentColor", e.target.value.toUpperCase())}
                    className="h-11 w-full rounded-lg border border-slate-300"
                  />
                </label>
                <Select
                  label="Language of the cards & sentence"
                  value={form.captionLanguage}
                  onChange={(v) => set("captionLanguage", v as "th" | "en")}
                  options={[{ value: "th", label: "Thai" }, { value: "en", label: "English" }]}
                />
              </Grid>

              <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Opening card</p>
              <Grid>
                <Field label="Chip" placeholder={shop?.category || "CAFÉ"} value={form.introKicker} onChange={(v) => set("introKicker", v)} />
                <Field label="Main line" placeholder={shop?.name} value={form.introTitle} onChange={(v) => set("introTitle", v)} />
              </Grid>
              <Field label="Second line" placeholder={shop?.location} value={form.introSub} onChange={(v) => set("introSub", v)} />

              <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Closing card</p>
              <Grid>
                <Field
                  label="Offer line"
                  placeholder={en ? "Friends get {discount}% off" : "เพื่อนรับส่วนลด {discount}%"}
                  value={form.ctaTitle}
                  onChange={(v) => set("ctaTitle", v)}
                />
                <Field label="Second line" placeholder={shop?.name} value={form.ctaPlace} onChange={(v) => set("ctaPlace", v)} />
              </Grid>
              <p className="text-xs text-slate-500">
                The button always shows {en ? "“CODE A7K4”" : "“โค้ด A7K4”"} with the customer&apos;s own code. Texts may use{" "}
                <code>{"{discount}"}</code>, <code>{"{merchant}"}</code>, <code>{"{location}"}</code>,{" "}
                <code>{"{code}"}</code>. Leave a field empty to use the shop&apos;s details.
              </p>

              <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Customer defaults</p>
              <Field
                label="Default sentence (the customer can edit it) — keep it factual, not a review"
                placeholder={en ? "Afternoon at {merchant}" : "แวะมาที่ {merchant} วันนี้"}
                value={form.defaultStatement}
                onChange={(v) => set("defaultStatement", v)}
              />
              <Select
                label="Default sound (the customer can pick another)"
                value={form.defaultMusicTrackId}
                onChange={(v) => set("defaultMusicTrackId", v)}
                options={[
                  { value: CLIP_SOUND, label: "Sound from the customer's video" },
                  ...BACKGROUND_MUSIC_TRACKS.map((t) => ({ value: t.id, label: `${t.label}${t.mood ? ` — ${t.mood}` : ""}` })),
                ]}
              />
            </div>
            <CardPreview form={form} shop={shop} />
          </div>
          <Actions>
            <Primary onClick={() => void save()}>Save template</Primary>
            <Secondary onClick={() => setEditing(null)}>Cancel</Secondary>
          </Actions>
        </Card>
      )}

      {!editing &&
        data.templates
          .filter((t) => t.merchantId === shopId)
          .map((template) => (
            <Card key={template.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-8 w-8 flex-shrink-0 rounded-full" style={{ background: template.accentColor }} />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{template.name}</p>
                    <p className="text-xs text-slate-500">
                      {template.motionTemplateId} · {template.textStyleId} · {template.captionLanguage.toUpperCase()} ·{" "}
                      {template.defaultMusicTrackId === CLIP_SOUND ? "clip sound" : template.defaultMusicTrackId}
                    </p>
                  </div>
                </div>
                <Secondary onClick={() => startEdit(template)}>Edit</Secondary>
              </div>
            </Card>
          ))}
      {!editing && data.templates.filter((t) => t.merchantId === shopId).length === 0 && (
        <Empty>No templates for this shop yet.</Empty>
      )}
    </div>
  );
}

/** A rough sketch of the two cards, so the operator sees the words in place. */
function CardPreview({ form, shop }: { form: TemplateForm; shop?: MerchantRow }) {
  const fill = (text: string) =>
    text
      .replace(/\{discount\}/g, "5")
      .replace(/\{code\}/g, "A7K4")
      .replace(/\{merchant\}/g, shop?.name ?? "")
      .replace(/\{location\}/g, shop?.location ?? "");
  const en = form.captionLanguage === "en";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Sketch (not the final look)</p>
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-xl bg-gradient-to-b from-slate-500 to-slate-800 text-white">
        <div className="absolute left-3 right-3 top-4 rounded-lg bg-black/45 p-2">
          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: form.accentColor }}>
            {fill(form.introKicker || shop?.category || "")}
          </span>
          <p className="mt-1 text-sm font-bold leading-tight">{fill(form.introTitle || shop?.name || "")}</p>
          <p className="text-[10px] text-white/80">{fill(form.introSub || shop?.location || "")}</p>
        </div>
        <p className="absolute bottom-24 left-3 right-3 text-center text-[11px] font-semibold drop-shadow">
          {fill(form.defaultStatement) || (en ? "Customer's sentence" : "ข้อความของลูกค้า")}
        </p>
        <div className="absolute bottom-6 left-3 right-3 flex items-center gap-2 rounded-lg bg-white p-2 text-slate-900">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold">
              {fill(form.ctaTitle || (en ? "Friends get {discount}% off" : "เพื่อนรับส่วนลด {discount}%"))}
            </p>
            <p className="truncate text-[9px] text-slate-500">{fill(form.ctaPlace || shop?.name || "")}</p>
          </div>
          <span className="rounded-full px-2 py-1 text-[10px] font-bold text-white" style={{ background: form.accentColor }}>
            {en ? "CODE" : "โค้ด"} A7K4
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Campaigns ────────────────────────────────────────────────────────────────

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function CampaignsTab({ data, run, goTo }: { data: Overview; run: Run; goTo: (tab: Tab) => void }) {
  const activeShops = data.merchants.filter((m) => m.status === "active");
  const [editing, setEditing] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [form, setForm] = useState({
    merchantId: "",
    templateId: "",
    title: "",
    discountPercent: "5",
    rewardDescription: "",
    rewardCooldownDays: "30",
    startsAt: "",
    endsAt: "",
  });
  const shopTemplates = useMemo(
    () => data.templates.filter((t) => t.merchantId === form.merchantId),
    [data.templates, form.merchantId]
  );

  const startEdit = (campaign: CampaignRow | null) => {
    if (campaign) {
      setEditing(campaign.id);
      setForm({
        merchantId: campaign.merchantId,
        templateId: campaign.templateId,
        title: campaign.title,
        discountPercent: String(campaign.discountPercent),
        rewardDescription: campaign.rewardDescription,
        rewardCooldownDays: String(campaign.rewardCooldownDays),
        startsAt: toLocalInput(campaign.startsAt),
        endsAt: toLocalInput(campaign.endsAt),
      });
    } else {
      const merchantId = activeShops[0]?.id ?? "";
      setEditing("new");
      setForm({
        merchantId,
        templateId: data.templates.find((t) => t.merchantId === merchantId)?.id ?? "",
        title: "",
        discountPercent: "5",
        rewardDescription: "",
        rewardCooldownDays: "30",
        startsAt: "",
        endsAt: "",
      });
    }
  };

  const save = async () => {
    const payload = {
      templateId: form.templateId,
      title: form.title,
      discountPercent: Number(form.discountPercent),
      rewardDescription: form.rewardDescription,
      rewardCooldownDays: Number(form.rewardCooldownDays),
      startsAt: fromLocalInput(form.startsAt),
      endsAt: fromLocalInput(form.endsAt),
    };
    const ok = await run(editing === "new" ? "Campaign created (draft)" : "Campaign saved", () =>
      editing === "new"
        ? api("/campaigns", "POST", { ...payload, merchantId: form.merchantId })
        : api(`/campaigns/${editing}`, "PATCH", payload)
    );
    if (ok) setEditing(null);
  };

  const setStatus = (campaign: CampaignRow, status: MerchantCampaign["status"]) =>
    void run(`Campaign ${status === "live" ? "is live" : status}`, () =>
      api(`/campaigns/${campaign.id}`, "PATCH", { status })
    );

  if (activeShops.length === 0) {
    return (
      <Empty>
        Create a shop and a template first.{" "}
        <button type="button" className="font-medium text-blue-700" onClick={() => goTo("shops")}>
          Go to shops
        </button>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <Card title={editing === "new" ? "New campaign" : "Edit campaign"}>
          <Grid>
            <Select
              label="Shop"
              value={form.merchantId}
              disabled={editing !== "new"}
              onChange={(v) =>
                setForm({ ...form, merchantId: v, templateId: data.templates.find((t) => t.merchantId === v)?.id ?? "" })
              }
              options={activeShops.map((m) => ({ value: m.id, label: m.name }))}
            />
            <Select
              label="Template"
              value={form.templateId}
              onChange={(v) => setForm({ ...form, templateId: v })}
              options={[
                { value: "", label: shopTemplates.length ? "Choose…" : "No template for this shop" },
                ...shopTemplates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </Grid>
          <Field label="Campaign name *" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <Grid>
            <Field label="Friend discount (%)" type="number" value={form.discountPercent} onChange={(v) => setForm({ ...form, discountPercent: v })} />
            <Field
              label="One creator reward per device every … days"
              type="number"
              value={form.rewardCooldownDays}
              onChange={(v) => setForm({ ...form, rewardCooldownDays: v })}
            />
          </Grid>
          <Field
            label="Creator reward (what staff give, ~10–20 ฿)"
            placeholder="Free iced tea"
            value={form.rewardDescription}
            onChange={(v) => setForm({ ...form, rewardDescription: v })}
          />
          <Grid>
            <Field label="Starts (optional)" type="datetime-local" value={form.startsAt} onChange={(v) => setForm({ ...form, startsAt: v })} />
            <Field label="Ends (optional)" type="datetime-local" value={form.endsAt} onChange={(v) => setForm({ ...form, endsAt: v })} />
          </Grid>
          <Actions>
            <Primary onClick={() => void save()}>Save campaign</Primary>
            <Secondary onClick={() => setEditing(null)}>Cancel</Secondary>
          </Actions>
        </Card>
      ) : (
        <Primary onClick={() => startEdit(null)}>+ New campaign</Primary>
      )}

      {data.campaigns.length === 0 && <Empty>No campaigns yet.</Empty>}
      {data.campaigns.map((campaign) => {
        const shop = data.merchants.find((m) => m.id === campaign.merchantId);
        const template = data.templates.find((t) => t.id === campaign.templateId);
        return (
          <Card key={campaign.id}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-900">
                    {campaign.title} <StatusBadge status={campaign.status} />
                  </p>
                  <p className="text-sm text-slate-600">
                    {shop?.name ?? "?"} · template “{template?.name ?? "?"}” · friends {campaign.discountPercent}% off
                  </p>
                  <p className="text-xs text-slate-500">
                    Reward: {campaign.rewardDescription || "—"} · 1 per device / {campaign.rewardCooldownDays} days
                    {campaign.endsAt ? ` · ends ${new Date(campaign.endsAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {campaign.status !== "live" && campaign.status !== "ended" && (
                    <Primary onClick={() => setStatus(campaign, "live")}>Go live</Primary>
                  )}
                  {campaign.status === "live" && <Secondary onClick={() => setStatus(campaign, "paused")}>Pause</Secondary>}
                  {campaign.status !== "ended" && (
                    <Secondary
                      onClick={() => {
                        if (window.confirm("End this campaign? Customers can no longer open it, and iTravy will see its codes as ended.")) {
                          setStatus(campaign, "ended");
                        }
                      }}
                    >
                      End
                    </Secondary>
                  )}
                  <Secondary onClick={() => startEdit(campaign)}>Edit</Secondary>
                  <Secondary onClick={() => setQrFor(qrFor === campaign.id ? null : campaign.id)}>
                    {qrFor === campaign.id ? "Hide QR" : "QR code"}
                  </Secondary>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="Creators" value={campaign.stats.creators} />
                <Stat label="Videos made" value={campaign.stats.videosMade} />
                <Stat label="Rewards given" value={campaign.stats.rewardsGranted} />
                <Stat label="Refused (limit)" value={campaign.stats.rewardsRefused} />
                <Stat label="Post links" value={campaign.stats.postLinks} />
              </div>

              {qrFor === campaign.id && (
                <CampaignQrCard
                  link={campaign.qrLink}
                  shopName={shop?.name ?? ""}
                  campaignTitle={campaign.title}
                  discountPercent={campaign.discountPercent}
                  live={campaign.status === "live"}
                  onRotate={() => {
                    if (window.confirm("Make a new QR code? Every QR already printed for this campaign stops working.")) {
                      void run("New QR key made — print the new QR", () =>
                        api(`/campaigns/${campaign.id}`, "PATCH", { rotateQrKey: true })
                      );
                    }
                  }}
                />
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Small UI pieces ──────────────────────────────────────────────────────────

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1">{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</p>;
}
function Primary({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[40px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">
      {children}
    </button>
  );
}
function Secondary({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
    >
      {children}
    </button>
  );
}
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[44px] min-w-0 rounded-lg border border-slate-300 px-3 text-base"
        />
      )}
    </label>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-lg font-bold tabular-nums text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "amber" | "slate" | "red" }) {
  const tones = {
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    slate: "bg-slate-100 text-slate-600",
    red: "bg-red-100 text-red-700",
  };
  return <span className={clsx("ml-1 rounded-full px-2 py-0.5 align-middle text-xs font-medium", tones[tone])}>{children}</span>;
}
function StatusBadge({ status }: { status: MerchantCampaign["status"] }) {
  const tone = status === "live" ? "green" : status === "paused" ? "amber" : status === "ended" ? "red" : "slate";
  return <Badge tone={tone}>{status}</Badge>;
}
