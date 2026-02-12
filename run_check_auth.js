const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const conn = process.argv[2];
  if (!conn) {
    console.error('Usage: node run_check_auth.js <connectionString>');
    process.exit(2);
  }

  let sql = fs.readFileSync('check_auth_users.sql', 'utf8');
  // Remove triple-backtick fences if present
  sql = sql.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''));
  // Normalize and split into statements
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  const client = new Client({ connectionString: conn });
  await client.connect();

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      const res = await client.query(stmt);
      console.log('\n-- Statement ' + (i+1) + ' --');
      if (res.command === 'SELECT') {
        console.log(JSON.stringify(res.rows, null, 2));
      } else {
        console.log(res.command, res.rowCount);
      }
    } catch (err) {
      console.error('\n--- Error executing statement ' + (i+1) + ' ---');
      console.error(err.message);
    }
  }

  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
