import { sendInviteEmail, sendPasswordResetEmail } from '@/lib/mailer';
import crypto from 'crypto';

function timingSafeStringEqual(left, right) {
  const leftBuf = Buffer.from(String(left || ''));
  const rightBuf = Buffer.from(String(right || ''));
  return leftBuf.length === rightBuf.length && crypto.timingSafeEqual(leftBuf, rightBuf);
}

function isAuthorized(req) {
  const expected = String(process.env.EMAIL_SERVER_API_TOKEN || '').trim();
  if (!expected) return false;
  const supplied = String(req.headers['x-email-server-token'] || req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  return supplied && timingSafeStringEqual(supplied, expected);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { type, firstName, lastName, resetLink } = req.body;
    const email = normalizeEmail(req.body?.email);

    if (!type || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let result;

    if (type === 'invite') {
      result = await sendInviteEmail(email, firstName, lastName, resetLink);
    } else if (type === 'password-reset') {
      result = await sendPasswordResetEmail(email, firstName, lastName, resetLink);
    } else {
      return res.status(400).json({ error: 'Invalid email type' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[/api/send-email] Error:', error?.message || error);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
