import { readFileSync } from "fs";
import { TransactionType } from "@/domain/enums/TransactionType";

it("047 preserves every historical and current transaction type", () => {
  const latest = readFileSync("src/db/migrations/047_video_download_unlock.sql", "utf8");
  const historical = readFileSync("src/db/migrations/039_voice_make_top_up.sql", "utf8");
  const list = historical.split("type IN (")[1].split(")")[0];
  for (const value of [...Object.values(TransactionType), ...Array.from(list.matchAll(/'([^']+)'/g), (match) => match[1])]) {
    expect(latest).toContain(`'${value}'`);
  }
});
