export const MOBILE_STORE_PRODUCTS = [
  { productId: "com.rclipper.credits.50", credits: 50, priceBaht: 50 },
  { productId: "com.rclipper.credits.100", credits: 100, priceBaht: 100 },
  { productId: "com.rclipper.credits.200", credits: 200, priceBaht: 200 },
  { productId: "com.rclipper.credits.500", credits: 500, priceBaht: 500 },
  { productId: "com.rclipper.credits.1000", credits: 1000, priceBaht: 1000 },
] as const;

export function creditsForStoreProduct(productId: string): number | null {
  return (
    MOBILE_STORE_PRODUCTS.find((product) => product.productId === productId)
      ?.credits ?? null
  );
}
