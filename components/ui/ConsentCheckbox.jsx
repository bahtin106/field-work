import { StyleSheet, Text, View } from 'react-native';
import Checkbox from './Checkbox.jsx';

export default function ConsentCheckbox({ checked, onChange, onShowPolicy }) {
  return (
    <View style={styles.row}>
      <Checkbox value={checked} onValueChange={onChange} />
      <Text style={styles.text}>
        Я соглашаюсь с
        <Text style={styles.link} onPress={onShowPolicy}>
          {' '}
          Политикой конфиденциальности
        </Text>
        и разрешаю обработку моих персональных данных
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  text: { marginLeft: 8, flex: 1, flexWrap: 'wrap' },
  link: { color: '#1976d2', textDecorationLine: 'underline' },
});
