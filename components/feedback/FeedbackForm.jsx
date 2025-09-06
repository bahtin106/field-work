
// src/FeedbackForm.jsx
import React, { useState } from 'react';
import { logEvent } from './telemetry';
export default function FeedbackForm({ onClose, onSubmit }) {
  const [text,setText]=useState(''); const [contact,setContact]=useState(''); const [sending,setSending]=useState(false); const [done,setDone]=useState(false);
  const canSend = text.trim().length>=10 && !sending;
  const handleSend = async()=>{ if(!canSend) return; setSending(true); try{ const ok = await onSubmit?.({text,contact}); logEvent('feedback_submitted',{ok}); setDone(true); setText(''); setContact(''); }catch(e){ logEvent('feedback_submit_failed',{message:String(e?.message||e)}); alert('Не удалось отправить. Попробуйте ещё раз.'); } finally{ setSending(false);} };
  if(done){ return (<div style={{padding:16,maxWidth:560}}><h3>Спасибо! 📨</h3><p>Ваш отзыв отправлен команде.</p><button onClick={onClose} style={{marginTop:12}}>Закрыть</button></div>); }
  return (<div style={{padding:16,maxWidth:560}}><h3>Сообщить о проблеме или оставить отзыв</h3><p style={{marginTop:4,color:'#666'}}>Опишите, что случилось и что вы ожидали увидеть.</p>
    <div style={{display:'flex',flexDirection:'column',gap:12,marginTop:12}}>
      <textarea placeholder="Текст отзыва (минимум 10 символов)" value={text} onChange={(e)=>setText(e.target.value)} rows={6} style={{width:'100%',padding:12,borderRadius:8,border:'1px solid #ddd'}}/>
      <input placeholder="Как с вами связаться (email/telegram), необязательное поле" value={contact} onChange={(e)=>setContact(e.target.value)} style={{width:'100%',padding:12,borderRadius:8,border:'1px solid #ddd'}}/>
      <div style={{display:'flex',gap:8,marginTop:8}}><button onClick={onClose} disabled={sending}>Отмена</button><button onClick={handleSend} disabled={!canSend}>{sending?'Отправка…':'Отправить'}</button></div>
    </div></div>);
}
