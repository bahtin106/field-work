const MONEY_EPSILON = 0.005;

export function normalizePaymentMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

export function getOrderPaymentSummary(payments, totalAmount) {
  const total = Math.max(0, normalizePaymentMoney(totalAmount));
  const paid = Math.max(
    0,
    normalizePaymentMoney(
      (Array.isArray(payments) ? payments : []).reduce(
        (sum, payment) => sum + Math.max(0, normalizePaymentMoney(payment?.amount)),
        0,
      ),
    ),
  );
  const remaining = Math.max(0, normalizePaymentMoney(total - paid));
  const overpayment = Math.max(0, normalizePaymentMoney(paid - total));
  const status =
    paid <= MONEY_EPSILON
      ? 'unpaid'
      : total <= MONEY_EPSILON || paid + MONEY_EPSILON >= total
        ? 'paid'
        : 'partial';

  return {
    total,
    paid,
    remaining,
    overpayment,
    status,
  };
}
