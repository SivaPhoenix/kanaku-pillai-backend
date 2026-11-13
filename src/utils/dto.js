// Plain response shapes. Nothing leaves the API with _id, __v, userId, deletedAt or internal fields.

const id = (value) => (value ? String(value) : null);

export function toTransactionDto(tx) {
  return {
    id: String(tx._id),
    type: tx.type,
    amountMinor: tx.amountMinor,
    currencyCode: tx.currencyCode,
    categoryId: id(tx.categoryId),
    accountId: String(tx.accountId),
    toAccountId: id(tx.toAccountId),
    occurredAt: tx.occurredAt.toISOString(),
    tzid: tx.tzid,
    localDate: tx.localDate,
    note: tx.note ?? null,
    recurrenceId: id(tx.recurrenceId),
    installmentPlanId: id(tx.installmentPlanId),
    installmentIndex: tx.installmentIndex ?? null,
    installmentCount: tx.installmentCount ?? null,
    createdOn: tx.createdOn,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
}
