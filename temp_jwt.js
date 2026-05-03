const crypto = require('crypto');

const secret = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET;

if (!secret) {
  console.error('Set SUPABASE_JWT_SECRET or JWT_SECRET to generate a local test JWT.');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(
  JSON.stringify({
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    iss: 'supabase',
    sub: process.env.JWT_SUB || '00000000-0000-4000-8000-000000000000',
    email: process.env.JWT_EMAIL || 'admin@example.com',
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    session_id: '11111111-1111-1111-1111-111111111111',
    is_anonymous: false,
  }),
).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
process.stdout.write(`${header}.${payload}.${sig}`);
