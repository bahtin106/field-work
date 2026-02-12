# Профессиональное решение доставляемости emailов — MonitorApp

## Статус: DKIM ✓ SPF ✓ DMARC ✓ (p=quarantine)

Письма теперь имеют:
- ✓ DKIM подпись (selector: `beget`)
- ✓ SPF запись (`include:beget.com`)
- ✓ DMARC политика (`p=quarantine` — стандартная, поддерживает репутацию)
- ✓ Профессиональные заголовки (List-Unsubscribe, X-Mailer, X-Priority)
- ✓ Правильная MIME структура (multipart/alternative с текстом и HTML)
- ✓ Явное Message-ID для отслеживания

**Письма попадают в спам не из-за защиты, а из-за репутации домена.**

Требуется выполнить следующие шаги для постоянного решения:

---

## Шаг 1: Убедитесь в правильной настройке Postfix на VPS

Проверьте текущую конфигурацию:

```bash
# SSH на VPS 5.35.91.118
postconf -n | grep -E "^(relayhost|myhostname|mydomain|smtp_tls|receive_raw_before_cleanup_text_is_binary)"
```

**Ожидаемый результат:**
- `relayhost = [smtp.beget.com]:465`
- `myhostname = mail.monitorapp.ru`
- `mydomain = monitorapp.ru`
- `smtp_tls_security_level = encrypt`
- `smtp_tls_wrappermode = yes`

Если что-то отличается, обновите:

```bash
sudo postconf -e "relayhost = [smtp.beget.com]:465"
sudo postconf -e "smtp_tls_security_level = encrypt"
sudo postconf -e "smtp_tls_wrappermode = yes"
sudo postfix reload
```

### Проверьте саслpasswd (auth для Beget):

```bash
sudo cat /etc/postfix/sasl_passwd | grep beget
```

Должно быть:
```
[smtp.beget.com]:465 noreply@monitorapp.ru:PASSWORD
```

Если нет, добавьте:

```bash
sudo bash -c 'echo "[smtp.beget.com]:465 noreply@monitorapp.ru:PASSWORD_FROM_BEGET" >> /etc/postfix/sasl_passwd'
sudo postmap /etc/postfix/sasl_passwd
sudo chown 600 /etc/postfix/sasl_passwd /etc/postfix/sasl_passwd.db
sudo postfix reload
```

---

## Шаг 2: Проверьте обратный DNS (PTR) и HELO

**PTR для IP 5.35.91.118 ДОЛЖЕН быть `mail.monitorapp.ru`**

Проверить:

```bash
nslookup -type=PTR 118.91.35.5.in-addr.arpa 8.8.8.8
```

Должно вернуть: `mail.monitorapp.ru`

**ЕСЛИ PTR неправильный или отсутствует:**
- Обратитесь в техподдержку хостера (вашего VPS-провайдера, не Beget)
- Попросите установить PTR запись для 5.35.91.118 → mail.monitorapp.ru

**Проверьте HELO в Postfix:**

```bash
postconf -n | grep "^smtp_helo_name"
```

Если не установлено, добавьте:

```bash
sudo postconf -e "smtp_helo_name = mail.monitorapp.ru"
sudo postfix reload
```

---

## Шаг 3: Проверьте очередь Postfix и логи

**Текущая очередь:**

```bash
postqueue -p
```

Если есть элементы в очереди:
- Если старые (>1 часа) — удалите:
  ```bash
  postsuper -d ALL
  postfix flush  # Пересправить оставшиеся
  ```

**Логи доставки (последние 50 строк):**

```bash
tail -n 50 /var/log/mail.log | grep -E "(DKIM|SPF|tls|Beget|relay|deliver)"
```

**Специально ищите:**
- ✓ `DKIM-Signature: ... beget ...` — DKIM подписан Beget
- ✓ `Received: from ... by smtp.beget.com ...` — реле через Beget
- ✓ `250 2.0.0` — успешная доставка
- ✗ `550` или `421` — отказно или временная ошибка  (смотрите детали)

---

## Шаг 4: Проверьте Docker контейнер с email-сервисом

**Убедитесь, что email-сервис работает:**

```bash
# Внутри VPS
docker ps | grep email-server
docker logs --tail=50 email-server
```

**Должны видеть строки вроде:**
```
[SMTP] Connection successful! Ready to send emails.
Email queued: { to: ..., type: 'password-reset', messageId: ... }
```

**Проверьте, что SMTP_HOST и SMTP_PORT правильные в .env:**

```bash
docker inspect email-server | grep -A 5 "\"Env\""
```

Ищите:
- `SMTP_HOST=5.35.91.118` (или адрес Beget если переходите напрямую)
- `SMTP_PORT=587` или `SMTP_PORT=465` (должен совпадать с Postfix слушающим портом)

**Если контейнер старый (>5 дней назад), пересобрать:**

```bash
cd /path/to/email-server
docker-compose build --no-cache
docker-compose up -d
```

---

## Шаг 5: Регистрация в Google Postmaster Tools

**Это самый важный шаг для мониторинга доставляемости!**

1. Перейдите на https://postmaster.google.com
2. Вход через Google аккаунт (любой)
3. Добавить домен: `monitorapp.ru`
   - Google попросит подтверждение через TXT запись в DNS
   - Добавьте указанную запись в DNS на хостере `monitorapp.ru`
   - Проверьте и подтвердите в Google
4. После подтверждения Postmaster Tools покажет:
   - Delivery rate (% успешной доставки)
   - Spam rate (% попадания в спам)
   - Domain reputation (состояние репутации)
   - Feedback loop information  (отписки, жалобы)

**Проверяйте эти метрики каждый день первые 2 недели и корректируйте по результатам.**

---

## Шаг 6: Контролируемый прогрев домена

**Не отправляйте миллионы сразу!** Поначалу низкий объём отправок и высокий процент "хороших" адресов.

**План на 2 недели:**

| День | Объём | Целевая аудитория |
|------|-------|------------------|
| 1-2 | 10-20/день | Только ваши адреса (тестовые) |
| 3-4 | 50-100/день | Корпоративные адреса (Outlook, Gmail от компаний) |
| 5-7 | 200-500/день | Расширенная тестовая группа (друзья, коллеги) |
| 8-14 | Остальные | Постепенное увеличение к нормальному объёму |

**Важно:**
- Просите получателей **не помещать в спам** (скажите, что это важные письма)
- Отслеживайте в Google Postmaster Tools дневную статистику
- Если spam rate > 5% — остановитесь и диагностируйте
- Если spam rate < 0.1% — можно ускорить прогрев

---

## Шаг 7: Проверка отправленного письма (пример)

Отправьте тестовое письмо на **вашу личную почту Gmail**:

```bash
# На VPS (тест через curl)
curl -X POST http://localhost:3000/send-email \
  -H "Content-Type: application/json" \
  -d '{
    "type": "password-reset",
    "email": "your-personal-gmail@gmail.com",
    "firstName": "Test",
    "tempPassword": "TestPass123!",
  }'
```

Затем:
1. **Откройте письмо в Gmail** (поиск в спаме или входящие)
2. **Посмотрите "Show original"** (верхнее меню письма) и скопируйте заголовки
3. **Проверьте заголовки:**
   - `Authentication-Results: ... dkim=pass ... spf=pass ... dmarc=pass` ✓
   - `DKIM-Signature: ... s=beget ...` ✓
   - `List-Unsubscribe: <mailto:...>` ✓
   - `X-Mailer: MonitorApp-EmailService/1.0` ✓
4. **Если всё в порядке**, но письмо в спаме — это вопрос репутации IP/домена, решается через Google Postmaster Tools и прогрев

---

## Шаг 8: Долгосрочный мониторинг

**Каждый день первый месяц:**
- Проверьте Google Postmaster Tools → Delivery metrics
- Если spam rate растёт → смотрите content в письмах
- Если delivery rate падает → проверьте Postfix логи на VPS

**Еженедельно:**
- Проверьте очередь Postfix (должна быть пуста или близка к нулю)
- Посмотрите `/var/log/mail.log` на ошибки

**Ежемесячно:**
- Ревью списка адресов (удалить неправильные автоматически)
- Обновить rate limiting если нужно (в `email-server.cjs`)

---

## Что НЕ нужно делать (антипаттерны):

❌ **Не менять DMARC на `p=none`** — это скрывает проблемы, а не решает их  
❌ **Не использовать временные решения** — нужна стабильная инфраструктура  
❌ **Не спамить большие объёмы в первый день** — это убивает репутацию  
❌ **Не изменять From/Reply-To без причины** — это путает фильтры  
❌ **Не игнорировать Google Postmaster Tools** — это окно в репутацию домена  

---

## Проверочный список для теста

- [ ] Postfix конфигурация: relayhost → [smtp.beget.com]:465
- [ ] PTR запись: 5.35.91.118 → mail.monitorapp.ru  
- [ ] HELO name в Postfix: mail.monitorapp.ru
- [ ] Email контейнер запущен и здоров
- [ ] Email-сервис отправляет с профессиональными заголовками
- [ ] Google Postmaster Tools зарегистрирован и подтвержден
- [ ] Первое тестовое письмо отправлено и проверено
- [ ] Spam rate < 0.5% в Google Postmaster Tools
- [ ] Очередь Postfix пуста или редко заполняется

---

## Результат

После всех шагов:
- Письма будут отправляться через надёжный relay (Beget)
- Будут иметь все необходимые authentication заголовки (DKIM, SPF, DMARC)
- Будут содержать профессиональные заголовки (List-Unsubscribe и т.д.)
- Вы сможете отслеживать доставляемость в Google Postmaster Tools
- Repутация домена будет улучшаться медленно, но уверенно через контролируемый прогрев

**Это стандартная практика в enterprise-классе SMTP доставки.**
