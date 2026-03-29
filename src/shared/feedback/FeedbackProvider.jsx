// src/shared/feedback/FeedbackProvider.jsx
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useToast } from '../../../components/ui/ToastProvider';
import { logClientError } from '../../../lib/errorLogsClient';

const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const toast = useToast();
  const [banner, setBanner] = useState(null);

  const clearBanner = useCallback(() => setBanner(null), []);
  const showBanner = useCallback((message, opts = {}) => {
    if (!message) return;
    const resolvedMessage =
      typeof message === 'string'
        ? message
        : message.message || message.text || '';
    const resolvedSeverity =
      typeof message === 'string'
        ? opts.severity || 'error'
        : message.severity || opts.severity || 'error';

    if (
      (resolvedSeverity === 'error' || resolvedSeverity === 'warning') &&
      String(resolvedMessage || '').trim()
    ) {
      logClientError(String(resolvedMessage), {
        source: 'ui_banner',
        severity: resolvedSeverity,
      });
    }

    if (typeof message === 'string') {
      setBanner({ message: resolvedMessage, severity: resolvedSeverity, action: opts.action || null });
      return;
    }
    setBanner({
      message: resolvedMessage,
      severity: resolvedSeverity,
      action: message.action || opts.action || null,
      code: message.code || null,
    });
  }, []);

  const showToast = useCallback(
    (message, severity = 'info', options) => {
      if (!message) return;
      const type = severity === 'warning' ? 'info' : severity;
      toast.show(String(message), type, options);
    },
    [toast],
  );

  const api = useMemo(
    () => ({
      banner,
      showBanner,
      clearBanner,
      showToast,
      showSuccessToast: (msg, options) => showToast(msg, 'success', options),
      showInfoToast: (msg, options) => showToast(msg, 'info', options),
      showErrorToast: (msg, options) => showToast(msg, 'error', options),
    }),
    [banner, showBanner, clearBanner, showToast],
  );

  return <FeedbackContext.Provider value={api}>{children}</FeedbackContext.Provider>;
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider');
  return ctx;
}
