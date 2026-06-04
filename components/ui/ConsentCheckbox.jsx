import { StyleSheet, Text, View } from 'react-native';
import Checkbox from './Checkbox.jsx';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

export default function ConsentCheckbox({ checked, onChange, onShowPolicy }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const styles = getStyles(theme);

  return (
    <View style={styles.row}>
      <Checkbox value={checked} onValueChange={onChange} />
      <Text style={styles.text}>
        {t('consent_prefix')}
        <Text style={styles.link} onPress={onShowPolicy}>
          {' '}
          {t('consent_privacy_link')}
        </Text>
        {' '}
        {t('consent_suffix')}
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
