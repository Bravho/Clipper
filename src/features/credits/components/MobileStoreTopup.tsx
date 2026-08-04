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

interface Props {
  currentBalance?: number;
  unlockRequestId?: string;
  returnTo?: string;
  unlockPrice?: number;
  minimumTopupCredits?: number;
}

export function MobileStoreTopup({
  currentBalance = 0,
  unlockRequestId,
  returnTo,
  unlockPrice = 0,
  minimumTopupCredits,
}: Props) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const pendingKey = "rclipper-pending-store-purchase";
  const safeReturnTo =
    returnTo?.startsWith("/dashboard/requests/") ? returnTo : undefined;

  const completeUnlock = async () => {
    if (!unlockRequestId) return;
    const response = await fetch(`/api/requests/${unlockRequestId}/unlock-download`, {
      method: "POST",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "ไม่สามารถปลดล็อกวิดีโอได้");
    }
    router.push(safeReturnTo ?? `/dashboard/requests/${unlockRequestId}`);
    router.refresh();
  };

  const verifyTransaction = async (purchase: {
    platform: "ios" | "android";
    productId: string;
    transactionId: string;
  }): Promise<{ creditsGranted: number; alreadyProcessed: boolean }> => {
    const response = await fetch("/api/mobile/purchases/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(purchase),
    });
    const result = (await response.json().catch(() => ({}))) as {
      creditsGranted?: number;
      alreadyProcessed?: boolean;
      error?: string;
    };
    if (!response.ok || !result.creditsGranted) {
      throw new Error(result.error || "Store verification failed.");
    }
    if (purchase.platform === "ios") {
      await NativePurchases.acknowledgePurchase({
        purchaseToken: purchase.transactionId,
      });
    }
    window.localStorage.removeItem(pendingKey);
    return {
      creditsGranted: result.creditsGranted,
      alreadyProcessed: result.alreadyProcessed === true,
    };
  };

  useEffect(() => {
    let active = true;
    const requestedProductIds = MOBILE_STORE_PRODUCTS.map(
      (item) => item.productId
    );
    console.info("[Clipper][iap] requesting store products", {
      platform: getMobilePlatform(),
      productType: PURCHASE_TYPE.INAPP,
      requestedProductIds,
    });
    void NativePurchases.isBillingSupported()
      .then(({ isBillingSupported }) => {
        console.info("[Clipper][iap] billing support", {
          isBillingSupported,
        });
        if (!isBillingSupported) throw new Error("Store billing is unavailable.");
        return NativePurchases.getProducts({
          productIdentifiers: requestedProductIds,
          productType: PURCHASE_TYPE.INAPP,
        });
      })
      .then(({ products: storeProducts }) => {
        const returnedProductIds = storeProducts.map(
          (product) => product.identifier
        );
        const missingProductIds = requestedProductIds.filter(
          (productId) => !returnedProductIds.includes(productId)
        );
        console.info("[Clipper][iap] store product response", {
          requestedCount: requestedProductIds.length,
          returnedCount: storeProducts.length,
          returnedProductIds,
          missingProductIds,
        });
        if (missingProductIds.length > 0) {
          console.warn("[Clipper][iap] store catalog is missing products", {
            missingProductIds,
          });
        }
        if (active) {
          setProducts(storeProducts);
          const creditsNeeded =
            minimumTopupCredits ?? Math.max(1, unlockPrice - currentBalance);
          const preferred =
            MOBILE_STORE_PRODUCTS.find(
              (configured) =>
                configured.credits >= creditsNeeded &&
                storeProducts.some(
                  (product) => product.identifier === configured.productId
                )
            ) ??
            MOBILE_STORE_PRODUCTS.find((configured) =>
              storeProducts.some(
                (product) => product.identifier === configured.productId
              )
            );
          setSelectedProductId(preferred?.productId ?? null);
        }
      })
      .catch((err) => {
        console.error("[Clipper][iap] product load failed", {
          name: err instanceof Error ? err.name : "UnknownError",
          message: err instanceof Error ? err.message : String(err),
        });
        if (active) setError("ไม่สามารถโหลดแพ็กเกจจาก Store ได้");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentBalance, minimumTopupCredits, unlockPrice]);

  useEffect(() => {
    if (getMobilePlatform() !== "ios") return;
    void NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.INAPP,
      onlyCurrentEntitlements: true,
    })
      .then(async ({ purchases: transactions }) => {
        console.info("[Clipper][iap] unfinished store transactions", {
          count: transactions.length,
          productIds: transactions.map((item) => item.productIdentifier),
        });
        for (const transaction of transactions) {
          const pending = {
            platform: "ios" as const,
            productId: transaction.productIdentifier,
            transactionId: transaction.transactionId,
          };
          window.localStorage.setItem(pendingKey, JSON.stringify(pending));
          try {
            const { creditsGranted } = await verifyTransaction(pending);
            setSuccess(`กู้คืนรายการซื้อ ${creditsGranted} เครดิตเรียบร้อยแล้ว`);
            router.refresh();
          } catch (err) {
            console.error("[Clipper][iap] unfinished transaction recovery failed", {
              productId: transaction.productIdentifier,
              transactionId: transaction.transactionId,
              message: err instanceof Error ? err.message : String(err),
            });
            // StoreKit retains it for an idempotent retry on the next visit.
          }
        }
      })
      .catch((err) => {
        console.error("[Clipper][iap] unfinished transaction query failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        .then(({ creditsGranted }) => {
          setSuccess(
            `กู้คืนรายการซื้อ ${creditsGranted} เครดิตเรียบร้อยแล้ว กรุณากดยืนยันการใช้เครดิตเพื่อปลดล็อกวิดีโอ`
          );
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
        isConsumable: false,
        autoAcknowledgePurchases: false,
      });
      const storeTransactionId =
        platform === "android"
          ? transaction.purchaseToken
          : transaction.transactionId;
      if (!storeTransactionId) {
        throw new Error("Store did not return a verifiable transaction token.");
      }
      const pending = {
        platform,
        productId: product.identifier,
        transactionId: storeTransactionId,
      };
      window.localStorage.setItem(pendingKey, JSON.stringify(pending));
      const { creditsGranted, alreadyProcessed } = await verifyTransaction(pending);
      setSuccess(`เพิ่ม ${creditsGranted} เครดิตเรียบร้อยแล้ว`);
      // Only a newly verified Store transaction may continue directly to unlock.
      // A replayed/previous transaction can restore the credit balance, but must
      // never silently remove a request's payment lock.
      if (unlockRequestId && !alreadyProcessed) await completeUnlock();
      else router.refresh();
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
      {getMobilePlatform() === "ios" && (
        <p className="mt-1 text-xs text-slate-500">
          เมื่อเลือกแพ็กเกจ ระบบต้องแสดงหน้าต่างยืนยันการซื้อของ Apple ก่อนดำเนินการ
        </p>
      )}
      {unlockRequestId && (
        <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          ต้องใช้ {unlockPrice} เครดิตเพื่อปลดล็อกวิดีโอนี้ · ปัจจุบันมี {currentBalance} เครดิต
        </p>
      )}
      {unlockRequestId && currentBalance >= unlockPrice && (
        <Button className="mt-4 w-full" onClick={() => void completeUnlock().catch((err) => setError(err.message))}>
          ใช้ {unlockPrice} เครดิตและปลดล็อกวิดีโอ
        </Button>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">กำลังโหลดแพ็กเกจ…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MOBILE_STORE_PRODUCTS.map((configured) => {
            const product = products.find(
              (item) => item.identifier === configured.productId
            );
            const selected = selectedProductId === configured.productId;
            return (
            <button
              key={configured.productId}
              type="button"
              disabled={buying !== null || !product}
              onClick={() => setSelectedProductId(configured.productId)}
              className={`rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                  : "border-slate-200 hover:border-blue-400"
              }`}
            >
              <span className="block text-sm font-semibold text-slate-900">
                {configured.credits} เครดิต
              </span>
              <span className="mt-1 block text-sm text-blue-700">
                {product?.priceString ?? `฿${configured.priceBaht}`}
              </span>
              {!product && (
                <span className="mt-1 block text-[11px] text-amber-700">
                  ยังไม่พร้อมจำหน่ายใน Store
                </span>
              )}
            </button>
            );
          })}
          </div>
          <Button
            type="button"
            className="mt-4 w-full"
            loading={buying !== null}
            disabled={!selectedProductId}
            onClick={() => {
              const selected = products.find(
                (product) => product.identifier === selectedProductId
              );
              if (selected) void purchase(selected);
            }}
          >
            {getMobilePlatform() === "ios"
              ? "ชำระด้วย Apple Account"
              : "ชำระผ่าน Google Play"}
          </Button>
        </>
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
