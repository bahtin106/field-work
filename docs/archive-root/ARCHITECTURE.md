# 🏗️ АРХИТЕКТУРА НОВОГО КОДА

## Диаграмма компонентов

```
┌─────────────────────────────────────────────────────────────┐
│                    LoginScreenContent                        │
│                     (Render only)                            │
└─────────────────────────────────────────────────────────────┘
                           ↓
                    useAuthLogin()
                           ↓
        ┌──────────────────┴──────────────────┐
        ↓                                     ↓
   State & Logic                        Error Handling
   - email                                    ↓
   - password                        mapSupabaseAuthError()
   - loading                                  ↓
   - error                          AUTH_ERROR_MESSAGES
   - handleLogin()
        ↓
   ┌────────────────────────────────────────┐
   │     Supabase Auth API                  │
   │  supabase.auth.signInWithPassword()    │
   └────────────────────────────────────────┘
```

---

## Файловая структура

```
app/
├── (auth)/
│   └── login.jsx              ← Компонент (UI только)
│
hooks/
├── useAuthLogin.js            ← Логика авторизации
│
lib/
├── authValidation.js          ← Валидаторы
├── supabaseAuthErrors.js      ← Маппирование ошибок
├── supabase.js                ← Клиент Supabase
└── logger.js                  ← Логирование
│
src/
└── i18n/
    ├── index.js               ← Глобальное хранилище переводов
    └── useTranslation.js      ← React hook для i18n
```

---

## Поток данных

### Успешный вход

```
User enters email/password
        ↓
useAuthLogin (setState)
        ↓
EmailValid ✓ && PasswordValid ✓
        ↓
User clicks "Вход"
        ↓
handleLogin() → debounce 300ms
        ↓
performLogin()
        ↓
AbortController (отменяет предыдущие запросы)
        ↓
supabase.auth.signInWithPassword()
        ↓
✅ No error
        ↓
setState(loading = false)
        ↓
_layout.js обнаруживает auth change
        ↓
Redirect to /orders
```

---

### Ошибка входа

```
User enters invalid credentials
        ↓
User clicks "Вход"
        ↓
supabase.auth.signInWithPassword()
        ↓
❌ Error returned
        ↓
mapSupabaseAuthError(error)
        ↓
errorKey = AUTH_ERRORS.INVALID_CREDENTIALS
        ↓
message = t(errorKey, fallback)
        ↓
setState(error = message)
        ↓
UI shows error message
```

---

## Обработка жизненного цикла

### Mount

```
useEffect(() => {
  isMountedRef.current = true;
  // Инициализация
})
```

### Unmount

```
useEffect(() => {
  return () => {
    isMountedRef.current = false;
    abortControllerRef.current?.abort();
    clearTimeout(loginTimeoutRef.current);
  };
}, [])
```

---

## Валидация на каждом этапе

### 1. На вводе (real-time)

```
user types in TextField
        ↓
setEmail(value)
        ↓
Вычисляется: emailValid = isValidEmail(email)
        ↓
Button disabled={!canSubmit}
```

### 2. Перед отправкой

```
handleLogin()
        ↓
if (!canSubmit) return;  ← Guard
        ↓
performLogin()
```

### 3. На сервере

```
Supabase обработает еще раз
(мы не доверяем фронте)
```

---

## Обработка ошибок на каждом уровне

### Уровень 1: Компонент

```javascript
{
  error && <Text style={styles.error}>{error}</Text>;
}
```

### Уровень 2: Hook

```javascript
const errorKey = mapSupabaseAuthError(authErr);
const errorMessage = t(errorKey, AUTH_ERROR_MESSAGES[errorKey]);
setError(errorMessage);
```

### Уровень 3: Utils

```javascript
export function mapSupabaseAuthError(error) {
  // Маппирует Supabase ошибки на коды приложения
}
```

---

## Защита от проблем

### Утечка памяти

```
❌ Проблема: Callback в async запросе после unmount
✅ Решение: AbortController + cleanup в useEffect
```

### Спам кликов

```
❌ Проблема: Пользователь быстро кликает несколько раз
✅ Решение: Дебаунс 300ms в handleLogin
```

### Зависимость от текста ошибки

```
❌ Проблема: "Invalid login credentials" может измениться
✅ Решение: Используем error.status (401, 429, и т.д.)
```

### Невалидный email попадает на сервер

```
❌ Проблема: Некорректная валидация на фронте
✅ Решение: RFC-compliant валидация + проверка на бэке
```

---

## Зависимости

### Обязательные

- React (useCallback, useEffect, useRef, useState)
- react-native
- @supabase/supabase-js
- expo (для app конфига)

### Рекомендуемые

- @react-native-async-storage/async-storage (для кэша)
- expo-router (для навигации)
- @tanstack/react-query (для кэширования запросов)

---

## Performance оптимизации

### Render optimization

```javascript
// Компонент обернут в memo() для предотвращения ненужных ререндеров
export default memo(LoginScreenContent);
```

### Style optimization

```javascript
// Стили вычисляются один раз и мемоизируются
const styles = useMemo(() => StyleSheet.create(...), [theme]);
```

### Callback optimization

```javascript
// Callbacks обернуты в useCallback для зависимостей
const handleTogglePassword = useCallback(() => {
  setShowPassword((prev) => !prev);
}, []);
```

### Debounce optimization

```javascript
// Запросы дебаунсятся, чтобы избежать множественных вызовов
loginTimeoutRef.current = setTimeout(() => {
  performLogin(...);
}, 300);
```

---

## Accessibility

### Input fields

```javascript
<TextField accessibilityLabel={t('fields_email', 'E-mail')} />
```

### Buttons

```javascript
<Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide' : 'Show'} />
```

### Error messages

```javascript
{
  error && <Text style={styles.error}>{error}</Text>;
}
// Автоматически читается screen reader'ом
```

---

## Масштабируемость

### Добавить новый тип авторизации

```javascript
// 1. Создай useAuthSignup.js аналогично useAuthLogin.js
// 2. Используй те же utils:
import { isValidEmail } from '../../lib/authValidation';
import { mapSupabaseAuthError } from '../../lib/supabaseAuthErrors';
// 3. Добавь компонент SignupScreen.jsx

// В hooks/useAuthSignup.js:
export function useAuthSignup() {
  const { email, setEmail, password, setPassword, ... } = useAuthLogin();
  // Переиспользуем части, добавляем новую логику
  const handleSignup = useCallback(async () => {
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    // ...
  }, [...]);
  return { ..., handleSignup };
}
```

### Добавить социальную авторизацию

```javascript
// В useAuthLogin.js:
const handleGoogleLogin = useCallback(async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
  });
  // Используем то же mapSupabaseAuthError()
}, []);
```

### Добавить биометрию

```javascript
// Создай useAuthBiometric.js:
export function useAuthBiometric() {
  // Использует те же ошибки и валидацию
  // Но вместо email/password использует биометрию
}
```

---

## Обратная совместимость

Если нужно использовать старый код где-то еще:

```javascript
// ❌ Старый способ (deprecated)
import { t } from '../../src/i18n';

// ✅ Новый способ (recommended)
import { useTranslation } from '../../src/i18n/useTranslation';
const { t } = useTranslation();

// Оба способа работают, но новый лучше
```

---

## Мониторинг и аналитика

```javascript
// В useAuthLogin.js:
const performLogin = useCallback(async () => {
  logger.debug('Login attempt', { email: emailTrim });

  // ...

  if (authErr) {
    logAuthError('login', authErr, { email: emailTrim });
  } else {
    logger.info('Login successful', { email: emailTrim });
  }
}, []);

// Результат в console/logs:
// "Login attempt" → для отследения попыток
// "Login failed" → для отследения ошибок
// "Login successful" → для метрик успеха
```

---

**Архитектура готова к масштабированию!** 🚀
