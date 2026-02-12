/**
 * ADVANCED РџР РРњР•Р Р« РёСЃРїРѕР»СЊР·РѕРІР°РЅРёСЏ SecurePasswordInput
 * РџСЂРѕРґРІРёРЅСѓС‚С‹Рµ РєРµР№СЃС‹ Рё РёРЅС‚РµРіСЂР°С†РёРё
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import SecurePasswordInput from '../components/SecurePasswordInput';

// =============================================================================
// РџР РРњР•Р  1: Password strength meter СЃ Р°РЅРёРјР°С†РёРµР№
// =============================================================================
export function PasswordStrengthMeter() {
  const [password, setPassword] = useState('');
  const strengthAnim = useRef(new Animated.Value(0)).current;

  const calculateStrength = (pwd) => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[!@#$%^&*]/.test(pwd)) score++;
    return score;
  };

  const strength = calculateStrength(password);
  const strengthLabels = ['РћС‡РµРЅСЊ СЃР»Р°Р±С‹Р№', 'РЎР»Р°Р±С‹Р№', 'РЎСЂРµРґРЅРёР№', 'РҐРѕСЂРѕС€РёР№', 'РЎРёР»СЊРЅС‹Р№', 'РћС‚Р»РёС‡РЅС‹Р№'];
  const strengthColors = ['#f44336', '#ff9800', '#ffc107', '#8bc34a', '#4caf50', '#00897b'];

  useEffect(() => {
    Animated.timing(strengthAnim, {
      toValue: strength,
      duration: 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [strength, strengthAnim]);

  const strengthWidth = strengthAnim.interpolate({
    inputRange: [0, 6],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="Р’РІРµРґРёС‚Рµ РїР°СЂРѕР»СЊ"
      />

      <View style={styles.strengthContainer}>
        <Animated.View
          style={[
            styles.strengthBar,
            {
              width: strengthWidth,
              backgroundColor: strengthColors[strength - 1],
            },
          ]}
        />
      </View>

      {strength > 0 && (
        <Text style={[styles.strengthLabel, { color: strengthColors[strength - 1] }]}>
          {strengthLabels[strength - 1]}
        </Text>
      )}
    </View>
  );
}

// =============================================================================
// РџР РРњР•Р  2: Р”РІСѓС…СЌС‚Р°РїРЅР°СЏ РІРµСЂРёС„РёРєР°С†РёСЏ РїР°СЂРѕР»СЏ
// =============================================================================
export function TwoStepPasswordVerification() {
  const [step, setStep] = useState(1);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');

  const canProceed = newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <View style={styles.container}>
      {step === 1 ? (
        <View>
          <Text style={styles.title}>РЁР°Рі 1: РўРµРєСѓС‰РёР№ РїР°СЂРѕР»СЊ</Text>
          <SecurePasswordInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Р’РІРµРґРёС‚Рµ С‚РµРєСѓС‰РёР№ РїР°СЂРѕР»СЊ"
            returnKeyType="next"
          />

          {currentPassword.length > 0 && (
            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                // РџСЂРѕРІРµСЂРёС‚СЊ С‚РµРєСѓС‰РёР№ РїР°СЂРѕР»СЊ
                setStep(2);
              }}
            >
              <Text style={styles.buttonText}>Р”Р°Р»РµРµ</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View>
          <Text style={styles.title}>РЁР°Рі 2: РќРѕРІС‹Р№ РїР°СЂРѕР»СЊ</Text>
          <SecurePasswordInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="РќРѕРІС‹Р№ РїР°СЂРѕР»СЊ"
            returnKeyType="next"
          />

          <SecurePasswordInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="РџРѕРґС‚РІРµСЂРґРёС‚Рµ РїР°СЂРѕР»СЊ"
            returnKeyType="done"
          />

          {newPassword !== confirmPassword && confirmPassword.length > 0 && (
            <Text style={styles.errorText}>РџР°СЂРѕР»Рё РЅРµ СЃРѕРІРїР°РґР°СЋС‚</Text>
          )}

          <TouchableOpacity
            style={[styles.button, !canProceed && styles.buttonDisabled]}
            disabled={!canProceed}
            onPress={() => {
              Alert.alert('РЈСЃРїРµС…', 'РџР°СЂРѕР»СЊ РёР·РјРµРЅРµРЅ');
              setStep(1);
              setNewPassword('');
              setConfirmPassword('');
              setCurrentPassword('');
            }}
          >
            <Text style={styles.buttonText}>РР·РјРµРЅРёС‚СЊ РїР°СЂРѕР»СЊ</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.buttonSecondary} onPress={() => setStep(1)}>
            <Text style={styles.buttonSecondaryText}>РќР°Р·Р°Рґ</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// =============================================================================
// РџР РРњР•Р  3: РџР°СЂРѕР»СЊ СЃ РёСЃС‚РµС‡РµРЅРёРµРј СЃСЂРѕРєР° РґРµР№СЃС‚РІРёСЏ
// =============================================================================
export function PasswordWithExpiration() {
  const [password, setPassword] = useState('');
  const [passwordSetDate, setPasswordSetDate] = useState(null);
  const [daysUntilExpire, setDaysUntilExpire] = useState(null);

  const EXPIRE_DAYS = 90;

  useEffect(() => {
    if (!passwordSetDate) return;

    const now = new Date();
    const expiryDate = new Date(passwordSetDate);
    expiryDate.setDate(expiryDate.getDate() + EXPIRE_DAYS);

    const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    setDaysUntilExpire(daysRemaining);
  }, [passwordSetDate]);

  const getExpiryStatus = () => {
    if (!daysUntilExpire) return null;
    if (daysUntilExpire <= 0) return { text: 'РСЃС‚РµРє', color: '#f44336' };
    if (daysUntilExpire <= 7)
      return { text: `РСЃС‚РµРєР°РµС‚ С‡РµСЂРµР· ${daysUntilExpire} РґРЅ.`, color: '#ff9800' };
    return { text: `РСЃС‚РµРєР°РµС‚ С‡РµСЂРµР· ${daysUntilExpire} РґРЅ.`, color: '#4caf50' };
  };

  const expiryStatus = getExpiryStatus();

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="Р’РІРµРґРёС‚Рµ РїР°СЂРѕР»СЊ"
        onFocus={() => setPasswordSetDate(new Date())}
      />

      {expiryStatus && (
        <Text style={[styles.expiryText, { color: expiryStatus.color }]}>{expiryStatus.text}</Text>
      )}
    </View>
  );
}

// =============================================================================
// РџР РРњР•Р  4: РРЅС‚РµРіСЂР°С†РёСЏ СЃ Biometric Authentication
// =============================================================================
export function PasswordWithBiometric() {
  const [password, setPassword] = useState('');
  const [_useBiometric, _setUseBiometric] = useState(false);
  const [biometricAvailable, _setBiometricAvailable] = useState(false);

  useEffect(() => {
    // РџСЂРѕРІРµСЂРёС‚СЊ РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ Р±РёРѕРјРµС‚СЂРёРё
    checkBiometricAvailability();
  }, []);

  const checkBiometricAvailability = async () => {
    try {
      // import * as LocalAuthentication from 'expo-local-authentication';
      // const compatible = await LocalAuthentication.hasHardwareAsync();
      // setBiometricAvailable(compatible);
    } catch (error) {
      console.error('Biometric check error:', error);
    }
  };

  const handleBiometricLogin = async () => {
    try {
      // const authenticated = await LocalAuthentication.authenticateAsync({
      //   reason: 'РСЃРїРѕР»СЊР·СѓР№С‚Рµ Р±РёРѕРјРµС‚СЂРёСЋ РґР»СЏ РІС…РѕРґР°',
      //   fallbackLabel: 'РСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РїР°СЂРѕР»СЊ',
      //   disableDeviceFallback: false,
      // });
      // if (authenticated.success) {
      //   // РџРѕР»СѓС‡РёС‚СЊ РїР°СЂРѕР»СЊ РёР· secure storage
      //   // Рё Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё Р·Р°Р»РѕРіРёРЅРёС‚СЊСЃСЏ
      // }
    } catch {
      Alert.alert('РћС€РёР±РєР°', 'РћС€РёР±РєР° РїСЂРё РёСЃРїРѕР»СЊР·РѕРІР°РЅРёРё Р±РёРѕРјРµС‚СЂРёРё');
    }
  };

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="Р’РІРµРґРёС‚Рµ РїР°СЂРѕР»СЊ"
      />

      {biometricAvailable && (
        <TouchableOpacity style={styles.biometricButton} onPress={handleBiometricLogin}>
          <Text style={styles.biometricButtonText}>РСЃРїРѕР»СЊР·РѕРІР°С‚СЊ Face ID</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// =============================================================================
// РџР РРњР•Р  5: РџР°СЂРѕР»СЊ СЃ РЅРµРІРёРґРёРјС‹РјРё С‚СЂРµР±РѕРІР°РЅРёСЏРјРё (NIST СЂРµРєРѕРјРµРЅРґР°С†РёРё)
// =============================================================================
export function AdvancedPasswordRequirements() {
  const [password, setPassword] = useState('');

  const requirements = {
    minLength: {
      label: 'РњРёРЅРёРјСѓРј 8 СЃРёРјРІРѕР»РѕРІ (СЂРµРєРѕРјРµРЅРґСѓРµС‚СЃСЏ 12+)',
      met: password.length >= 8,
    },
    noCommonPatterns: {
      label: 'РќРµ СЃРѕРґРµСЂР¶РёС‚ СЂР°СЃРїСЂРѕСЃС‚СЂР°РЅРµРЅРЅС‹Рµ РїР°С‚С‚РµСЂРЅС‹',
      met: !['password', 'qwerty', '123456', 'admin', 'letmein'].some((pattern) =>
        password.toLowerCase().includes(pattern),
      ),
    },
    noRepeatingChars: {
      label: 'РќРµ СЃРѕРґРµСЂР¶РёС‚ 3+ РѕРґРёРЅР°РєРѕРІС‹С… СЃРёРјРІРѕР»РѕРІ РїРѕРґСЂСЏРґ',
      met: !/(.)\1{2,}/.test(password),
    },
    mixedCharacters: {
      label: 'Р Р°Р·РЅС‹Рµ С‚РёРїС‹ СЃРёРјРІРѕР»РѕРІ (Р±СѓРєРІС‹, С†РёС„СЂС‹)',
      met: /[a-z]/i.test(password) && /[0-9]/.test(password),
    },
  };

  const isValid = Object.values(requirements).every((req) => req.met);

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        inputStyle={[
          password && isValid && styles.inputValid,
          password && !isValid && styles.inputError,
        ]}
      />

      <View style={styles.requirementsAdvanced}>
        {Object.entries(requirements).map(([key, { label, met }]) => (
          <View key={key} style={styles.requirementRow}>
            <Text style={[styles.requirementMark, met && styles.requirementMet]}>
              {met ? 'вњ“' : 'в—‹'}
            </Text>
            <Text style={[styles.requirementText, met && styles.requirementMetText]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// =============================================================================
// РџР РРњР•Р  6: РџР°СЂРѕР»СЊ СЃ РёСЃС‚РѕСЂРёРё РїСЂРѕРІРµСЂРѕРє
// =============================================================================
export function PasswordWithHistory() {
  const [password, setPassword] = useState('');
  const [passwordHistory, setPasswordHistory] = useState([]);
  const [cantReuseFor] = useState(5); // РќРµ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ 5 РїСЂРµРґС‹РґСѓС‰РёС… РїР°СЂРѕР»РµР№

  const handleSubmit = async () => {
    const isInHistory = passwordHistory.some((oldPwd) => oldPwd === password);

    if (isInHistory) {
      Alert.alert('РћС€РёР±РєР°', `РќРµ РёСЃРїРѕР»СЊР·СѓР№С‚Рµ РїР°СЂРѕР»Рё РёР· РїРѕСЃР»РµРґРЅРёС… ${cantReuseFor} РїРѕРїС‹С‚РѕРє`);
      return;
    }

    // РћС‚РїСЂР°РІРёС‚СЊ РїР°СЂРѕР»СЊ
    setPasswordHistory((prev) => [password, ...prev].slice(0, cantReuseFor));
    setPassword('');
    Alert.alert('РЈСЃРїРµС…', 'РџР°СЂРѕР»СЊ СѓСЃРїРµС€РЅРѕ РёР·РјРµРЅРµРЅ');
  };

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="РќРѕРІС‹Р№ РїР°СЂРѕР»СЊ"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
      />

      {passwordHistory.length > 0 && (
        <View style={styles.historyContainer}>
          <Text style={styles.historyTitle}>РСЃС‚РѕСЂРёСЏ РїР°СЂРѕР»РµР№ (РїРѕСЃР»РµРґРЅРёРµ {cantReuseFor}):</Text>
          <View style={styles.historyList}>
            {passwordHistory.map((_, index) => (
              <View key={index} style={styles.historyItem}>
                <Text style={styles.historyIndex}>{index + 1}</Text>
                <Text style={styles.historyMask}>вЂўвЂўвЂўвЂўвЂўвЂўвЂўвЂў</Text>
                <Text style={styles.historyDate}>{new Date().toLocaleDateString('ru')}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// РЎС‚РёР»Рё
const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: '#333',
  },
  strengthContainer: {
    height: 4,
    backgroundColor: '#eee',
    borderRadius: 2,
    marginVertical: 12,
    overflow: 'hidden',
  },
  strengthBar: {
    height: '100%',
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 12,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 8,
  },
  buttonSecondaryText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  errorText: {
    color: '#f44336',
    fontSize: 12,
    marginTop: 6,
  },
  expiryText: {
    fontSize: 12,
    marginTop: 12,
    fontWeight: '600',
  },
  biometricButton: {
    backgroundColor: '#8bc34a',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 12,
  },
  biometricButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  requirementsAdvanced: {
    marginTop: 16,
    paddingHorizontal: 12,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  requirementMark: {
    width: 20,
    textAlign: 'center',
    color: '#ccc',
    fontSize: 16,
    marginRight: 8,
  },
  requirementMet: {
    color: '#4caf50',
  },
  requirementText: {
    flex: 1,
    fontSize: 13,
    color: '#666',
  },
  requirementMetText: {
    color: '#333',
    fontWeight: '500',
  },
  inputValid: {
    borderColor: '#4caf50',
  },
  inputError: {
    borderColor: '#f44336',
  },
  historyContainer: {
    marginTop: 16,
    paddingHorizontal: 12,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  historyList: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  historyIndex: {
    fontWeight: 'bold',
    color: '#999',
    marginRight: 12,
    width: 24,
  },
  historyMask: {
    flex: 1,
    color: '#999',
    fontWeight: '500',
  },
  historyDate: {
    fontSize: 11,
    color: '#999',
  },
});

export default {
  PasswordStrengthMeter,
  TwoStepPasswordVerification,
  PasswordWithExpiration,
  PasswordWithBiometric,
  AdvancedPasswordRequirements,
  PasswordWithHistory,
};



