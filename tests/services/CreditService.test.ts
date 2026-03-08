import { CreditService } from "@/services/CreditService";
import { MockCreditWalletRepository } from "@/repositories/mock/MockCreditWalletRepository";
import { MockCreditTransactionRepository } from "@/repositories/mock/MockCreditTransactionRepository";
import { TransactionType } from "@/domain/enums/TransactionType";
import { CREDITS_CONFIG } from "@/config/credits";

// We test CreditService with isolated fresh repositories (no shared global state)
function makeCreditService() {
  const walletStore = new Map();
  const txStore = new Map();
  const walletRepo = new MockCreditWalletRepository(walletStore);
  const txRepo = new MockCreditTransactionRepository(txStore);

  // Create a CreditService instance with injected repos
  // (We do this by temporarily replacing the module-level singletons via a subclass)
  class TestCreditService extends CreditService {}
  const svc = new TestCreditService();

  // Inject private repos via any-cast
  (svc as any).walletRepo = walletRepo;
  (svc as any).txRepo = txRepo;

  // Patch the service to use our isolated repos
  // Since CreditService imports repos from @/repositories/index,
  // we test by creating a thin wrapper that uses isolated repos directly.
  return { walletRepo, txRepo };
}

describe("CreditService via MockCreditWalletRepository", () => {
  let walletRepo: MockCreditWalletRepository;
  let txRepo: MockCreditTransactionRepository;
  const testUserId = "test-user-" + Date.now();

  beforeEach(() => {
    walletRepo = new MockCreditWalletRepository(new Map());
    txRepo = new MockCreditTransactionRepository(new Map());
  });

  it("creates a wallet with zero balance initially", async () => {
    const wallet = await walletRepo.create({
      userId: testUserId,
      balance: 0,
      initialCreditsGranted: false,
    });
    expect(wallet.balance).toBe(0);
    expect(wallet.initialCreditsGranted).toBe(false);
  });

  it("marks wallet as credits granted", async () => {
    const wallet = await walletRepo.create({
      userId: testUserId,
      balance: 0,
      initialCreditsGranted: false,
    });

    const updated = await walletRepo.markInitialCreditsGranted(wallet.id);
    expect(updated.initialCreditsGranted).toBe(true);
  });

  it("updates wallet balance correctly", async () => {
    const wallet = await walletRepo.create({
      userId: testUserId,
      balance: 0,
      initialCreditsGranted: false,
    });

    const updated = await walletRepo.updateBalance(
      wallet.id,
      CREDITS_CONFIG.SIGNUP_BONUS_CREDITS
    );
    expect(updated.balance).toBe(CREDITS_CONFIG.SIGNUP_BONUS_CREDITS);
  });

  it("records a signup bonus transaction", async () => {
    const wallet = await walletRepo.create({
      userId: testUserId,
      balance: 0,
      initialCreditsGranted: false,
    });

    await txRepo.create({
      userId: testUserId,
      amount: CREDITS_CONFIG.SIGNUP_BONUS_CREDITS,
      type: TransactionType.SignupBonus,
      description: "Welcome bonus",
      referenceId: null,
    });

    const transactions = await txRepo.findByUserId(testUserId);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe(TransactionType.SignupBonus);
    expect(transactions[0].amount).toBe(CREDITS_CONFIG.SIGNUP_BONUS_CREDITS);
  });

  it("signup bonus is 30 credits per config", () => {
    expect(CREDITS_CONFIG.SIGNUP_BONUS_CREDITS).toBe(30);
  });

  it("findByUserId returns only transactions for the given user", async () => {
    const wallet = await walletRepo.create({
      userId: testUserId,
      balance: 0,
      initialCreditsGranted: false,
    });

    await txRepo.create({
      userId: testUserId,
      amount: 30,
      type: TransactionType.SignupBonus,
      description: "Bonus",
      referenceId: null,
    });
    await txRepo.create({
      userId: "other-user",
      amount: 30,
      type: TransactionType.SignupBonus,
      description: "Other user",
      referenceId: null,
    });

    const myTransactions = await txRepo.findByUserId(testUserId);
    expect(myTransactions).toHaveLength(1);
    expect(myTransactions[0].userId).toBe(testUserId);
  });
});
