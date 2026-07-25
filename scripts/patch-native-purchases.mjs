import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const swiftPath = path.join(
  root,
  "node_modules/@capgo/native-purchases/ios/Plugin/NativePurchasesPlugin.swift"
);
const objcPath = path.join(
  root,
  "node_modules/@capgo/native-purchases/ios/Plugin/NativePurchasesPlugin.m"
);

async function replaceOnce(file, before, after) {
  const source = await readFile(file, "utf8");
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Cannot patch ${path.relative(root, file)}: expected source changed.`);
  }
  await writeFile(file, source.replace(before, after));
}

await replaceOnce(
  swiftPath,
  `public class NativePurchasesPlugin: CAPPlugin {

    private let PLUGIN_VERSION = "0.0.25"`,
  `public class NativePurchasesPlugin: CAPPlugin {

    private let PLUGIN_VERSION = "0.0.25"
    private var transactionUpdatesTask: Task<Void, Never>?

    public override func load() {
        if #available(iOS 15.0, *) {
            // StoreKit requires a long-lived listener before starting a purchase.
            // Verified transactions deliberately remain unfinished until RClipper's
            // server has granted the credits and JavaScript calls finishTransaction.
            transactionUpdatesTask = Task { [weak self] in
                for await result in Transaction.updates {
                    guard !Task.isCancelled else { return }
                    if case let .verified(transaction) = result {
                        self?.notifyListeners("transactionUpdated", data: [
                            "transactionId": String(transaction.id),
                            "productIdentifier": transaction.productID
                        ], retainUntilConsumed: true)
                    }
                }
            }
        }
    }

    deinit {
        transactionUpdatesTask?.cancel()
    }`
);

await replaceOnce(
  swiftPath,
  `                    case let .success(.verified(transaction)):
                        // Successful purhcase
                        await transaction.finish()
                        call.resolve(["transactionId": transaction.id])`,
  `                    case let .success(.verified(transaction)):
                        // Server verification and credit granting must complete before
                        // this consumable transaction is marked finished.
                        call.resolve([
                            "transactionId": String(transaction.id),
                            "productIdentifier": transaction.productID
                        ])`
);

await replaceOnce(
  swiftPath,
  `    @objc func restorePurchases(_ call: CAPPluginCall) {`,
  `    @objc func getUnfinishedTransactions(_ call: CAPPluginCall) {
        if #available(iOS 15.0, *) {
            Task {
                var transactions: [[String: String]] = []
                for await result in Transaction.unfinished {
                    if case let .verified(transaction) = result {
                        transactions.append([
                            "transactionId": String(transaction.id),
                            "productIdentifier": transaction.productID
                        ])
                    }
                }
                call.resolve(["transactions": transactions])
            }
        } else {
            call.resolve(["transactions": []])
        }
    }

    @objc func finishTransaction(_ call: CAPPluginCall) {
        if #available(iOS 15.0, *) {
            guard let transactionId = call.getString("transactionId"),
                  let expectedId = UInt64(transactionId) else {
                call.reject("A valid transactionId is required")
                return
            }
            Task {
                for await result in Transaction.unfinished {
                    if case let .verified(transaction) = result,
                       transaction.id == expectedId {
                        await transaction.finish()
                        call.resolve()
                        return
                    }
                }
                // Finishing is idempotent; an already-finished transaction is success.
                call.resolve()
            }
        } else {
            call.reject("Not implemented under iOS 15")
        }
    }

    @objc func restorePurchases(_ call: CAPPluginCall) {`
);

await replaceOnce(
  objcPath,
  `        CAP_PLUGIN_METHOD(purchaseProduct, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(restorePurchases, CAPPluginReturnPromise);`,
  `        CAP_PLUGIN_METHOD(purchaseProduct, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(getUnfinishedTransactions, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(finishTransaction, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(restorePurchases, CAPPluginReturnPromise);`
);

console.log("Applied RClipper StoreKit transaction-safety patch.");
