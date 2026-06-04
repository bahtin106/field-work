// src/FeedbackForm.jsx
import { useState } from 'react';
import { useTranslation } from '../../src/i18n/useTranslation';
import { logEvent } from './telemetry';
export default function FeedbackForm({ onClose, onSubmit }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const canSend = text.trim().length >= 10 && !sending;
  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const ok = await onSubmit?.({ text, contact });
      logEvent('feedback_submitted', { ok });
      setDone(true);
      setText('');
      setContact('');
    } catch (e) {
      logEvent('feedback_submit_failed', { message: String(e?.message || e) });
      alert(t('feedback_send_failed_alert'));
    } finally {
      setSending(false);
    }
  };
  if (done) {
    return (
      <div style={{ padding: 16, maxWidth: 560 }}>
        <h3>{t('feedback_thanks_title')}</h3>
        <p>{t('feedback_thanks_body')}</p>
        <button onClick={onClose} style={{ marginTop: 12 }}>
          {t('feedback_close')}
        </button>
      </div>
    );
  }
  return (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <h3>{t('feedback_form_title')}</h3>
      <p style={{ marginTop: 4, color: '#666' }}>
        {t('feedback_form_hint')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <textarea
          placeholder={t('feedback_text_placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #ddd' }}
        />
        <input
          placeholder={t('feedback_contact_placeholder')}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #ddd' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} disabled={sending}>
            {t('feedback_cancel')}
          </button>
          <button onClick={handleSend} disabled={!canSend}>
            {sending ? t('feedback_sending') : t('feedback_send')}
          </button>
        </div>
      </div>
    </div>
  );
}
