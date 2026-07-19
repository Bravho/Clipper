"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  NativePurchases,
  PURCHASE_TYPE,
  Product,
} from "@capgo/native-purchases";
import { MOBILE_STORE_PRODUCTS } from "@/config/mobilePurchases";
import { getMobilePlatform } from "@/lib/mobile/platform";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export function MobileStoreTopup() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const pendingKey = "rclipper-pending-store-purchase";

  const verifyTransaction = async (purchase: {
    platform: "ios" | "android";
    productId: string;
    transactionId: string;
  }): Promise<number> => {
    const response = await fetch("/api/mobile/purchases/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(purchase),
    });
    const result = (await response.json().catch(() => ({}))) as {
      creditsGranted?: number;
      error?: string;
    };
    if (!response.ok || !result.creditsGranted) {
      throw new Error(result.error || "Store verification failed.");
    }
    window.localStorage.removeItem(pendingKey);
    return result.creditsGranted;
  };

  useEffect(() => {
    let active = true;
    void NativePurchases.isBillingSupported()
      .then(({ isBillingSupported }) => {
        if (!isBillingSupported) throw new Error("Store billing is unavailable.");
        return NativePurchases.getProducts({
          productIdentifiers: MOBILE_STORE_PRODUCTS.map((item) => item.productId),
          productType: PURCHASE_TYPE.INAPP,
        });
      })
      .then(({ products: storeProducts }) => {
        if (active) setProducts(storeProducts);
      })
      .catch((err) => {
        console.error("[store billing] product load failed:", err);
        if (active) setError("ไม่สามารถโหลดแพ็กเกจจาก Store ได้");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(pendingKey);
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as {
        platform: "ios" | "android";
        productId: string;
        transactionId: string;
      };
      void verifyTransaction(pending)
        .then((credits) => {
          setSuccess(`กู้คืนและเพิ่ม ${credits} เครดิตเรียบร้อยแล้ว`);
          router.refresh();
        })
        .catch(() => {
          // Keep the transaction locally. A later visit retries idempotently.
        });
    } catch {
      window.localStorage.removeItem(pendingKey);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const purchase = async (product: Product) => {
    const platform = getMobilePlatform();
    if (platform === "web") return;
    setBuying(product.identifier);
    setError(null);
    setSuccess(null);
    try {
      const transaction = await NativePurchases.purchaseProduct({
        productIdentifier: product.identifier,
        productType: PURCHASE_TYPE.INAPP,
        quantity: 1,
      });
      const pending = {
        platform,
        productId: product.identifier,
        transactionId: transaction.transactionId,
      };
      window.localStorage.setItem(pendingKey, JSON.stringify(pending));
      const creditsGranted = await verifyTransaction(pending);
      setSuccess(`เพิ่ม ${creditsGranted} เครดิตเรียบร้อยแล้ว`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!/cancel|canceled|cancelled/i.test(message)) {
        setError(
          /pending/i.test(message)
            ? "การชำระเงินกำลังรอดำเนินการ เครดิตจะเพิ่มเมื่อ Store ยืนยัน"
            : "ไม่สามารถยืนยันการซื้อได้ กรุณาลองอีกครั้ง"
        );
      }
    } finally {
      setBuying(null);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-semibold text-slate-900">
        เติมเครดิตผ่าน {getMobilePlatform() === "ios" ? "App Store" : "Google Play"}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        การซื้อดำเนินการและยืนยันโดย Store ของอุปกรณ์
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">กำลังโหลดแพ็กเกจ…</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {products.map((product) => (
            <button
              key={product.identifier}
              type="button"
              disabled={buying !== null}
              onClick={() => void purchase(product)}
              className="rounded-lg border border-slate-200 p-4 text-left transition hover:border-blue-400 disabled:opacity-60"
            >
              <span className="block text-sm font-semibold text-slate-900">
                {product.title}
              </span>
              <span className="mt-1 block text-sm text-blue-700">
                {product.priceString}
              </span>
              {buying === product.identifier && (
                <span className="mt-2 block text-xs text-slate-500">
                  กำลังเปิด Store…
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {!loading && products.length === 0 && !error && (
        <p className="mt-4 text-sm text-amber-700">
          ยังไม่มีแพ็กเกจที่พร้อมจำหน่ายใน Store
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {success && <p className="mt-4 text-sm text-green-700">{success}</p>}
      <Button
        type="button"
        variant="outline"
        className="mt-4"
        onClick={() => router.refresh()}
      >
        รีเฟรชยอดเครดิต
      </Button>
    </Card>
  );
}
