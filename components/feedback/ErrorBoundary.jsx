// src/ErrorBoundary.jsx
import React from 'react';
import { t } from '../../src/i18n';
import { logError } from './telemetry';
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, detail: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, detail: error };
  }
  componentDidCatch(error, info) {
    logError(error, { where: 'ErrorBoundary', componentStack: info?.componentStack });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16 }}>
          <h2>{t('error_boundary_title')}</h2>
          <p>{t('error_boundary_message')}</p>
          <button onClick={() => location.reload()}>{t('error_boundary_reload')}</button>
        </div>
      );
    }
    return this.props.children;
  }
}
