import { sendInviteEmail, sendPasswordResetEmail } from '@/lib/mailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
