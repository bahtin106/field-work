import { useTranslation } from '../../src/i18n/useTranslation';
import SelectModal from '../ui/modals/SelectModal';

export default function StatusSelectModal({
  visible,
  onClose,
  options = [],
  value,
  onChange,
  title,
}) {
  const { t } = useTranslation();

  return (
    <SelectModal
      visible={visible}
      onClose={onClose}
      title={title || t('orders_filter_status')}
      searchable={false}
      items={options}
      selectedId={value}
      onSelect={(item) => {
        onChange?.(item?.id);
        onClose?.();
      }}
      maxHeightRatio={0.7}
      itemTitleNumberOfLines={2}
      multilineItems
    />
  );
}
