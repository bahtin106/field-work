// components/ui/TextField.jsx
import React, { useState, forwardRef } from "react";
import { View, Text, TextInput, StyleSheet, Platform, Modal, Pressable, Switch, FlatList, Animated, Easing } from "react-native";
import { Picker } from "@react-native-picker/picker";
import FeatherIcon from "@expo/vector-icons/Feather";
import { useTheme } from "../../theme";
import { listItemStyles, CHEVRON_GAP } from "./listItemStyles";

const TextField = forwardRef(function TextField(
  {
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType,
    secureTextEntry,
    error,
    rightSlot,
    leftSlot,
    multiline,
    numberOfLines,
    style,
    maxLength,
    autoCapitalize,
    returnKeyType,
    onSubmitEditing,
  },
  ref
) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);

  const isRequired = /\*/.test(String(label || ''));
  const requiredEmpty = isRequired && touched && !String(value || '').trim();
  const isErr = !!error || requiredEmpty;
  const s = styles(theme, isErr, focused);
  const maskRef = React.useRef(null);
  const inputRef = React.useRef(null);
  React.useImperativeHandle(ref, () => inputRef.current);
  const handleChangeText = React.useCallback((t) => {
    onChangeText?.(t);
  }, [onChangeText]);

  return (
    <View style={style}>
      {label ? (
        <Text style={s.topLabel}>{label}</Text>
      ) : null}
      <View style={s.wrap}>
        {leftSlot ? <View style={s.slot}>{leftSlot}</View> : null}
        <View style={s.inputBox}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={handleChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.inputPlaceholder}
            keyboardType={keyboardType || "default"}
            secureTextEntry={secureTextEntry}
            autoCorrect={false}
            multiline={multiline}
            numberOfLines={numberOfLines}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setTouched(true); }}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            style={[s.input, (secureTextEntry && Platform.OS === "android") ? { color: theme.colors.transparent } : null]}
            includeFontPadding={false}
            textAlignVertical="center"
          />
        </View>
        {rightSlot ? <View style={s.slot}>{rightSlot}</View> : null}
      </View>
    </View>
  );
});

export default TextField;

const styles = (t, isError, focused) =>
  StyleSheet.create({
    wrap: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isError ? t.colors.danger : (focused ? t.colors.primary : (t.colors.inputBorder || '#e0e0e0')),
      paddingHorizontal: 12,
      height: 52,
    },
    topLabel: {
      fontWeight: '500',
      marginBottom: 4,
      marginTop: 12,
      color: t.colors.textSecondary,
      fontSize: t.typography.sizes.sm,
    },
    input: {
      flex: 1,
      color: t.colors.text,
      fontSize: t.typography.sizes.md,
      paddingVertical: 10,
      paddingLeft: 0,
    },
    slot: { marginHorizontal: 4 },
    inputBox: { flex: 1, justifyContent: 'center', position: 'relative' },
  });


// Unified Settings-like select row, styled to match AppSettings.jsx rows.
// Usage:
//   <SelectField label="Роль" value="Администратор" onPress={...} />
//   <SelectField label="Звук" onPress={...} showValue={false} />
export function SelectField({
  label,
  value,
  onPress,
  right,            // optional custom right ReactNode
  showValue = true, // when false -> only chevron shown
  disabled = false,
  style,
}) {
  const { theme } = useTheme();
  const base = listItemStyles(theme);
  const s = selectStyles(theme);
  return (
    <Pressable onPress={onPress} disabled={disabled} android_ripple={disabled ? undefined : { color: theme.colors.ripple, borderless: false }}>
      <View style={[base.row, disabled && s.disabled, style]}>
        <Text style={[base.label, s.label]} numberOfLines={1}>{label}</Text>
        <View style={s.rightWrap}>
          {right ? right : (showValue ? (<Text style={[base.value, s.value]} numberOfLines={1}>{value ?? ''}</Text>) : null)}
          <FeatherIcon name="chevron-right" size={theme.components.listItem.chevronSize} color={theme.colors.textSecondary} style={s.chevron} />
        </View>
      </View>
    </Pressable>
  );
}


// Unified Settings-like switch row.
// Usage:
//   <SwitchField label="Уведомления" value={true} onValueChange={...} />
export function SwitchField({ label, value, onValueChange, disabled = false, style }) {
  const { theme } = useTheme();
  const base = listItemStyles(theme);
  return (
    <View style={[base.row, disabled && { opacity: theme.components.listItem.disabledOpacity }, style]}>
      <Text style={base.label}>{label}</Text>
      <View style={base.rightWrap}>
        <View style={base.switchWrap}>
          <Switch
            value={!!value}
            onValueChange={onValueChange}
            disabled={!!disabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
      </View>
    </View>
  );
}

const selectStyles = (t) => StyleSheet.create({
  disabled: { opacity: t.components.listItem.disabledOpacity || 0.5 },
  label: { flexShrink: 1, paddingRight: 8 },
  value: { maxWidth: 220 },
  rightWrap: { flexDirection: 'row', alignItems: 'center' },
  chevron: { marginLeft: CHEVRON_GAP },
});

const itemHeight = 36;

function range(from, to) {
  const arr = [];
  for (let i = from; i <= to; i++) arr.push(i);
  return arr;
}

const months = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const pad2 = (n) => String(n).padStart(2, "0");

export function serializeDobForSupabase(v) {
  if (!v) return { dob: null, dob_md: null };
  const md = `${pad2(v.month)}-${pad2(v.day)}`;
  const dob = v.year ? `${v.year}-${md}` : null;
  return { dob, dob_md: md };
}

export const DateOfBirthField = ({
  label = "Дата рождения",
  value,
  onChange,
  minYear = 1900,
  maxYear = new Date().getFullYear(),
  style,
}) => {
  const { theme } = useTheme();
  const isErr = false;
  const s = styles(theme, isErr, false);
  const [open, setOpen] = React.useState(false);
  const [d, setD] = React.useState(value?.day || 1);
  const [m, setM] = React.useState(value?.month || 1);
  const [y, setY] = React.useState(value?.year || maxYear);
  const [withYear, setWithYear] = React.useState(value?.year != null);
  // --- animated modal enter/exit (iOS-like) ---
  const cardScale = React.useRef(new Animated.Value(0.96)).current;
  const cardOpacity = React.useRef(new Animated.Value(0)).current;
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;

  const animateIn = React.useCallback(() => {
    cardScale.setValue(0.96);
    cardOpacity.setValue(0);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(cardScale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 8 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [cardScale, cardOpacity, backdropOpacity]);

  const closeModal = React.useCallback(() => {
    Animated.parallel([
      Animated.timing(cardScale, { toValue: 0.98, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) setOpen(false); else setOpen(false); });
  }, [cardScale, cardOpacity, backdropOpacity]);


  const years = React.useMemo(() => range(minYear, maxYear).reverse(), [minYear, maxYear]);
  const daysInMonth = (mm, yy) => new Date(yy || 2000, mm, 0).getDate();
  const maxD = daysInMonth(m, withYear ? y : 2000);
  React.useEffect(() => { if (d > maxD) setD(maxD); }, [m, y, withYear]);  

  const display = () => {
    if (!d || !m) return "";
    const base = `${pad2(d)} ${months[m-1]}`;
    return withYear ? `${base}, ${y}` : base;
  };

  const onDone = () => {
    const out = { day: d, month: m, year: withYear ? y : null };
    onChange?.(out);
    setOpen(false);
  };

  // Render wheel column (FlatList with snap)
  const Wheel = ({ data, selected, setSelected, disabled }) => {
    const listRef = React.useRef(null);
    React.useEffect(() => {
      const idx = data.indexOf(selected);
      if (idx >= 0) listRef.current?.scrollToIndex?.({ index: idx, animated: false });
    }, []);
    const onViewableItemsChanged = React.useRef(({ viewableItems }) => {
      const center = viewableItems.find(v => v.index != null && v.isViewable);
      if (center && center.item != null) setSelected(center.item);
    }).current;
    const getItemLayout = (_, index) => ({ length: itemHeight, offset: itemHeight * index, index });
    return (
      <View style={[wheelStyles.col, disabled && { opacity: 0.35 }]}>
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(it) => String(it)}
          getItemLayout={getItemLayout}
          initialNumToRender={20}
          showsVerticalScrollIndicator={false}
          snapToInterval={itemHeight}
          decelerationRate="fast"
          viewabilityConfig={{ itemVisiblePercentThreshold: 99 }}
          onViewableItemsChanged={onViewableItemsChanged}
          renderItem={({ item }) => (
            <View style={wheelStyles.item}>
              <Text style={[wheelStyles.itemText, { color: theme.colors.text }]}>{item}</Text>
            </View>
          )}
        />
        <View style={[wheelStyles.selectionLine, { borderColor: theme.colors.inputBorder || '#e0e0e0' }]} />
      </View>
    );
  };

  return (
    <View style={style}>
      <Pressable onPress={() => { setOpen(true); setTimeout(animateIn, 0); }}>
        <View style={s.wrap}>
          <Text style={s.floatingLabel}>{label}</Text>
          <View style={s.inputBox}>
            <Text style={[s.input, { paddingVertical: 10, color: theme.colors.text }]}>{display()}</Text>
          </View>
        </View>
      </Pressable>

      <Modal transparent visible={open} animationType="none" onRequestClose={closeModal}>
        <Animated.View style={[modalStyles.backdrop, { backgroundColor: theme.colors.overlay, opacity: backdropOpacity }]} />
        <View style={[modalStyles.center]}>
          <Animated.View style={[modalStyles.card, { backgroundColor: theme.colors.surface, opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
            <Text style={[modalStyles.title, { color: theme.colors.text }]}>Выберите дату</Text>

            
            <View style={modalStyles.wheelsRow}>
              {Platform.OS === 'ios' ? (
                <>
                  <View style={modalStyles.pickerCol}>
                    <Picker
                      selectedValue={d}
                      onValueChange={(v)=>setD(v)}
                      itemStyle={{fontSize:18}}
                    >
                      {Array.from({length: daysInMonth(m, withYear ? y : 2000)}, (_,i)=>i+1).map(v=>(
                        <Picker.Item key={v} label={String(v)} value={v} />
                      ))}
                    </Picker>
                  </View>
                  <View style={modalStyles.pickerCol}>
                    <Picker
                      selectedValue={m}
                      onValueChange={(v)=>setM(v)}
                      itemStyle={{fontSize:18}}
                    >
                      {months.map((name,idx)=>(
                        <Picker.Item key={idx+1} label={name} value={idx+1} />
                      ))}
                    </Picker>
                  </View>
                  <View style={[modalStyles.pickerCol, !withYear && {opacity:0.35}]}>
                    <Picker
                      enabled={withYear}
                      selectedValue={y}
                      onValueChange={(v)=>setY(v)}
                      itemStyle={{fontSize:18}}
                    >
                      {years.map(v=>(
                        <Picker.Item key={v} label={String(v)} value={v} />
                      ))}
                    </Picker>
                  </View>
                </>
              ) : (
                <>
                  <Wheel data={Array.from({length: daysInMonth(m, withYear ? y : 2000)}, (_, i) => i + 1)} selected={d} setSelected={setD} />
                  <Wheel data={months.map((_, i) => i+1)} selected={m} setSelected={setM} />
                  <Wheel data={years} selected={y} setSelected={setY} disabled={!withYear} />
                </>
              )}
            </View>

            <View style={modalStyles.switchRow}>
              <Text style={[modalStyles.switchLabel, { color: theme.colors.textSecondary }]}>Указать год</Text>
              <Switch value={withYear} onValueChange={setWithYear} />
            </View>

            <View style={modalStyles.actions}>
              <Pressable onPress={closeModal} style={modalStyles.btn}>
                <Text style={[modalStyles.btnText, { color: theme.colors.textSecondary }]}>Отмена</Text>
              </Pressable>
              <Pressable onPress={onDone} style={modalStyles.btn}>
                <Text style={[modalStyles.btnText, { color: theme.colors.primary }]}>Готово</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
};

const wheelStyles = StyleSheet.create({
  col: { width: 92, height: 180, overflow: "hidden" },
  item: { height: itemHeight, alignItems: "center", justifyContent: "center" },
  itemText: { fontSize: 18 },
  selectionLine: {
    position: "absolute", left: 8, right: 8, top: (180 - itemHeight)/2, height: itemHeight,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

const modalStyles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, borderRadius: 14, paddingVertical: 12 },
  title: { fontSize: 16, fontWeight: "600", textAlign: "center", marginBottom: 8 },
  wheelsRow: { flexDirection: "row", justifyContent: "space-evenly", paddingHorizontal: 12, paddingBottom: 8 },
  actions: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6, paddingTop: 6 },
  btn: { padding: 10, flex: 1, alignItems: "center" },
  btnText: { fontSize: 16, fontWeight: "600" },
});

