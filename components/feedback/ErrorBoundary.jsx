
// src/ErrorBoundary.jsx
import React from 'react';
import { logError } from './telemetry';
export default class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={hasError:false, detail:null}; }
  static getDerivedStateFromError(error){ return {hasError:true, detail:error}; }
  componentDidCatch(error, info){ logError(error,{where:'ErrorBoundary',componentStack:info?.componentStack}); }
  render(){
    if(this.state.hasError){
      return (<div style={{padding:16}}><h2>Что-то пошло не так</h2><p>Мы уже получили отчёт об ошибке. Попробуйте обновить страницу.</p><button onClick={()=>location.reload()}>Обновить</button></div>);
    }
    return this.props.children;
  }
}
