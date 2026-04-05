import { StyleSheet, Text, View } from 'react-native';
import Checkbox from './Checkbox.jsx';
import { useTheme } from '../../theme';

export default function ConsentCheckbox({ checked, onChange, onShowPolicy }) {
  const { theme } = useTheme();
  const styles = getStyles(theme);

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

const getStyles = (theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
    text: { marginLeft: 8, flex: 1, flexWrap: 'wrap', color: theme.colors.text },
    link: { color: theme.colors.primary, textDecorationLine: 'underline' },
  });
