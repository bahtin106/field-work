import { useContext } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';
import { listItemStyles } from './listItemStyles';
import CardContext from './CardContext';

export default function ListSeparator({ style }) {
  const { theme } = useTheme();
  const base = listItemStyles(theme);
  const { labelCount } = useContext(CardContext) || { labelCount: 0 };

  // Hide separator when the card contains exactly one label/value row —
  // this avoids an unnecessary divider under the single row.
  if (labelCount <= 1) return null;

  return <View style={[base.sep, style]} />;
}
