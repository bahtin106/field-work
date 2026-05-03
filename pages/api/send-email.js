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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { type, email, firstName, lastName, resetLink } = req.body;

    if (!type || !email) {
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
    console.error('[/api/send-email] Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to send email' });
  }
}
