/**
 * Example worker to process finance_currency_recalc_jobs jobs.
 *
 * Usage:
 *  - set environment variable PG_CONN (postgres connection string)
 *  - node currency_recalc_worker.js
 *
 * This script is a runnable example for a background worker that:
 *  - listens to NOTIFY channel 'currency_recalc_queue'
 *  - picks pending jobs and processes them in batches, updating price and fuel_cost
 *  - updates job row progress and clears companies.recalc_in_progress when done
 *
 * Note: install dependency `pg` before running: `npm install pg`
 */

const { Client } = require('pg');

const PG_CONN = process.env.PG_CONN || process.env.DATABASE_URL;
if (!PG_CONN) {
  console.error('Please set PG_CONN or DATABASE_URL env var');
  process.exit(1);
}

const client = new Client({ connectionString: PG_CONN });

async function processJob(job) {
  const batchSize = job.batch_size || 1000;
  const companyId = job.company_id;
  const newCurrency = job.new_currency;
  const rate = job.rate; // may be null

  console.log(
    `Processing job ${job.id} for company ${companyId} newCurrency=${newCurrency} rate=${rate}`,
  );

  try {
    // compute total count
    const totalRes = await client.query(
      'SELECT count(*)::bigint as c FROM orders WHERE company_id = $1',
      [companyId],
    );
    const total = Number(totalRes.rows[0].c || 0);
    await client.query(
      'UPDATE finance_currency_recalc_jobs SET status = $1, total_count = $2, updated_at = now() WHERE id = $3',
      ['running', total, job.id],
    );

    let processed = 0;
    while (true) {
      // select a batch of ids for update using SKIP LOCKED to avoid conflicts across workers
      const selectSql = `
        WITH cte AS (
          SELECT id, price, fuel_cost
          FROM orders
          WHERE company_id = $1
          ORDER BY id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE orders o
        SET
          price = CASE WHEN cte.price IS NULL OR $4 IS NULL THEN cte.price ELSE round((cte.price::numeric * $4)::numeric, 2) END,
          fuel_cost = CASE WHEN cte.fuel_cost IS NULL OR $4 IS NULL THEN cte.fuel_cost ELSE round((cte.fuel_cost::numeric * $4)::numeric, 2) END,
          currency = $3
        FROM cte
        WHERE o.id = cte.id
        RETURNING o.id;
      `;

      const res = await client.query(selectSql, [companyId, batchSize, newCurrency, rate]);
      const updated = res.rowCount || 0;
      if (updated === 0) break;
      processed += updated;
      await client.query(
        'UPDATE finance_currency_recalc_jobs SET processed_count = processed_count + $1, updated_at = now() WHERE id = $2',
        [updated, job.id],
      );
      console.log(
        `Job ${job.id}: processed batch ${updated}, total processed ${processed}/${total}`,
      );
    }

    // done
    await client.query(
      'UPDATE finance_currency_recalc_jobs SET status = $1, updated_at = now() WHERE id = $2',
      ['done', job.id],
    );
    await client.query(
      'UPDATE companies SET recalc_in_progress = false, recalc_job_id = NULL WHERE id = $1',
      [companyId],
    );
    console.log(`Job ${job.id} done`);
  } catch (e) {
    console.error('Job failed', e);
    await client.query(
      'UPDATE finance_currency_recalc_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3',
      ['failed', e.message || String(e), job.id],
    );
    await client.query(
      'UPDATE companies SET recalc_in_progress = false, recalc_job_id = NULL WHERE id = $1',
      [companyId],
    );
  }
}

async function fetchAndProcessPending() {
  // find one pending job and try to lock it
  const res = await client.query(
    "SELECT * FROM finance_currency_recalc_jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
  );
  if (res.rowCount === 0) return;
  const job = res.rows[0];
  await processJob(job);
}

async function main() {
  await client.connect();
  console.log('Connected to DB, listening for currency_recalc_queue...');

  client.on('notification', async (msg) => {
    if (msg.channel === 'currency_recalc_queue') {
      const jobId = msg.payload;
      console.log('PG notify received job', jobId);
      // try to fetch job by id
      const jobRes = await client.query(
        'SELECT * FROM finance_currency_recalc_jobs WHERE id = $1 FOR UPDATE SKIP LOCKED',
        [jobId],
      );
      if (jobRes.rowCount === 0) return;
      const job = jobRes.rows[0];
      await processJob(job);
    }
  });

  await client.query('LISTEN currency_recalc_queue');

  // also poll periodically in case notify was missed
  setInterval(async () => {
    try {
      await fetchAndProcessPending();
    } catch (e) {
      console.error('Error polling jobs', e);
    }
  }, 5000);
}

main().catch((e) => {
  console.error('Worker failed', e);
  process.exit(1);
});
