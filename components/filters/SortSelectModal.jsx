import { useTranslation } from '../../src/i18n/useTranslation';
import SelectModal from '../ui/modals/SelectModal';

export default function SortSelectModal({
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
      title={title || t('sort_modal_title')}
      searchable={false}
      items={options}
      selectedId={value}
      onSelect={(item) => {
        onChange?.(item?.id);
        onClose?.();
      }}
      maxHeightRatio={0.7}
    />
  );
}
