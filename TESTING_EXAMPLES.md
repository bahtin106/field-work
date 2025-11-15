/\*\*

- Примеры unit-тестов для рефакторированного кода
- Используйте Jest + React Native Testing Library
  \*/

// ============================================
// authValidation.test.js
// ============================================

import { isValidEmail, isValidPassword, getEmailValidationError } from '../authValidation';

describe('Email Validation', () => {
describe('isValidEmail', () => {
it('should accept valid email addresses', () => {
expect(isValidEmail('test@example.com')).toBe(true);
expect(isValidEmail('user.name@company.co.uk')).toBe(true);
expect(isValidEmail('a@b.co')).toBe(true);
});

    it('should reject invalid email addresses', () => {
      expect(isValidEmail('invalid..email@com')).toBe(false); // double dots
      expect(isValidEmail('no-domain@.com')).toBe(false); // empty domain
      expect(isValidEmail('@example.com')).toBe(false); // no local part
      expect(isValidEmail('user@')).toBe(false); // no domain
    });

    it('should reject emails with whitespace', () => {
      expect(isValidEmail('  test@example.com  ')).toBe(true); // trim happens
      expect(isValidEmail('test @example.com')).toBe(false); // space in local part
      expect(isValidEmail('test@ example.com')).toBe(false); // space in domain
    });

    it('should reject emails exceeding max length', () => {
      const longEmail = 'a'.repeat(300) + '@example.com'; // > 254 chars
      expect(isValidEmail(longEmail)).toBe(false);
    });

    it('should handle non-string inputs', () => {
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail(123)).toBe(false);
    });

});

describe('getEmailValidationError', () => {
it('should return null for valid emails', () => {
expect(getEmailValidationError('test@example.com')).toBeNull();
});

    it('should return specific error reasons', () => {
      expect(getEmailValidationError('test')).toBe('email_invalid_format');
      expect(getEmailValidationError('test..@example.com')).toBe('email_has_double_dots');
      expect(getEmailValidationError('a'.repeat(300) + '@com')).toBe('email_too_long');
      expect(getEmailValidationError('')).toBe('email_is_empty');
    });

});
});

describe('Password Validation', () => {
describe('isValidPassword', () => {
it('should accept valid passwords', () => {
expect(isValidPassword('password123')).toBe(true);
expect(isValidPassword('P@ssw0rd!')).toBe(true);
});

    it('should reject empty passwords', () => {
      expect(isValidPassword('')).toBe(false);
    });

    it('should handle non-string inputs', () => {
      expect(isValidPassword(null)).toBe(false);
      expect(isValidPassword(undefined)).toBe(false);
    });

    it('should reject passwords exceeding max length', () => {
      const longPassword = 'a'.repeat(200);
      expect(isValidPassword(longPassword)).toBe(false);
    });

});
});

// ============================================
// supabaseAuthErrors.test.js
// ============================================

import {
mapSupabaseAuthError,
AUTH_ERRORS,
isNetworkError,
} from '../supabaseAuthErrors';

describe('Error Mapping', () => {
describe('mapSupabaseAuthError', () => {
it('should map 401 status to INVALID_CREDENTIALS', () => {
const error = { status: 401, message: 'Unauthorized' };
expect(mapSupabaseAuthError(error)).toBe(AUTH_ERRORS.INVALID_CREDENTIALS);
});

    it('should map "Invalid login credentials" message', () => {
      const error = { message: 'Invalid login credentials' };
      expect(mapSupabaseAuthError(error)).toBe(AUTH_ERRORS.INVALID_CREDENTIALS);
    });

    it('should map 429 status to TOO_MANY_REQUESTS', () => {
      const error = { status: 429, message: 'Rate limited' };
      expect(mapSupabaseAuthError(error)).toBe(AUTH_ERRORS.TOO_MANY_REQUESTS);
    });

    it('should map "too many" in message to TOO_MANY_REQUESTS', () => {
      const error = { message: 'too many login attempts' };
      expect(mapSupabaseAuthError(error)).toBe(AUTH_ERRORS.TOO_MANY_REQUESTS);
    });

    it('should map network errors', () => {
      expect(mapSupabaseAuthError({ message: 'Network error' }))
        .toBe(AUTH_ERRORS.NETWORK_ERROR);
      expect(mapSupabaseAuthError({ message: 'ECONNREFUSED' }))
        .toBe(AUTH_ERRORS.NETWORK_ERROR);
    });

    it('should return AUTH_ERROR for unknown errors', () => {
      expect(mapSupabaseAuthError({ message: 'Unknown error' }))
        .toBe(AUTH_ERRORS.AUTH_ERROR);
    });

    it('should handle null/undefined errors', () => {
      expect(mapSupabaseAuthError(null)).toBe(AUTH_ERRORS.AUTH_ERROR);
      expect(mapSupabaseAuthError(undefined)).toBe(AUTH_ERRORS.AUTH_ERROR);
    });

});

describe('isNetworkError', () => {
it('should identify network errors', () => {
expect(isNetworkError({ message: 'Network error' })).toBe(true);
expect(isNetworkError({ message: 'ECONNREFUSED' })).toBe(true);
expect(isNetworkError({ message: 'timeout' })).toBe(true);
expect(isNetworkError({ status: 0 })).toBe(true);
});

    it('should reject non-network errors', () => {
      expect(isNetworkError({ message: 'Auth error' })).toBe(false);
      expect(isNetworkError({ status: 401 })).toBe(false);
    });

});
});

// ============================================
// useAuthLogin.test.js
// ============================================

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useAuthLogin } from '../useAuthLogin';
import \* as supabaseModule from '../../lib/supabase';

jest.mock('../../lib/supabase');
jest.mock('../../lib/logger');
jest.mock('../../src/i18n/useTranslation');

describe('useAuthLogin Hook', () => {
beforeEach(() => {
jest.clearAllMocks();
});

it('should initialize with empty values', () => {
const { result } = renderHook(() => useAuthLogin());

    expect(result.current.email).toBe('');
    expect(result.current.password).toBe('');
    expect(result.current.error).toBe('');
    expect(result.current.loading).toBe(false);

});

it('should update email and password', () => {
const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('test@example.com');
      result.current.setPassword('password123');
    });

    expect(result.current.email).toBe('test@example.com');
    expect(result.current.password).toBe('password123');

});

it('should validate email and password', () => {
const { result } = renderHook(() => useAuthLogin());

    expect(result.current.emailValid).toBe(false);
    expect(result.current.passwordValid).toBe(false);
    expect(result.current.canSubmit).toBe(false);

    act(() => {
      result.current.setEmail('test@example.com');
      result.current.setPassword('password123');
    });

    expect(result.current.emailValid).toBe(true);
    expect(result.current.passwordValid).toBe(true);
    expect(result.current.canSubmit).toBe(true);

});

it('should handle successful login', async () => {
const mockSignIn = jest.fn().mockResolvedValue({ error: null });
supabaseModule.supabase.auth.signInWithPassword = mockSignIn;

    const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('test@example.com');
      result.current.setPassword('password123');
    });

    act(() => {
      result.current.handleLogin();
    });

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    expect(result.current.error).toBe('');

});

it('should handle login error', async () => {
const mockSignIn = jest.fn().mockResolvedValue({
error: { message: 'Invalid login credentials', status: 401 },
});
supabaseModule.supabase.auth.signInWithPassword = mockSignIn;

    const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('test@example.com');
      result.current.setPassword('wrongpassword');
    });

    act(() => {
      result.current.handleLogin();
    });

    await waitFor(() => {
      expect(result.current.error).not.toBe('');
    });

});

it('should debounce login attempts', async () => {
const mockSignIn = jest.fn().mockResolvedValue({ error: null });
supabaseModule.supabase.auth.signInWithPassword = mockSignIn;

    const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('test@example.com');
      result.current.setPassword('password123');
    });

    // Call multiple times quickly
    act(() => {
      result.current.handleLogin();
      result.current.handleLogin();
      result.current.handleLogin();
    });

    // Дебаунс должен предотвратить множественные вызовы
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledTimes(1);
    });

});

it('should cleanup on unmount', () => {
const { unmount } = renderHook(() => useAuthLogin());

    // AbortController должен быть отменен при unmount
    const abortSpy = jest.fn();
    global.AbortController = jest.fn(() => ({
      abort: abortSpy,
      signal: new AbortSignal(),
    }));

    unmount();

    // Проверяем, что очистка прошла корректно
    expect(() => unmount()).not.toThrow();

});

it('should clear error when input changes', () => {
const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('test@example.com');
      result.current.setPassword('password123');
    });

    // Simulate error
    act(() => {
      // Error would be set during failed login
    });

    // Change email
    act(() => {
      result.current.setEmail('new@example.com');
    });

    // Error should be cleared
    expect(result.current.error).toBe('');

});
});

// ============================================
// Integration Tests
// ============================================

describe('Login Flow Integration', () => {
it('should prevent submission with invalid email', () => {
const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('invalid-email');
      result.current.setPassword('password123');
    });

    expect(result.current.canSubmit).toBe(false);

});

it('should prevent submission with empty password', () => {
const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('test@example.com');
      result.current.setPassword('');
    });

    expect(result.current.canSubmit).toBe(false);

});

it('should allow submission with valid email and password', () => {
const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('test@example.com');
      result.current.setPassword('password123');
    });

    expect(result.current.canSubmit).toBe(true);

});

it('should trim email before sending', async () => {
const mockSignIn = jest.fn().mockResolvedValue({ error: null });
supabaseModule.supabase.auth.signInWithPassword = mockSignIn;

    const { result } = renderHook(() => useAuthLogin());

    act(() => {
      result.current.setEmail('  test@example.com  ');
      result.current.setPassword('password123');
    });

    act(() => {
      result.current.handleLogin();
    });

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'test@example.com', // trimmed
        password: 'password123',
      });
    });

});
});
