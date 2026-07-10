import { View } from 'react-native';
import CardContext from './CardContext';
import { getSeparatedRows, interleaveSeparators } from './separatedChildren';

export default function SeparatedList({ children, style }) {
  const rows = getSeparatedRows(children);

  return (
    <CardContext.Provider value={{ labelCount: rows.length, rowCount: rows.length }}>
      <View style={style}>{interleaveSeparators(rows)}</View>
    </CardContext.Provider>
  );
}
