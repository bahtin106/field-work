import { Pressable, StyleSheet, View } from 'react-native';

export default function Checkbox({ value, onValueChange }) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      style={[styles.box, value && styles.boxChecked]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
    >
      {value ? <View style={styles.inner} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#1976d2',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  boxChecked: {
    borderColor: '#1976d2',
    backgroundColor: '#e3f2fd',
  },
  inner: {
    width: 12,
    height: 12,
    backgroundColor: '#1976d2',
    borderRadius: 2,
  },
});
