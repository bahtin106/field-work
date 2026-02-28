const crypto = require('crypto');
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  aud: 'authenticated',
  exp: now + 3600,
  iat: now,
  iss: 'supabase',
  sub: '8b29d952-70fa-476b-baa5-140e1ae669e9',
  email: 'admin@example.com',
  phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  role: 'authenticated',
  aal: 'aal1',
  amr: [{ method: 'password', timestamp: now }],
  session_id: '11111111-1111-1111-1111-111111111111',
  is_anonymous: false
})).toString('base64url');
const secret = '012sxzYEbMrlRFJEpx37nOD1nKg6qx0qEFwkeOutYjhW0N8ekp1U5VkExP6ilEwB';
const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
process.stdout.write(header + '.' + payload + '.' + sig);
