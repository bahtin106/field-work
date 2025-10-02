// apps/field-work/constants/strings.js
export const strings = {
  settingsTitle: 'Настройки компании',
  sections: {
    company: {
      title: 'Компания',
      items: {
        timezone: 'Часовой пояс',
        employees: 'Сотрудники',
        billing: 'Подписка и оплата',
      },
    },
    management: {
      title: 'Управление',
      items: {
        notifications: 'Уведомления',
        access: 'Настройки доступа',
        form_builder: 'Редактор полей',
        work_types: 'Виды работ',
        departments: 'Отделы',
      },
    },
    departure: {
      title: 'Параметры выезда',
      toggles: { useDepartureTime: 'Включить время выезда' },
      helperText: {
        departureOn: 'Дата и время выезда',
        departureOff: 'Только дата выезда',
      },
    },
    phone: {
      title: 'Телефон для рабочих',
      items: {
        phoneMode: 'Показывать номер',
        windowBefore: 'За сколько часов до выезда',
        windowAfter: 'Сколько часов после выезда',
      },
    },
  },
  modals: {
    timezone: {
      title: 'Выберите часовой пояс',
      subtitleDevice: 'Текущий часовой пояс устройства',
      searchable: true,
    },
    phoneMode: {
      title: 'Показ номера телефона',
      options: {
        always: 'Всегда',
        never: 'Никогда',
        window: 'Только в интервале',
      },
      searchable: false,
    },
  },
};
