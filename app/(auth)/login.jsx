import React, { useMemo, useRef, useState } from 'react';

import {
  View,
  Text,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native'
import { supabase } from '../../lib/supabase'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/ThemeProvider';

export default function LoginScreen() {
  const { theme } = useTheme();
  
  
  const styles = useMemo(() => StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  centerBlock: {
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 8,
    paddingBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#1a2741',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 34,
    color: '#6d768a',
  },
  input: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 14,
    borderColor: '#e5eaf1',
    borderWidth: 1.2,
    marginBottom: 18,
    fontSize: 16,
    color: '#1a2741',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#007AFF33',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  error: {
    color: '#ff3b30',
    textAlign: 'center',
    marginTop: -10,
    marginBottom: 14,
    fontSize: 15,
  },
}), [theme]);

const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const passwordRef = useRef(null)

  const handleLogin = async () => {
    if (!email || !password || loading) return
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      setError('Неверный логин или пароль')
    } else {
      router.replace('/')
    }
  }

  const isDisabled = !email || !password || loading

  return (
    <View style={{ flex: 1, backgroundColor: '#f2f6fa' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.container}>
              <View style={styles.centerBlock}>
                <Text style={styles.title}>Монитор</Text>
                <Text style={styles.subtitle}>Контроль выездных задач и заявок</Text>

                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  placeholderTextColor="#b5bed0"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />

                <TextInput
                  ref={passwordRef}
                  style={styles.input}
                  placeholder="Пароль"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholderTextColor="#b5bed0"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.button, isDisabled && { backgroundColor: '#8fcaff' }]}
                  onPress={handleLogin}
                  disabled={isDisabled}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Войти</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  centerBlock: {
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 8,
    paddingBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#1a2741',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 34,
    color: '#6d768a',
  },
  input: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 14,
    borderColor: '#e5eaf1',
    borderWidth: 1.2,
    marginBottom: 18,
    fontSize: 16,
    color: '#1a2741',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#007AFF33',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  error: {
    color: '#ff3b30',
    textAlign: 'center',
    marginTop: -10,
    marginBottom: 14,
    fontSize: 15,
  },
})