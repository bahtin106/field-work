import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Animated,
  Easing,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Keyboard,
} from 'react-native';
import { InteractionManager } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { format, parseISO, isSameDay, startOfMonth } from 'date-fns';
import { ru as dfnsRu } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';

const CACHE_TTL_MS = 45000;
const LIST_CACHE = (globalThis.LIST_CACHE ||= {});
LIST_CACHE.calendar ||= null;
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import { useTheme } from '../../theme/ThemeProvider';

// Role colors (as in [id].jsx)
const ROLE_COLORS = { admin: '#007AFF', dispatcher: '#34C759', worker: '#5856D6' };
const ROLE_LABEL_RU = { admin: 'Администратор', dispatcher: 'Диспетчер', worker: 'Рабочий' };
const roleColor = (r) => ROLE_COLORS[r] || '#8E8E93';

/** ======= RU locale for react-native-calendars ======= */
LocaleConfig.locales['ru'] = {
  monthNames: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
  monthNamesShort: ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'],
  dayNames: ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'],
  dayNamesShort: ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],
  today: 'Сегодня',
};
LocaleConfig.defaultLocale = 'ru';

const MONTHS_RU = LocaleConfig.locales['ru'].monthNames;

export default function CalendarScreen() {
  const { theme } = useTheme();
  
  
  const styles = useMemo(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.bg },
  container: { flex: 1 },

  calendarCard: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    marginHorizontal: 12,
    marginTop: 12,
    paddingBottom: 10,
    paddingTop: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },

  headerBar: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  headerTitle: { fontWeight: '700', fontSize: 18, color: theme.colors.text },
  headerArrow: { fontSize: 22, color: theme.colors.accent },
  headerArrowHit: { padding: 6 },
  arrow: { fontSize: 20, color: theme.colors.accent, fontWeight: '700' },

  // day cell
  dayCell: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayInner: {
    width: 36,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingBottom: 14,
  },
  dayOut: { opacity: 0.45 },
  dayTodayOutline: { borderWidth: 1, borderColor: theme.colors.accent, borderRadius: 10 },
  daySelectedBg: {
    backgroundColor: theme.colors.accent,
    borderRadius: 10,
    shadowColor: theme.colors.accent,
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  dayText: { fontSize: 13, color: theme.colors.text, fontWeight: '700' },
  dayTextOut: { color: theme.text.muted.color },
  dayTextSelected: { color: theme.colors.accentTextOn },

  countPill: {
    position: 'absolute',
    bottom: 2,
    minWidth: 18,
    paddingHorizontal: 6,
    height: 16,
    borderRadius: 10,
    backgroundColor: theme.mode === 'dark' ? '#1C2230' : '#E7F0FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillSelected: { backgroundColor: theme.colors.card },
  countText: { fontSize: 10, fontWeight: '800', color: theme.colors.accent },
  countTextSelected: { color: theme.colors.accent },

  // header row for orders list
    ordersHeader: { minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 24, // чуть уже чем календарь
    paddingTop: 8,
    paddingBottom: 8,
  },
  ordersTitle: { fontWeight: '700', fontSize: 16, color: theme.colors.text },

  // chips
  chip: { marginLeft: 8, backgroundColor: theme.mode === 'dark' ? theme.chip.bg : '#e7f0ff', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14 },
  chipActive: { backgroundColor: theme.colors.accent },
  chipText: { color: theme.colors.accent, fontWeight: '600' },
  chipTextActive: { color: theme.colors.accentTextOn },

  // cards (copied from all-orders, trimmed)
    card: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 0, // вровень с календарём
    marginBottom: 12,
    marginLeft: 0,
    marginRight: 0,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 6, color: theme.colors.text },
  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

  cardSubtitle: { fontSize: 14, color: theme.text.muted.color, marginBottom: 2 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  cardExecutor: { fontSize: 13, color: theme.text.muted.color, maxWidth: 180 },

  urgentDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  urgentDotText: { color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 12 },

  noOrders: { fontSize: 14, color: '#999999', textAlign: 'center', marginTop: 20 },

  // modals
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: 'transparent', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 0 },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  yearText: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  monthCell: { width: '31%', backgroundColor: theme.mode === 'dark' ? theme.colors.card : theme.colors.bg, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 10 },
  monthCellText: { fontSize: 14, fontWeight: '600', color: theme.colors.text },

  searchInput: { backgroundColor: theme.colors.surface ? theme.colors.surface[1] : theme.colors.card, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, color: theme.colors.text, marginBottom: 8 },

  userRow: { paddingVertical: 12, borderBottomColor: theme.colors.border, borderBottomWidth: 1, paddingHorizontal: 16, backgroundColor: theme.colors.card },
  userRowActive: { backgroundColor: theme.mode === 'dark' ? theme.chip.bg : '#e7f0ff' },
  userName: { fontSize: 16, color: theme.colors.text },
  userNameActive: { color: theme.colors.accent, fontWeight: '700' },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },

  modalContent: { backgroundColor: 'transparent', padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%' },

  separator: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },

  executorOption: { paddingVertical: 10, paddingHorizontal: 6 },

  executorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  executorRowSelected: { backgroundColor: theme.mode === 'dark' ? (theme.chip?.bg || '#1C2230') : '#f0f8ff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },

  executorText: { fontSize: 15, color: theme.colors.text },

  checkmark: { fontSize: 16, color: theme.colors.accent, fontWeight: '600' },

  rolePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  modalCard: { backgroundColor: theme.colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, borderWidth: 1, borderColor: theme.colors.border },
  modalDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  

  clearButton: { marginTop: 12, backgroundColor: theme.mode === 'dark' ? theme.colors.tint : '#eee', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },

  clearButtonText: { color: theme.colors.accent, fontWeight: '500' },
}), [theme]);

const getDateKey = (v) => {
    if (!v) return null;
    if (typeof v === 'string') return v.slice(0, 10);
    try { return require('date-fns').format(new Date(v), 'yyyy-MM-dd'); } catch (e) { return null; }
  };
  const orderDateKey = (o) => getDateKey(o?.datetime ?? o?.date ?? o?.scheduled_at ?? o?.planned_at ?? o?.date_time ?? o?.start_at ?? o?.when);
  const { selectedDate: selectedDateParam, selectedUserId: selectedUserIdParam, returnTo, returnParams } = useLocalSearchParams();
  const seededRef = useRef(false);

  const router = useRouter();

  const backTargetPath = typeof returnTo === 'string' && returnTo ? String(returnTo) : null;
  let backParams = {};
  try { backParams = returnParams ? JSON.parse(returnParams) : {}; } catch (e) { backParams = {}; }
  // Handle Android hardware back to return origin if provided
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (backTargetPath) { router.replace({ pathname: backTargetPath, params: backParams }); return true; }
      return false; // default behavior
    });
    return () => sub.remove();
  }, [backTargetPath, JSON.stringify(backParams)]);


  const [profile, setProfile] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(() => LIST_CACHE.calendar ? false : true);
const [refreshing, setRefreshing] = useState(false);
  // Pull-to-refresh handler for calendar & pickers
  const onRefreshCalendar = async () => {
    setRefreshing(true);
    try {
      let query = supabase.from('orders_read_masked').select('*');
      if (role === 'worker' && profile?.id) {
        query = query.eq('assigned_to', profile.id);
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        setAllOrders(data);
        LIST_CACHE.calendar = { data, ts: Date.now() };
      }
    } catch (e) {
      // ignore; background refresh only
    } finally {
      setRefreshing(false);
    }
  };


  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  // Month transition animation (visible slide + fade)
  const monthTrans = useRef(new Animated.Value(0)).current;
  const monthOpacity = useRef(new Animated.Value(1)).current;
  const animateMonth = (dir) => {
    try {
      monthTrans.setValue(dir > 0 ? 24 : -24);
      monthOpacity.setValue(0.2);
      Animated.parallel([
        Animated.timing(monthTrans, { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(monthOpacity, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    } catch {}
  };

  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());

  const [users, setUsers] = useState([]);
  const [rolesMap, setRolesMap] = useState(new Map());
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userPickerVisible, setUserPickerVisible] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const [allOrders, setAllOrders] = useState([]);
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const isNoDateMode = useMemo(() => filteredOrders.length > 0 && filteredOrders.every(o => !o?.datetime), [filteredOrders]);

  // Load profile and users
  useEffect(() => {
    async function loadProfile() {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .eq('id', session.user.id)
        .single();
      if (profileError) {
        setLoading(false);
        return;
      }
      setProfile(profileData);
      setRole(profileData.role);
      const { data: usersData } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .order('first_name');
      setUsers(usersData || []);
      // seed rolesMap from this response so roles show immediately
      const initialMap = new Map();
      (usersData || []).forEach(u => { if (u && u.id) initialMap.set(u.id, u.role || 'worker'); });
      setRolesMap(initialMap);
      setLoading(false);
    }
    loadProfile();
  }, []);


  // Fetch roles for users lazily when user picker opens (bulk, cached)
  useEffect(() => {
    if (!userPickerVisible) return;
    try {
      const ids = (users || []).map(u => u.id).filter(Boolean);
      if (!ids.length) return;
    } catch {}
    (async () => {
      try {
        const ids = (users || []).map(u => u.id).filter(Boolean);
        if (!ids.length) return;
        const { data } = await supabase
          .from('profiles')
          .select('id, role')
          .in('id', ids);
        const map = new Map(rolesMap);
        (data || []).forEach(r => {
          if (r && r.id) map.set(r.id, r.role || 'worker');
        });
        setRolesMap(map);
      } catch {}
    })();
  }, [userPickerVisible, users]);

    
// Load orders once (seed from cache, refresh silently)
useEffect(() => {
  if (!profile) return;
  let alive = true;

  // 1) seed from cache instantly
  if (LIST_CACHE.calendar?.data) {
    setAllOrders(LIST_CACHE.calendar.data);
    setLoading(false);
  }

  // 2) refresh in background (no spinner if cache present)
  (async () => {
    try {
      let query = supabase.from('orders_read_masked').select('*');
      if (role === 'worker' && profile?.id) {
        query = query.eq('assigned_to', profile.id);
      }
      const { data, error } = await query;
      if (!alive) return;
      if (!error && Array.isArray(data)) {
        setAllOrders(data);
        LIST_CACHE.calendar = { data, ts: Date.now() };
      }
    } finally {
      if (alive && !LIST_CACHE.calendar) setLoading(false);
    }
  })();

  return () => { alive = false; };
}, [profile, role]);

  


// Auto refresh calendar by TTL
useEffect(() => {
  let alive = true;
  const timer = setInterval(async () => {
    const stale = !LIST_CACHE.calendar || (Date.now() - (LIST_CACHE.calendar.ts || 0) > CACHE_TTL_MS);
    if (!stale) return;
    let query = supabase.from('orders_read_masked').select('*');
    if (role === 'worker' && profile?.id) query = query.eq('assigned_to', profile.id);
    const { data, error } = await query;
    if (!alive) return;
    if (!error && Array.isArray(data)) {
      setAllOrders(data);
      LIST_CACHE.calendar = { data, ts: Date.now() };
    }
  }, 15000);
  return () => { alive = false; clearInterval(timer); };
}, [profile, role]);
// Derive orders by selectedUserId from allOrders (local filtering, no network)
useEffect(() => {
  if (selectedUserId) {
    setOrders(allOrders.filter(o => o?.assigned_to === selectedUserId));
  } else {
    setOrders(allOrders);
  }
}, [allOrders, selectedUserId]);
// Filter orders for selected date (with fallback to orders without datetime)
useEffect(() => {
  const forDay = orders.filter(o => {
    const k = orderDateKey(o);
    return k && k === selectedDate;
  });

  if (forDay.length > 0) {
    setFilteredOrders(forDay);
    return;
  }

  // Fallback: if no orders for the selected date, but there are orders without datetime — show them
  const noDate = orders.filter(o => !o?.datetime);
  if (noDate.length > 0) {
    setFilteredOrders(noDate);
  } else {
    setFilteredOrders([]);
  }
}, [orders, selectedDate]);

  // === Counts per date (respecting filters above) ===
  const countsByDate = useMemo(() => {
    const map = {};
    for (const o of orders) {
      const key = orderDateKey(o);
      if (!key) continue;
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [orders]);

  // Prepare selected date marking
  const markedDates = {
    [selectedDate]: { selected: true, selectedColor: theme.colors.accent },
  };

  // Map userId -> name
  const filteredSortedUsers = useMemo(() => {
    const q = (userSearch||'').trim().toLowerCase();
    const arr = (users||[]).map(u=>({
      id: u.id,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || '—',
      role: rolesMap.get(u.id) || 'worker',
    })).filter(u => !q || u.name.toLowerCase().includes(q));
    arr.sort((a,b)=> a.name.localeCompare(b.name, 'ru'));
    return arr;
  }, [users, userSearch]);

  const usersMap = useMemo(() => {
    const map = new Map();
    users.forEach(u => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
      map.set(u.id, name || '—');
    });
    return map;
  }, [users]);

  // === Modal animations ===
  // Fade for dim
  const dimAnim = useRef(new Animated.Value(0)).current;
  // Slide for sheet (0 -> hidden, 1 -> visible)
  const sheetAnim = useRef(new Animated.Value(0)).current;
  // Keyboard height to lift sheet when typing
  const kbAnim = useRef(new Animated.Value(0)).current;
  const screenH = Dimensions.get('window').height;

  const runOpenSheet = () => {
    dimAnim.setValue(0);
    sheetAnim.setValue(0);
    Animated.parallel([
      Animated.timing(dimAnim, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  };

  const runCloseSheet = (after) => {
    Animated.parallel([
      Animated.timing(dimAnim, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => after && after());
  };

  // Lift sheet with keyboard
  useEffect(() => {
    if (!userPickerVisible) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => {
      const h = e?.endCoordinates?.height || 0;
      Animated.timing(kbAnim, { toValue: h, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };
    const onHide = () => {
      Animated.timing(kbAnim, { toValue: 0, duration: 150, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start();
    };
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [userPickerVisible]);

  // Interpolations
  const dimOpacity = dimAnim; // 0..1
  const sheetTranslateY = Animated.add(
    Animated.multiply(Animated.add(Animated.multiply(sheetAnim, -1), 1), screenH * 0.6), // from ~60% screen height to 0
    Animated.multiply(kbAnim, -1) // move up by keyboard height
  );

  /* seed from params */
  const fadeAnim = useRef(new Animated.Value(0)).current; // keep for month picker
  const fadeIn = () => { Animated.timing(fadeAnim, { toValue: 1, duration: 180, easing: Easing.out(Easing.ease), useNativeDriver: true }).start(); };
  const fadeOut = (callback) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 160,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => { callback && callback(); });
  };

  useEffect(() => {
    if (seededRef.current) return;
    const sd = selectedDateParam ? String(selectedDateParam) : null;
    const uid = selectedUserIdParam ? String(selectedUserIdParam) : null;

    if (sd) {
      setSelectedDate(sd);
      setCurrentMonth(startOfMonth(new Date(Number(sd.slice(0,4)), Number(sd.slice(5,7)) - 1, 1)));
    }
    if (uid) setSelectedUserId(uid);

    if (sd || uid) seededRef.current = true;
  }, [selectedDateParam, selectedUserIdParam]);

  if (loading) {
  return (
    <SafeAreaView style={styles.centered}>
      <ActivityIndicator size="large" color={theme.colors.accent} />
    </SafeAreaView>
  );
}

  /** Header title only (arrows — default at edges) */
  const renderHeader = (dateObj) => {
    const d = new Date(dateObj);
    const title = `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
    return (
      <Text style={styles.headerTitle}>{title}</Text>
    );
  };
  
  // Month picker controls (same fade as раньше)
  const openMonthPicker = () => {
    setPickerYear(currentMonth.getFullYear());
    setMonthPickerVisible(true);
    fadeIn();
  };
  const closeMonthPicker = () => {
    fadeOut(() => setMonthPickerVisible(false));
  };
  // === Pick month in modal ===
  const pickMonth = (monthIdx) => {
    try {
      const newMonth = startOfMonth(new Date(pickerYear, monthIdx, 1));
      const curIndex = currentMonth.getFullYear() * 12 + currentMonth.getMonth();
      const newIndex = newMonth.getFullYear() * 12 + newMonth.getMonth();
      const dir = newIndex - curIndex;
      animateMonth(dir);
      setCurrentMonth(newMonth);
      setSelectedDate(format(newMonth, 'yyyy-MM-dd'));
    } finally {
      closeMonthPicker();
    }
  };


  // User picker controls — slide up/down
  const openUserPicker = () => {
    setUserSearch('');
    setUserPickerVisible(true);
    runOpenSheet();
  };
  const closeUserPicker = () => {
    runCloseSheet(() => setUserPickerVisible(false));
  };
  const handlePickUser = (uid) => {
    runCloseSheet(() => {
      setUserPickerVisible(false);
      setTimeout(() => {
        setSelectedUserId(uid);
      }, 0);
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

        <Animated.View style={{ transform: [{ translateX: monthTrans }], opacity: monthOpacity }}>
        <Calendar
          
          style={styles.calendarCard}
          current={format(currentMonth, 'yyyy-MM-dd')}
          onDayPress={day => setSelectedDate(day.dateString)}
          onMonthChange={m => {
            const newMonth = startOfMonth(new Date(m.year, m.month - 1, 1));
            const dir = (newMonth.getFullYear() * 12 + newMonth.getMonth()) - (currentMonth.getFullYear() * 12 + currentMonth.getMonth());
            animateMonth(dir);
            setCurrentMonth(newMonth);
            setSelectedDate(format(newMonth, 'yyyy-MM-dd'));
          }}
          markedDates={markedDates}
          renderHeader={renderHeader}
          dayComponent={({ date, state }) => {
            const key = date?.dateString;
            const count = countsByDate[key] || 0;
            const isSelected = selectedDate === key;
            const isToday = key === format(new Date(), 'yyyy-MM-dd');
            const isDisabled = state === 'disabled';

            return (
              <TouchableOpacity
                onPress={() => setSelectedDate(key)}
                activeOpacity={0.8}
                style={[styles.dayCell]}
              >
                <View
                  style={[
                    styles.dayInner,
                    isSelected && styles.daySelectedBg,
                    isToday && !isSelected && styles.dayTodayOutline,
                    isDisabled && styles.dayOut,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      isDisabled && styles.dayTextOut,
                      isSelected && styles.dayTextSelected,
                    ]}
                  >
                    {date?.day}
                  </Text>
                  {count > 0 && (
                    <View style={[styles.countPill, isSelected && styles.countPillSelected]}>
                      <Text style={[styles.countText, isSelected && styles.countTextSelected]} numberOfLines={1}>
                        {count}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          theme={{

            selectedDayBackgroundColor: theme.colors.accent,
            selectedDayTextColor: theme.colors.accentTextOn,
            todayTextColor: theme.colors.accent,
            dayTextColor: theme.colors.text,
            monthTextColor: theme.colors.text,
            arrowColor: theme.colors.accent,
            calendarBackground: 'transparent',
            backgroundColor: 'transparent',
            textDayFontSize: 14,
            textMonthFontSize: 18,
            textDayHeaderFontSize: 12,
            textDayFontWeight: '600',
            textMonthFontWeight: '700',
            textDayHeaderFontWeight: '600',            'stylesheet.calendar.main': {
              week: {
                marginTop: 2,
                marginBottom: 2,
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: 6,
              },
            container: { backgroundColor: 'transparent' } },
          
          }}
          hideExtraDays={false}
          enableSwipeMonths={true}
          firstDay={1}
          monthFormat={'MMMM yyyy'}
        />

        </Animated.View>
        {/* Orders header + filter */}
        <View style={styles.ordersHeader}>
          <Text style={styles.ordersTitle}>
            Заявки на {isNoDateMode ? 'Без даты' : format(new Date(selectedDate), 'd MMMM', { locale: dfnsRu })}
          </Text>
          {(role === 'admin' || role === 'dispatcher') && (
            <View style={{ flexDirection:'row', alignItems:'center' }}>
              <TouchableOpacity onPress={openUserPicker} style={[styles.chip, selectedUserId && styles.chipActive]}>
                <Text style={[styles.chipText, selectedUserId && styles.chipTextActive]}>
                  {selectedUserId ? (usersMap.get(selectedUserId) || 'Сотрудник') : 'Все сотрудники'}
                </Text>
              </TouchableOpacity>
              {selectedUserId && (
                <Pressable onPress={() => setSelectedUserId(null)} hitSlop={10} style={{ marginLeft: 6, height: 28, width: 28, alignItems:'center', justifyContent:'center', borderRadius: 14, backgroundColor: theme.colors.accentMuted || (theme.mode==='dark' ? theme.colors.tint : '#eaeaea') }}>
                  <Text style={{ color: theme.text.muted.color, fontSize: 16, fontWeight: '700' }}>×</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* Orders list — дизайн карточек как в all-orders (без даты) */}
        <FlatList refreshing={refreshing} onRefresh={onRefreshCalendar}
          data={filteredOrders}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          ListEmptyComponent={<Text style={styles.noOrders}>Нет заявок</Text>}
          renderItem={({ item }) => (
          <DynamicOrderCard
            order={item}
            context="calendar"
            usersMap={usersMap}
            onPress={() =>
              router.push({
                pathname: `/order-details/${item.id}`,
                params: { returnTo: '/(tabs)/calendar', returnParams: JSON.stringify({ selectedDate, selectedUserId }) },
              })
            }
          />
        )}
        />

        {/* Month picker modal (оставляем fade) */}
        <Modal
  visible={monthPickerVisible}
  transparent
  statusBarTranslucent
  presentationStyle="overFullScreen"
  animationType="fade"
  onRequestClose={closeMonthPicker}
>
          <Pressable style={styles.modalBackdrop} onPress={closeMonthPicker}>
            <Animated.View style={[styles.modalSheet, { opacity: fadeAnim }]}>
              <View style={styles.yearRow}>
                <TouchableOpacity onPress={() => setPickerYear(y => y - 1)}>
                  <Text style={styles.arrow}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.yearText}>{pickerYear}</Text>
                <TouchableOpacity onPress={() => setPickerYear(y => y + 1)}>
                  <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.monthGrid}>
                {MONTHS_RU.map((m, idx) => (
                  <TouchableOpacity key={m} style={styles.monthCell} onPress={() => pickMonth(idx)}>
                    <Text style={styles.monthCellText}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Animated.View>
          </Pressable>
        </Modal>


        {/* User picker modal — обновлена анимация: выезд снизу и заезд обратно, + подъём при клавиатуре */}
        <Modal
  visible={userPickerVisible}
  transparent
  statusBarTranslucent
  presentationStyle="overFullScreen"
  animationType="none"
  onRequestClose={closeUserPicker}
>
          <Pressable style={styles.modalBackdrop} onPress={closeUserPicker}>
            <Animated.View pointerEvents="none" style={[styles.modalDim, { opacity: dimOpacity }]} />
            <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetTranslateY }] }]}>
              <View style={styles.modalCard}>
                <TextInput
                  placeholder="Поиск исполнителя..."
                  value={userSearch}
                  onChangeText={setUserSearch}
                  style={styles.searchInput}
                  placeholderTextColor={theme.text.muted.color}
                  returnKeyType="search"
                />
                <FlatList refreshing={refreshing} onRefresh={onRefreshCalendar}
                  data={filteredSortedUsers}
                  keyExtractor={(item) => item.id}
                  ItemSeparatorComponent={() => <View style={styles.separator} />}
                  renderItem={({ item }) => (
                    <Pressable
                      style={styles.executorOption}
                      onPress={() => handlePickUser(item.id)}
                    >
                      <View style={[styles.executorRow, selectedUserId === item.id && styles.executorRowSelected]}>
                        <Text style={styles.executorText}>{item.name}</Text>
                        <View style={[styles.rolePill, { borderColor: roleColor(item.role)+'33', backgroundColor: roleColor(item.role)+'22' }]}>
                          <Text style={{ color: roleColor(item.role), fontSize: 12, fontWeight: '600' }}>{ROLE_LABEL_RU[item.role] || 'Исполнитель'}</Text>
                        </View>
                      </View>
                    </Pressable>
                  )}
                  style={{ maxHeight: 360 }}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                />
              </View>
            </Animated.View>
          </Pressable>
        </Modal>
        

      </View>
    </SafeAreaView>
  );
}

function getStatusMeta(status) {
  switch (status) {
    case 'В ленте': return { bg: '#FFF7CC', fg: '#8A6D1F' };
    case 'Новый': return { bg: '#E8F0FE', fg: '#0A84FF' };
    case 'В работе': return { bg: '#E9F7EF', fg: '#34C759' };
    case 'Завершённая': return { bg: '#F2F2F7', fg: '#8E8E93' };
    default: return { bg: '#EFEFEF', fg: '#111' };
  }
}
