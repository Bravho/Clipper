export const MOBILE_STORE_PRODUCTS = [
  { productId: "com.rclipper.credits.49", credits: 49 },
  { productId: "com.rclipper.credits.98", credits: 98 },
  { productId: "com.rclipper.credits.296", credits: 296 },
  { productId: "com.rclipper.credits.490", credits: 490 },
  { productId: "com.rclipper.credits.980", credits: 980 },
] as const;

export function creditsForStoreProduct(productId: string): number | null {
  return (
    MOBILE_STORE_PRODUCTS.find((product) => product.productId === productId)
      ?.credits ?? null
  );
}

