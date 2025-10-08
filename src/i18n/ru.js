// src/i18n/ru.js
export default {
  // Названия страниц приложения (используются AppHeader/getRouteTitle)
  routes: {
    'settings':         'Настройки компании',
    'settings/index':   'Настройки компании',
    'orders':           'Заявки',
    'orders/index':     'Заявки',
    'orders/my-orders': 'Мои заявки',
    'orders/all-orders':'Все заявки',
    'orders/calendar':  'Календарь',
    'users':            'Сотрудники',
    'users/[id]':       'Пользователь',
    'users/[id]/edit':  'Редактирование',
    '(auth)/sign-in':   'Вход',
    'app_settings/AppSettings': 'Настройки приложения',
  },

  // Кнопки
  btn_edit: 'Изменить',
  btn_ok: 'ОК',
  btn_cancel: 'Отмена',
  btn_close: 'Закрыть',
  btn_done: 'Готово',
  btn_apply: 'Применить',
  btn_save: 'Сохранить',
  btn_delete: 'Удалить',
  btn_suspend: 'Отстранить',
  btn_deleting: 'Удаляю…',
  btn_applying: 'Применяю…',

  // Просмотр профиля (app/users/[id])
  // Роли
  role_dispatcher: 'Диспетчер',
  role_worker: 'Рабочий',
  role_admin: 'Администратор',

  // Описания ролей
  role_desc_dispatcher: 'Назначение и управление заявками.',
  role_desc_worker: 'Выполнение заявок, без админ-прав.',
  role_desc_admin: 'Управление пользователями, настройка компании.',

  // Секции
  section_personal: 'Личные данные',
  section_company_role: 'Роль в компании',
  section_password: 'Новый пароль (мин. 6 символов)',

  // Лейблы полей
  view_label_name: 'Имя',
  view_label_email: 'E-mail',
  view_label_phone: 'Телефон',
  label_first_name: 'Имя *',
  label_last_name: 'Фамилия *',
  label_email: 'Электронная почта *',
  label_department: 'Отдел',
  label_role: 'Роль',
  label_status: 'Статус',
  label_birthdate: 'Дата рождения',

  // Плейсхолдеры
  placeholder_birthdate: 'Выберите дату',
  placeholder_department: 'Без отдела',
  placeholder_no_name: 'Без имени',
  placeholder_first_name: 'Иван',
  placeholder_last_name: 'Петров',
  placeholder_email: 'ivan.petrov@example.com',
  placeholder_new_password: 'Введите новый пароль',

  // Доступность (a11y)
  a11y_copy_email: 'Скопировать e-mail',
  a11y_copy_phone: 'Скопировать телефон',
  a11y_change_avatar: 'Изменить фото профиля',
  a11y_change_avatar_hint: 'Нажмите, чтобы загрузить или изменить фото',
  a11y_copy_password: 'Скопировать пароль',
  a11y_show_password: 'Показать пароль',
  a11y_hide_password: 'Скрыть пароль',

  // Ошибки/подсказки
  errors_openMail: 'Невозможно открыть почтовый клиент',
  errors_callsUnavailable: 'Звонки недоступны на этом устройстве',
  errors_loadUser: 'Не удалось загрузить пользователя',
  err_first_name: 'Укажите имя',
  err_last_name: 'Укажите фамилию',
  err_email: 'Укажите корректный e-mail',
  err_phone: 'Телефон должен быть в формате +7 9XX XXX-XX-XX',
  err_password_short: 'Пароль должен быть не короче 6 символов',
  err_successor_required: 'Выберите правопреемника',
  err_unsuspend_failed: 'Не удалось снять отстранение',

  // Диалоги/кнопки
  dlg_alert_title: 'Внимание',
  dlg_generic_warning: 'Что-то пошло не так',
  dlg_leave_title: 'Выйти без сохранения?',
  dlg_leave_msg: 'Все изменения будут потеряны. Вы уверены?',
  dlg_leave_confirm: 'Выйти',
  dlg_leave_cancel: 'Остаться',
  dlg_confirm_pwd_title: 'Обновить пароль пользователя?',
  dlg_confirm_pwd_msg: 'Вы изменяете пароль. Сохранить изменения?',
  dlg_unsuspend_title: 'Снять отстранение?',
  dlg_unsuspend_msg: 'Сотрудник снова сможет пользоваться приложением.',
  dlg_unsuspend_confirm: 'Снять отстранение',
  dlg_unsuspend_apply: 'Применяю…',
  
  // Тосты/статусы
  toast_email_copied: 'E-mail скопирован',
  toast_phone_copied: 'Телефон скопирован',
  toast_generic_error: 'Не удалось выполнить действие',
  toast_suspended: 'Сотрудник отстранён',
  toast_unsuspended: 'Отстранение снято',
  toast_deleted: 'Сотрудник удалён',
  toast_saving: 'Сохраняю…',
  toast_password_copied: 'Пароль скопирован',

  // Статусы
  status_active: 'Активен',
  status_suspended: 'Отстранён',

  // Прочее
  common_dash: '—',
  common_search: 'Поиск',
  common_start_typing: 'Начните вводить…',
  picker_department_title: 'Выбор отдела',
  picker_role_title: 'Выбор роли',
  action_take_photo: 'Сделать фото',
  action_pick_photo: 'Выбрать из галереи',
  action_delete_photo: 'Удалить фото',
  title_profile_photo: 'Фото профиля',
  dlg_suspend_title: 'Отстранить сотрудника?',
  dlg_suspend_message: 'Выберите, что сделать с его заявками.',
  dlg_suspend_keep: 'Оставить как есть',
  dlg_suspend_reassign: 'Переназначить на сотрудника',
  field_successor: 'Правопреемник',
  placeholder_pick_employee: 'Выберите сотрудника',
  dlg_delete_title: 'Удалить сотрудника?',
  dlg_delete_msg: 'Необходимо выбрать правопреемника, чтобы переназначить все его заявки.',
  datetime_omit_year: 'Указать год',
  datetime_tab_date: 'Дата',
  datetime_tab_time: 'Время',
  modal_select_title: 'Выберите',
  picker_user_title: 'Выбор сотрудника',
  error_no_access: 'Доступ только для администратора',

  // Настройки приложения (app/app_settings/AppSettings)
  // Общие
  common_off: 'Выключено',
  // Ошибки (AppSettings)
  errors_loadSettings: 'Не удалось загрузить настройки',
  errors_saveGeneric: 'Не удалось сохранить изменения',
  errors_noSettingsAccess: 'Нет прав доступа к настройкам',
  errors_rls: 'Недостаточно прав (RLS)',
  errors_network: 'Нет соединения с сервером',
  errors_saveShort: 'Не удалось сохранить',
  errors_noAuth: 'Нет авторизации. Войдите снова.',
  errors_noAuthShort: 'Нет авторизации',

  // Push-уведомления
  push_saveTokenFail: 'Не удалось сохранить токен',
  push_onStandalone: 'Уведомления включены (только для standalone версии)',
  push_off: 'Уведомления выключены',
  push_noPermission: 'Нет разрешения на уведомления. Разрешите в настройках.',
  push_permissionGranted: 'Разрешение дано. Токен будет получен в dev/прод билде.',
  push_on: 'Уведомления включены',

  // Тихие часы
  quiet_pickEnd: 'Выберите конец тихих часов',
  quiet_pickStart: 'Выберите начало тихих часов',
  quiet_saveFail: 'Не удалось сохранить',
  quiet_off: 'Тихие часы выключены',
  quiet_range: 'Тихие часы: ',

  // Секции настроек
  settings_soon: 'Будет добавлено в будущем',

  // Оформление
  settings_sections_appearance_title: 'Оформление',
  settings_sections_appearance_items_theme: 'Тема',
  settings_sections_appearance_items_language: 'Язык',
  'settings_sections_appearance_items_bold-text': 'Жирный текст',

  // Уведомления
  settings_sections_notifications_title: 'Уведомления',
  settings_sections_notifications_items_allow: 'Разрешить уведомления',
  settings_sections_notifications_items_sounds: 'Звуки',
  settings_sections_notifications_items_events: 'События',

  // Тихие часы
  settings_sections_quiet_title: 'Тихие часы',
  settings_sections_quiet_items_quiet_start: 'Начало',
  settings_sections_quiet_items_quiet_end: 'Конец',
  settings_sections_quiet_items_quiet_reset: 'Сбросить',

  // Приватность
  settings_sections_privacy_title: 'Приватность',
  settings_sections_privacy_items_geo: 'Геолокация',
  settings_sections_privacy_items_analytics: 'Аналитика',
  'settings_sections_privacy_items_private-search': 'Приватный поиск',

  // ИИ
  settings_sections_ai_title: 'ИИ',
  settings_sections_ai_items_suggestions: 'Предложения',
  settings_sections_ai_items_avatars: 'Аватары',

  // Выбор языка
  settings_language_title: 'Язык интерфейса',
  language_ru: 'Русский',
  language_en: 'Английский',

  // Список событий
  settings_events_title: 'Включённые события',
  settings_events_newOrders: 'Новые заявки',
  settings_events_feedOrders: 'Заявки в ленте',
  settings_events_reminders: 'Напоминать о незабранных',

  // Выбор темы
  settings_theme_title: 'Выберите тему',
  settings_theme_light: 'Светлая',
  settings_theme_dark: 'Тёмная',
  settings_theme_system: 'Системная',

  // Компания
  company_settings_title: 'Настройки компании',

  company_settings_sections_company_title: 'Компания',
  company_settings_sections_company_items_timezone: 'Часовой пояс',
  company_settings_sections_company_items_employees: 'Сотрудники',
  company_settings_sections_company_items_billing: 'Подписка и оплата',

  company_settings_sections_management_title: 'Управление',
  company_settings_sections_management_items_notifications: 'Уведомления',
  company_settings_sections_management_items_access: 'Настройки доступа',
  company_settings_sections_management_items_form_builder: 'Редактор полей',
  company_settings_sections_management_items_work_types: 'Виды работ',
  company_settings_sections_management_items_departments: 'Отделы',

  company_settings_sections_departure_title: 'Параметры выезда',
  company_settings_sections_departure_toggles_useDepartureTime: 'Включить время выезда',
  company_settings_sections_departure_helperText_departureOn: 'Дата и время выезда',
  company_settings_sections_departure_helperText_departureOff: 'Только дата выезда',

  company_settings_sections_phone_title: 'Телефон для рабочих',
  company_settings_sections_phone_items_phoneMode: 'Показывать номер',
  company_settings_sections_phone_items_windowBefore: 'За сколько часов до выезда',
  company_settings_sections_phone_items_windowAfter: 'Сколько часов после выезда',

  company_settings_modals_timezone_title: 'Выберите часовой пояс',
  company_settings_modals_timezone_subtitleDevice: 'Текущий часовой пояс устройства',

  company_settings_modals_phoneMode_title: 'Показ номера телефона',
  company_settings_modals_phoneMode_options_always: 'Всегда',
  company_settings_modals_phoneMode_options_never: 'Никогда',
  company_settings_modals_phoneMode_options_window: 'Только в интервале',
  fields_phone: 'Телефон',
  fields_dob: 'Дата рождения',
  toast_loading: 'Сохраняю…',
  toast_success: 'Сохранено',
  toast_error: 'Не удалось выполнить действие',
};
