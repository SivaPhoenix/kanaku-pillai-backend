import { ASSET_ACCOUNT_TYPES } from "../constants/enums.js";

// Balance rules (design spec §9 "Derived values"). `flows` comes from transactionRepository.aggregateAccountFlows.

const EMPTY = { income: 0, expense: 0, transferIn: 0, transferOut: 0 };

function netFlow(flow) {
  return flow.income - flow.expense + flow.transferIn - flow.transferOut;
}

// Returns Map<accountId, { balanceMinor } | { owedMinor } | { balanceMinor: null }> for every account given.
export function computeBalances(accounts, flows) {
  const flowOf = (id) => flows.get(String(id)) ?? EMPTY;

  // A debit card's income and expense count towards its linked bank account.
  const rolledUp = new Map();
  for (const account of accounts) {
    if (account.type === "debit_card" && account.linkedAccountId) {
      const key = String(account.linkedAccountId);
      rolledUp.set(key, (rolledUp.get(key) ?? 0) + netFlow(flowOf(account._id)));
    }
  }

  const result = new Map();
  for (const account of accounts) {
    const id = String(account._id);
    if (account.type === "debit_card") {
      result.set(id, { balanceMinor: null });
    } else if (account.type === "credit_card") {
      // Owed goes up with spending and down with refunds and bill payments (transfers in).
      result.set(id, { owedMinor: account.openingBalanceMinor - netFlow(flowOf(id)) });
    } else {
      result.set(id, {
        balanceMinor: account.openingBalanceMinor + netFlow(flowOf(id)) + (rolledUp.get(id) ?? 0),
      });
    }
  }
  return result;
}

// Net worth = assets (bank, cash, investment) − credit-card amounts owed. Archived accounts still count: the money is real.
export function summarize(accounts, balances) {
  let assetsMinor = 0;
  let liabilitiesMinor = 0;
  for (const account of accounts) {
    const balance = balances.get(String(account._id));
    if (ASSET_ACCOUNT_TYPES.includes(account.type)) assetsMinor += balance.balanceMinor;
    else if (account.type === "credit_card") liabilitiesMinor += balance.owedMinor;
  }
  return { netWorthMinor: assetsMinor - liabilitiesMinor, assetsMinor, liabilitiesMinor };
}
