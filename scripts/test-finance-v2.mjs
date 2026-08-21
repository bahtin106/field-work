import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function calculate({
  mode,
  base = 0,
  income = 0,
  discount = 0,
  fixed = 0,
  percent = 0,
  percentBase = 'customer_total',
  minimum = null,
  maximum = null,
  bonus = 0,
  deduction = 0,
  directCost = 0,
  reimbursement = 0,
  moneyHolder = 'company',
  workerPaid = 0,
  companyReceived = 0,
}) {
  const customerTotal = base + income - discount;
  const baseAmount =
    percentBase === 'base_price'
      ? base
      : percentBase === 'income_total'
        ? income
        : customerTotal;
  let workerBase = 0;
  if (mode === 'worker_percent') workerBase = baseAmount * percent / 100;
  if (mode === 'company_percent') workerBase = customerTotal - baseAmount * percent / 100;
  if (mode === 'worker_fixed') workerBase = fixed;
  if (mode === 'company_fixed') workerBase = customerTotal - fixed;
  if (mode === 'worker_fixed_plus_percent') {
    workerBase = fixed + baseAmount * percent / 100;
  }
  workerBase = Math.max(workerBase, 0);
  if (minimum !== null) workerBase = Math.max(workerBase, minimum);
  if (maximum !== null) workerBase = Math.min(workerBase, maximum);

  const workerCompensation = Math.max(workerBase + bonus - deduction, 0);
  const companyCost = directCost + reimbursement;
  const workerPayable = workerCompensation + reimbursement;
  const companyMargin = customerTotal - workerCompensation - companyCost;
  let signedSettlement =
    moneyHolder === 'executor' ? workerPayable - customerTotal : workerPayable;
  signedSettlement = signedSettlement - workerPaid + companyReceived;

  return {
    customerTotal,
    workerCompensation,
    companyCost,
    workerPayable,
    companyMargin,
    settlementDirection:
      signedSettlement > 0
        ? 'company_to_executor'
        : signedSettlement < 0
          ? 'executor_to_company'
          : 'settled',
    settlementAmount: Math.abs(signedSettlement),
  };
}

assert.deepEqual(
  calculate({ mode: 'worker_percent', base: 10000, percent: 60 }),
  {
    customerTotal: 10000,
    workerCompensation: 6000,
    companyCost: 0,
    workerPayable: 6000,
    companyMargin: 4000,
    settlementDirection: 'company_to_executor',
    settlementAmount: 6000,
  },
);

assert.equal(
  calculate({
    mode: 'company_percent',
    base: 10000,
    income: 2000,
    discount: 1000,
    percent: 20,
  }).workerCompensation,
  8800,
);

const reimbursedCost = calculate({
  mode: 'worker_percent',
  base: 10000,
  percent: 60,
  directCost: 1000,
  reimbursement: 500,
});
assert.equal(reimbursedCost.workerPayable, 6500);
assert.equal(reimbursedCost.companyCost, 1500);
assert.equal(reimbursedCost.companyMargin, 2500);

const workerCollectedCash = calculate({
  mode: 'worker_percent',
  base: 10000,
  percent: 60,
  moneyHolder: 'executor',
  companyReceived: 1000,
});
assert.equal(workerCollectedCash.settlementDirection, 'executor_to_company');
assert.equal(workerCollectedCash.settlementAmount, 3000);

assert.equal(
  calculate({
    mode: 'worker_fixed_plus_percent',
    base: 10000,
    fixed: 1000,
    percent: 10,
    maximum: 1800,
  }).workerCompensation,
  1800,
);

const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260729010000_finance_v2_semantic_engine.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');
assert.match(migration, /company_finance_scheme_versions/);
assert.match(migration, /order_finance_snapshots/);
assert.match(migration, /worker_compensation_total/);
assert.match(migration, /company_margin_total/);
assert.match(migration, /settlement_direction/);
assert.match(migration, /Pass 1: customer charges/);
assert.match(migration, /Pass 2: discounts/);
assert.match(migration, /Pass 3: costs, compensation adjustments/);

const trashSafeRecalculationMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260821020000_skip_trashed_orders_in_finance_recalculation.sql',
);
const trashSafeRecalculationMigration = fs.readFileSync(
  trashSafeRecalculationMigrationPath,
  'utf8',
);
assert.match(
  trashSafeRecalculationMigration,
  /upsert_company_finance_scheme_v2\(jsonb\)/,
);
assert.match(
  trashSafeRecalculationMigration,
  /archive_company_finance_scheme_v2\(uuid,boolean\)/,
);
assert.match(
  trashSafeRecalculationMigration,
  /set_company_finance_scheme_enabled_v2\(uuid,boolean,boolean\)/,
);
assert.match(trashSafeRecalculationMigration, /from public\.trash_entries trash_entry/);
assert.match(trashSafeRecalculationMigration, /trash_entry\.entity_id = o\.id/);

console.log('Finance V2 calculation scenarios passed.');
