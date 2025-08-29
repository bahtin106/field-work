import 'react-native-gesture-handler'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Slot } from 'expo-router'
import { useEffect, useState, useCallback } from 'react'
import { ActivityIndicator, View, AppState, Platform } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import { supabase } from '../lib/supabase'
import SettingsProvider from '../providers/SettingsProvider'
import { ThemeProvider, useTheme } from '../theme/ThemeProvider'
import * as NavigationBar from 'expo-navigation-bar'

// Сплэш скрываем вручную
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {

// —— Keep Android nav bar transparent across the app
useEffect(() => {
  (async () => {
    try {
      await NavigationBar.setBackgroundColorAsync('#00000000');
      await NavigationBar.setBehaviorAsync('overlay-swipe');
      await NavigationBar.setVisibilityAsync('immersive');
      await NavigationBar.setButtonStyleAsync('dark');
    } catch {}
  })();
}, []);

  const [isLoggedIn, setIsLoggedIn] = useState(null)

  useEffect(() => {
    let mounted = true

    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (mounted) setIsLoggedIn(!!user)
    }
    checkAuth()

    const { data: authListener } = supabase.auth.onAuthStateChange((_, session) => {
      setIsLoggedIn(!!session)
    })

    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') SplashScreen.hideAsync().catch(() => {})
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
      sub.remove()
    }
  }, [])

  const onLayoutRootView = useCallback(() => {
    if (isLoggedIn !== null) {
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [isLoggedIn])

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }} onLayout={onLayoutRootView}>
      <ThemeProvider>
        <SettingsProvider>
          {isLoggedIn === null ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" />
            </View>
          ) : !isLoggedIn ? (
            <Slot name="auth" />
          ) : (
            <Slot name="tabs" />
          )}
        </SettingsProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
