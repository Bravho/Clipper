/**
 * Migration 046 must match the config and use only columns that exist on
 * management_products (price_credits / full_price_credits / is_active —
 * see migrations 019 and 037). It must never delete rows or touch purchases.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { MANAGEMENT_PRODUCTS, managementPriceCredits } from "@/config/management";

const sql = readFileSync(
  join(__dirname, "../../src/db/migrations/046_new_package_prices.sql"),
  "utf8"
);
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 046_new_package_prices", () => {
  it("uses only existing columns", () => {
    expect(body).not.toMatch(/on_sale|launch_price_credits/);
  });

  it("is non-destructive and touches only the catalogue", () => {
    expect(body).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i);
    const tables = Array.from(body.matchAll(/UPDATE\s+(\w+)/gi)).map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["management_products"]));
  });

  it("sets the same price as the config for every on-sale package", () => {
    for (const p of MANAGEMENT_PRODUCTS.filter((x) => x.onSale)) {
      const price = managementPriceCredits(p);
      const re = new RegExp(
        `price_credits = ${price}, full_price_credits = ${price}[^;]*WHERE code = '${p.code}'`
      );
      expect(body).toMatch(re);
    }
  });

  it("deactivates exactly the off-sale 3- and 6-month packages", () => {
    const offSale = MANAGEMENT_PRODUCTS.filter(
      (p) => !p.onSale && p.videoMonths != null
    ).map((p) => p.code);
    expect(offSale.sort()).toEqual(
      [
        "management_bundle_3_months",
        "management_bundle_6_months",
        "management_starter_3_months",
        "management_starter_6_months",
      ].sort()
    );
    for (const code of offSale) expect(body).toContain(`'${code}'`);
    expect(body).toMatch(/SET is_active = FALSE/);
  });
});
