import { useEffect, useState } from 'react'
    import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, 
Pressable } from 'react-native'
    import Modal from 'react-native-modal'
    import { supabase } from '../lib/supabase'
    import { getUserRole } from '../lib/getUserRole'
    import { useRouter } from 'expo-router'

    export default function WorkerHome() {
      const router = useRouter()
      const [profile, setProfile] = useState(null)
      const [loading, setLoading] = useState(true)
      const [blocked, setBlocked] = useState(false)

      // Плейсхолдеры статистики
      const [stats, setStats] = useState({
        totalOrders: 0,
        pendingOrders: 0,
        completedOrders: 0,
        earnings: 0,
        earningsForecast: 0,
      })

      useEffect(() => {
        const fetchProfileAndStats = async () => {
          setLoading(true)
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) {
            router.replace('/login')
            return
          }

          const { data: profileData, error } = await supabase
            .from('profiles')
            .select('first_name, last_name, is_suspended, suspended_at')
            .eq('id', session.user.id)
            .single()
          if (error) {
            console.error('Ошибка загрузки профиля', error)
          } else {
            setProfile({ first_name: profileData.first_name, last_name: 
profileData.last_name })
            setBlocked(!!(profileData.is_suspended || profileData.suspended_at))
          }

          // Здесь позже будет запрос статистики из таблицы заказов
          // Пока ставим заглушки
          setStats({
            totalOrders: 25,
            pendingOrders: 5,
            completedOrders: 20,
            earnings: 12345,
            earningsForecast: 15000,
          })

          setLoading(false)
        }
        fetchProfileAndStats()
      }, [])

      const handleLogout = async () => {
        await supabase.auth.signOut()
        router.replace('/login')
      }

      const handleOpenCalendar = () => {
        // Пока заглушка, потом реализуем календарь
        alert('Календарь пока не готов')
      }

      if (loading) {
        return (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        )
      }

      if (blocked) {
        return (
          <View style={styles.blocked}>
            <Text style={styles.blockedTitle}>Ваш аккаунт заблокирован</Text>
            <Text style={styles.blockedText}>Обратитесь к администратору.</Text>
            <View style={{ height: 12 }} />
            <Pressable onPress={handleLogout} style={({pressed}) => 
[styles.appButton, styles.btnDanger, pressed && {transform:[{scale:0.98}]}]}>
              <Text style={styles.appButtonText}>Выйти</Text>
            </Pressable>
          </View>
        )
      }

      return (
        <View style={styles.container}>
          <Text style={styles.greeting}>
            Привет, {profile ? `${profile.first_name} ${profile.last_name}` : 
'работник'}!
          </Text>

          <View style={styles.statsBlock}>
            <Text style={styles.statsTitle}>Статистика по заказам:</Text>
            <Text>Всего заказов: {stats.totalOrders}</Text>
            <Text>Невыполненных: {stats.pendingOrders}</Text>
            <Text>Выполненных: {stats.completedOrders}</Text>
          </View>

          <View style={styles.statsBlock}>
            <Text style={styles.statsTitle}>Заработок:</Text>
            <Text>Уже заработано: {stats.earnings} ₽</Text>
            <Text>Прогноз на период: {stats.earningsForecast} ₽</Text>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleOpenCalendar}>
            <Text style={styles.buttonText}>Открыть календарь</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, styles.logoutButton]} 
onPress={handleLogout}>
            <Text style={[styles.buttonText, 
styles.logoutButtonText]}>Выйти</Text>
          </TouchableOpacity>

          {/* Модалка на будущее, если понадобится показывать блокировку поверх 
экрана */}
          <Modal isVisible={blocked} useNativeDriver backdropOpacity={0.4} 
onBackdropPress={() => {}}>
            <View style={styles.blockedCard}>
              <Text style={styles.blockedTitle}>Ваш аккаунт заблокирован</Text>
              <Text style={styles.blockedText}>Обратитесь к 
администратору.</Text>
              <Pressable onPress={handleLogout} style={({pressed}) => 
[styles.appButton, styles.btnDanger, pressed && {transform:[{scale:0.98}]}]}>
                <Text style={styles.appButtonText}>Выйти</Text>
              </Pressable>
            </View>
          </Modal>
        </View>
      )
    }

    const styles = StyleSheet.create({
      container: {
        flex: 1,
        backgroundColor: '#F5F7FA',
        padding: 20,
        justifyContent: 'center',
      },
      greeting: {
        fontSize: 28,
        fontWeight: '600',
        marginBottom: 24,
        color: '#1a2741',
        textAlign: 'center',
      },
      statsBlock: {
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 14,
        marginBottom: 20,
        shadowColor: '#007AFF33',
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 3,
      },
      statsTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 12,
        color: '#007AFF',
      },
      button: {
        backgroundColor: '#007AFF',
        paddingVertical: 16,
        borderRadius: 14,
        alignItems: 'center',
        marginBottom: 12,
      },
      logoutButton: {
        backgroundColor: '#ff3b30',
      },
      buttonText: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '600',
      },
      logoutButtonText: {
        fontWeight: '700',
      },
      centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
      },
      blocked: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      },
      blockedTitle: { fontSize: 20, fontWeight: '700', marginBottom: 6, color: 
'#1a2741' },
      blockedText: { fontSize: 16, color: '#333' },

      // Доп. стили для кнопок/модалки
      appButton: {
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
      },
      btnDanger: {
        backgroundColor: '#ff3b30',
      },
      appButtonText: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '600',
      },
      blockedCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
      },
    })