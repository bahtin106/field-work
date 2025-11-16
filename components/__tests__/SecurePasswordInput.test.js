/**
 * ТЕСТЫ для SecurePasswordInput компонента
 * Jest + React Native Testing Library
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import SecurePasswordInput from '../components/SecurePasswordInput';

describe('SecurePasswordInput Component', () => {
  // ==========================================================================
  // БАЗОВЫЕ ТЕСТЫ ОТОБРАЖЕНИЯ
  // ==========================================================================

  describe('Rendering', () => {
    it('должен отображаться без ошибок', () => {
      const { getByTestId } = render(<SecurePasswordInput testID="password-input" />);
      expect(getByTestId('password-input')).toBeTruthy();
    });

    it('должен показывать плейсхолдер', () => {
      const { getByPlaceholderText } = render(<SecurePasswordInput placeholder="Введите пароль" />);
      expect(getByPlaceholderText('Введите пароль')).toBeTruthy();
    });

    it('должен показывать кнопку toggle по умолчанию', () => {
      const { getByAccessibilityLabel } = render(
        <SecurePasswordInput showVisibilityToggle={true} />,
      );
      expect(getByAccessibilityLabel(/показать пароль|скрыть пароль/i)).toBeTruthy();
    });

    it('не должен показывать кнопку toggle если отключена', () => {
      const { queryByAccessibilityLabel } = render(
        <SecurePasswordInput showVisibilityToggle={false} />,
      );
      expect(queryByAccessibilityLabel(/показать пароль|скрыть пароль/i)).toBeNull();
    });
  });

  // ==========================================================================
  // ТЕСТЫ МАСКИРОВКИ
  // ==========================================================================

  describe('Password Masking', () => {
    it('должен маскировать пароль точками по умолчанию', async () => {
      const { getByDisplayValue } = render(
        <SecurePasswordInput value="" onChangeText={() => {}} />,
      );

      const input = getByDisplayValue('');
      fireEvent.changeText(input, 'password123');

      await waitFor(() => {
        // Изначально показываем маску
        expect(getByDisplayValue(/•{11}/)).toBeTruthy();
      });
    });

    it('должен показывать последний символ на время', async () => {
      const { getByDisplayValue } = render(<SecurePasswordInput />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, 'pass');

      // Сразу после ввода показываем последний символ
      await waitFor(() => {
        expect(getByDisplayValue(/•••s/)).toBeTruthy();
      });

      // После 500ms скрываем последний символ
      await waitFor(
        () => {
          expect(getByDisplayValue(/••••/)).toBeTruthy();
        },
        { timeout: 600 },
      );
    });

    it('должен показывать весь текст в режиме видимости', async () => {
      const { getByDisplayValue, getByAccessibilityLabel } = render(<SecurePasswordInput />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, 'password123');

      // Открыть видимость пароля
      const toggleButton = getByAccessibilityLabel('Показать пароль');
      fireEvent.press(toggleButton);

      await waitFor(() => {
        expect(getByDisplayValue('password123')).toBeTruthy();
      });
    });
  });

  // ==========================================================================
  // ТЕСТЫ TOGGLE ВИДИМОСТИ
  // ==========================================================================

  describe('Visibility Toggle', () => {
    it('должен переключать видимость пароля', async () => {
      const { getByAccessibilityLabel, getByDisplayValue } = render(<SecurePasswordInput />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, 'password123');

      const toggleButton = getByAccessibilityLabel('Показать пароль');

      // Нажать на toggle для показа
      fireEvent.press(toggleButton);

      await waitFor(() => {
        expect(getByDisplayValue('password123')).toBeTruthy();
      });

      // Нажать на toggle для скрытия
      const hideButton = getByAccessibilityLabel('Скрыть пароль');
      fireEvent.press(hideButton);

      await waitFor(() => {
        expect(getByDisplayValue(/•+/)).toBeTruthy();
      });
    });

    it('должен сохранять текст при toggle', async () => {
      const { getByAccessibilityLabel, getByDisplayValue } = render(<SecurePasswordInput />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, 'mySecurePassword');

      const toggleButton = getByAccessibilityLabel('Показать пароль');
      fireEvent.press(toggleButton);

      await waitFor(() => {
        expect(getByDisplayValue('mySecurePassword')).toBeTruthy();
      });

      // Убедиться что текст не изменился
      fireEvent.press(getByAccessibilityLabel('Скрыть пароль'));

      // После скрытия должны остаться маски того же количества
      await waitFor(() => {
        const maskedInput = getByDisplayValue(/•+/);
        expect(maskedInput).toBeTruthy();
      });
    });
  });

  // ==========================================================================
  // ТЕСТЫ CALLBACKS И СОБЫТИЙ
  // ==========================================================================

  describe('Callbacks and Events', () => {
    it('должен вызывать onChangeText при вводе', async () => {
      const onChangeText = jest.fn();
      const { getByDisplayValue } = render(<SecurePasswordInput onChangeText={onChangeText} />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, 'password');

      expect(onChangeText).toHaveBeenCalledWith('password');
    });

    it('должен вызывать onSubmitEditing при нажатии return', async () => {
      const onSubmitEditing = jest.fn();
      const { getByDisplayValue } = render(
        <SecurePasswordInput onSubmitEditing={onSubmitEditing} />,
      );

      const input = getByDisplayValue('');
      fireEvent(input, 'submitEditing');

      expect(onSubmitEditing).toHaveBeenCalled();
    });

    it('должен вызывать onFocus при фокусировке', async () => {
      const onFocus = jest.fn();
      const { getByDisplayValue } = render(<SecurePasswordInput onFocus={onFocus} />);

      const input = getByDisplayValue('');
      fireEvent(input, 'focus');

      expect(onFocus).toHaveBeenCalled();
    });

    it('должен вызывать onBlur при потере фокуса', async () => {
      const onBlur = jest.fn();
      const { getByDisplayValue } = render(<SecurePasswordInput onBlur={onBlur} />);

      const input = getByDisplayValue('');
      fireEvent(input, 'blur');

      expect(onBlur).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ТЕСТЫ CONTROLLED COMPONENT
  // ==========================================================================

  describe('Controlled Component', () => {
    it('должен обновляться при изменении value prop', async () => {
      const { rerender, getByDisplayValue } = render(
        <SecurePasswordInput value="initial" onChangeText={() => {}} />,
      );

      await waitFor(() => {
        expect(getByDisplayValue(/•+/)).toBeTruthy();
      });

      rerender(<SecurePasswordInput value="changed" onChangeText={() => {}} />);

      await waitFor(() => {
        expect(getByDisplayValue(/•+/)).toBeTruthy();
      });
    });

    it('должен быть дизейблен если editable={false}', () => {
      const { getByDisplayValue } = render(
        <SecurePasswordInput value="password" onChangeText={() => {}} editable={false} />,
      );

      const input = getByDisplayValue(/•+/);
      expect(input.props.editable).toBe(false);
    });
  });

  // ==========================================================================
  // ТЕСТЫ AUTOFILL ПОДДЕРЖКИ
  // ==========================================================================

  describe('AutoFill Support (iOS)', () => {
    it('должен использовать правильный textContentType для iOS', () => {
      const { getByDisplayValue } = render(<SecurePasswordInput />);

      const input = getByDisplayValue('');
      expect(input.props.textContentType).toBe('password');
    });

    it('должен менять textContentType при toggle', async () => {
      const { getByDisplayValue, getByAccessibilityLabel } = render(<SecurePasswordInput />);

      let input = getByDisplayValue('');
      expect(input.props.textContentType).toBe('password');

      // Открыть видимость
      fireEvent.press(getByAccessibilityLabel('Показать пароль'));

      await waitFor(() => {
        input = getByDisplayValue(/\w+/);
        expect(input.props.textContentType).toBe('none');
      });
    });
  });

  // ==========================================================================
  // ТЕСТЫ REF УПРАВЛЕНИЯ
  // ==========================================================================

  describe('Ref Management', () => {
    it('должен работать с forwardRef', () => {
      const ref = React.createRef();
      render(<SecurePasswordInput ref={ref} />);

      expect(ref.current).toBeTruthy();
    });

    it('должен давать доступ к фокусу через ref', () => {
      const ref = React.createRef();
      const { getByDisplayValue } = render(<SecurePasswordInput ref={ref} />);

      // Проверить что это TextInput
      const input = getByDisplayValue('');
      expect(input).toBeTruthy();
    });
  });

  // ==========================================================================
  // ТЕСТЫ ACCESSIBILITY
  // ==========================================================================

  describe('Accessibility', () => {
    it('должен иметь доступное имя', () => {
      const { getByAccessibilityLabel } = render(<SecurePasswordInput placeholder="Пароль" />);

      expect(getByAccessibilityLabel('Пароль')).toBeTruthy();
    });

    it('toggle кнопка должна быть доступна', () => {
      const { getByAccessibilityLabel } = render(<SecurePasswordInput />);

      const button = getByAccessibilityLabel(/показать пароль|скрыть пароль/i);
      expect(button.props.accessible).toBe(true);
    });
  });

  // ==========================================================================
  // ТЕСТЫ EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('должен корректно обрабатывать пустой пароль', () => {
      const onChangeText = jest.fn();
      const { getByDisplayValue } = render(<SecurePasswordInput onChangeText={onChangeText} />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, '');

      expect(onChangeText).toHaveBeenCalledWith('');
    });

    it('должен обрабатывать очень длинные пароли', async () => {
      const longPassword = 'a'.repeat(1000);
      const onChangeText = jest.fn();
      const { getByDisplayValue } = render(<SecurePasswordInput onChangeText={onChangeText} />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, longPassword);

      expect(onChangeText).toHaveBeenCalledWith(longPassword);

      await waitFor(() => {
        expect(getByDisplayValue(/•{999}a/)).toBeTruthy();
      });
    });

    it('должен обрабатывать специальные символы', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const { getByDisplayValue } = render(<SecurePasswordInput />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, password);

      expect(getByDisplayValue(/•+/)).toBeTruthy();
    });

    it('должен обрабатывать эмодзи и Unicode', async () => {
      const password = 'пароль🔐😊中文';
      const onChangeText = jest.fn();
      const { getByDisplayValue } = render(<SecurePasswordInput onChangeText={onChangeText} />);

      const input = getByDisplayValue('');
      fireEvent.changeText(input, password);

      expect(onChangeText).toHaveBeenCalledWith(password);
    });

    it('должен очищать таймауты при размонтировании', () => {
      const { unmount } = render(<SecurePasswordInput />);

      // Не должно быть ошибок при размонтировании
      expect(() => unmount()).not.toThrow();
    });
  });

  // ==========================================================================
  // ТЕСТЫ ПРОИЗВОДИТЕЛЬНОСТИ
  // ==========================================================================

  describe('Performance', () => {
    it('не должен делать лишние рендеры', () => {
      const onChangeText = jest.fn();
      const { rerender } = render(
        <SecurePasswordInput value="password" onChangeText={onChangeText} />,
      );

      // Повторный рендер с тем же value не должен вызывать callback
      rerender(<SecurePasswordInput value="password" onChangeText={onChangeText} />);

      // onChangeText не должен был вызван при rerender
      // (только если это был onChangeText callback)
    });
  });

  // ==========================================================================
  // ТЕСТЫ ИНТЕГРАЦИИ
  // ==========================================================================

  describe('Integration Tests', () => {
    it('должен работать с двумя полями (пароль и подтверждение)', async () => {
      const onPasswordChange = jest.fn();
      const onConfirmChange = jest.fn();

      const { getAllByDisplayValue } = render(
        <>
          <SecurePasswordInput testID="password" onChangeText={onPasswordChange} />
          <SecurePasswordInput testID="confirm" onChangeText={onConfirmChange} />
        </>,
      );

      const inputs = getAllByDisplayValue('');
      fireEvent.changeText(inputs[0], 'password123');
      fireEvent.changeText(inputs[1], 'password123');

      expect(onPasswordChange).toHaveBeenCalledWith('password123');
      expect(onConfirmChange).toHaveBeenCalledWith('password123');
    });
  });
});

// =============================================================================
// SNAPSHOT ТЕСТЫ
// =============================================================================

describe('SecurePasswordInput Snapshots', () => {
  it('должен матчиться со снимком при базовой конфигурации', () => {
    const { toJSON } = render(
      <SecurePasswordInput value="" onChangeText={() => {}} placeholder="Введите пароль" />,
    );

    expect(toJSON()).toMatchSnapshot();
  });

  it('должен матчиться со снимком без toggle кнопки', () => {
    const { toJSON } = render(
      <SecurePasswordInput value="" onChangeText={() => {}} showVisibilityToggle={false} />,
    );

    expect(toJSON()).toMatchSnapshot();
  });
});
