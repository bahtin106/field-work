// src/i18n/ru.js
export default {
  // Названия страниц приложения (используются AppHeader/getRouteTitle)
  routes: {
    settings: 'Настройки компании',
    'settings/index': 'Настройки компании',
    orders: 'Заявки',
    'orders/index': 'Заявки',
    'orders/[id]': 'Заявка',
    'orders/edit/[id]': 'Редактирование',
    'orders/my-orders': 'Мои заявки',
    'orders/all-orders': 'Все заявки',
    'orders/calendar': 'Календарь',
    users: 'Сотрудники',
    'users/[id]': 'Пользователь',
    'users/[id]/edit': 'Редактирование',
    'users/new': 'Новый сотрудник',
    '(auth)/sign-in': 'Вход',
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
  btn_delete_employee: 'Удалить пользователя',
  btn_login: 'Войти',
  btn_create: 'Создать',
  btn_create_employee: 'Создать сотрудника',
  btn_choose: 'Выбрать',
  header_cancel: 'Закрыть',
  header_save: 'Сохранить',

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
  section_password: 'Пароль',
  section_password_template: 'Пароль (мин. {n} символов)',

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
  label_password_new: 'Новый пароль *',
  label_password_repeat: 'Повтор пароля *',

  // Плейсхолдеры
  placeholder_birthdate: 'Выберите дату',
  placeholder_department: 'Без отдела',
  placeholder_no_name: 'Без имени',
  placeholder_first_name: 'Иван',
  placeholder_last_name: 'Петров',
  placeholder_email: 'ivan.petrov@example.com',
  placeholder_new_password: 'Введите новый пароль',
  placeholder_repeat_password: 'Повторите пароль',

  // Доступность (a11y)
  a11y_copy_email: 'Скопировать e-mail',
  a11y_copy_phone: 'Скопировать телефон',
  a11y_change_avatar: 'Изменить фото профиля',
  a11y_change_avatar_hint: 'Нажмите, чтобы загрузить или изменить фото',
  a11y_copy_password: 'Скопировать пароль',
  a11y_show_password: 'Показать пароль',
  a11y_hide_password: 'Скрыть пароль',
  profile_photo_title: 'Фото профиля',
  profile_photo_take: 'Сделать фото',
  profile_photo_choose: 'Выбрать из галереи',
  profile_photo_delete: 'Удалить фото',

  // Ошибки/подсказки
  errors_openMail: 'Невозможно открыть почтовый клиент',
  errors_callsUnavailable: 'Звонки недоступны на этом устройстве',
  errors_loadUser: 'Не удалось загрузить пользователя',
  errors_invalid_credentials: 'Неверный e-mail или пароль',
  errors_auth_error: 'Ошибка авторизации',
  err_required_fields: 'Укажите необходимые данные',
  err_first_name: 'Укажите имя',
  err_last_name: 'Укажите фамилию',
  err_email: 'Укажите корректный e-mail',
  err_email_invalid_format: 'Неверный формат e-mail',
  err_phone: 'Телефон должен быть в формате +7 9XX XXX-XX-XX',
  err_password_short: 'Пароль должен быть не короче 8 символов',
  err_password_invalid_chars:
    'Пароль содержит недопустимые символы. Используйте только латинские буквы, цифры и спецсимволы',
  err_password_mismatch: 'Пароли не совпадают',
  err_successor_required: 'Выберите правопреемника',
  err_unsuspend_failed: 'Не удалось снять отстранение',
  error_camera_denied: 'Нет доступа к камере',
  error_library_denied: 'Нет доступа к медиатеке',
  error_email_exists: 'Пользователь с таким e-mail уже существует',
  error_profile_not_updated: 'Не удалось обновить профиль пользователя',
  error_password_too_short: 'Пароль должен быть не короче 8 символов',
  error_invalid_role: 'Неверная роль пользователя',
  error_auth_failed: 'Не удалось создать пользователя',
  warn_checking_email: 'Проверяем доступность email...',
  warn_email_already_taken: 'Этот e-mail уже зарегистрирован',

  // Диалоги/кнопки
  dlg_alert_title: 'Внимание',
  dlg_generic_warning: 'Что-то пошло не так',
  dlg_leave_title: 'Выйти без сохранения?',
  dlg_leave_msg: 'Все изменения будут потеряны. Вы уверены?',
  dlg_leave_confirm: 'Выйти',
  dlg_leave_cancel: 'Остаться',
  dlg_confirm_pwd_title: 'Обновить пароль пользователя?',
  dlg_confirm_pwd_msg: 'Вы изменяете пароль. Сохранить изменения?',
  dlg_ok: 'ОК',
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
  toast_avatar_updated: 'Аватар обновлён',
  toast_avatar_pending: 'Изменения аватара будут сохранены при нажатии "Сохранить"',

  // Статусы
  status_active: 'Активен',
  status_suspended: 'Отстранён',

  // Прочее
  common_dash: '—',
  common_search: 'Поиск',
  common_start_typing: 'Начните вводить…',

  // Авторизация
  login_title: 'Монитор',
  login_subtitle: 'Введите ваши учётные данные',
  login_no_account: 'Нет аккаунта?',
  auth_hide_password: 'Скрыть пароль',
  auth_show_password: 'Показать пароль',

  // Регистрация
  register_title: 'Регистрация',
  register_subtitle: 'Создайте свой аккаунт',
  register_button: 'Зарегистрироваться',
  register_back_to_login: 'Уже есть аккаунт? Войти',
  register_section_account_type: 'Тип аккаунта',
  register_label_password: 'Пароль *',
  register_placeholder_password: 'Введите пароль',
  register_account_solo: 'Работаю один',
  register_account_solo_desc: 'Личный аккаунт без создания компании',
  register_account_company: 'У меня компания',
  register_account_company_desc: 'Создать компанию и управлять сотрудниками',
  register_company_name: 'Название компании *',
  register_company_name_placeholder: 'ООО «Пример»',
  register_error_account_type: 'Выберите тип аккаунта',
  register_error_company_name: 'Укажите название компании',
  register_success: 'Регистрация успешна!',
  register_success_please_login: 'Регистрация успешна! Войдите в систему',
  register_link: 'Зарегистрироваться',

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

  // Календарь: режимы просмотра
  calendar_view_year: 'Год',
  calendar_view_month: 'Месяц',
  calendar_view_week: 'Неделя',
  calendar_view_day: 'День',
  calendar_view_schedule: 'Расписание',
  calendar_toggle: 'Переключить размер календаря',

  // Календарь: названия месяцев (полные)
  month_january: 'Январь',
  month_february: 'Февраль',
  month_march: 'Март',
  month_april: 'Апрель',
  month_may: 'Май',
  month_june: 'Июнь',
  month_july: 'Июль',
  month_august: 'Август',
  month_september: 'Сентябрь',
  month_october: 'Октябрь',
  month_november: 'Ноябрь',
  month_december: 'Декабрь',

  // Календарь: названия дней недели (короткие, 2 буквы)
  day_short_mo: 'Пн',
  day_short_tu: 'Вт',
  day_short_we: 'Ср',
  day_short_th: 'Чт',
  day_short_fr: 'Пт',
  day_short_sa: 'Сб',
  day_short_su: 'Вс',

  datetime_tab_time: 'Время',
  modal_select_title: 'Выберите',
  picker_user_title: 'Выбор сотрудника',
  user_department_title: 'Выберите отдел',
  user_role_title: 'Выберите роль в компании',
  user_changeStatus_title: 'Изменение статуса',
  user_block_keepOrders: 'Оставить заявки как есть',
  user_block_reassign: 'Переназначить заявки',
  error_no_access: 'Доступ только для администратора',
  user_delete_title: 'Удаление пользователя',
  user_delete_needSuccessor: 'Нужно придумать описание',
  user_delete_confirm_title: 'Удалить сотрудника?',
  user_delete_confirm_message: 'Все заявки будут переназначены выбранному сотруднику. Продолжить?',

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
  fields_email: 'E-mail',
  fields_password: 'Пароль',
  toast_loading: 'Сохраняю…',
  toast_success: 'Сохранено',
  toast_error: 'Не удалось выполнить действие',

  // Company Settings — generated keys

  'routes.company_settings': 'Настройки компании',
  'routes.users/new': 'Новый сотрудник',
  'routes.users/[id]/edit': 'Редактирование',
  settings_sections_company_title: 'Компания',
  settings_sections_management_title: 'Управление',
  settings_sections_departure_title: 'Параметры выезда',
  settings_sections_phone_title: 'Телефон для рабочих',
  'fields.company_name': 'Название компании',
  'placeholders.company_name_example': 'ООО «Пример»',
  'hints.company_name_visible': 'Название будет видно сотрудникам и в документах',
  common_specify: 'Указать',
  settings_company_timezone: 'Часовой пояс',
  settings_company_users: 'Сотрудники',
  settings_company_billing: 'Подписка и оплата',
  settings_company_roles: 'Роли и доступы',
  settings_management_access: 'Настройки доступа',
  settings_management_notifications: 'Уведомления',
  settings_management_form_builder: 'Редактор полей',
  settings_management_work_types: 'Виды работ',
  settings_management_departments: 'Отделы',
  settings_departure_useDepartureTime: 'Включить время выезда',
  settings_departure_on: 'Дата и время выезда',
  settings_departure_off: 'Только дата выезда',
  settings_phone_mode: 'Показывать номер',
  settings_phone_mode_always: 'Всегда',
  settings_phone_mode_never: 'Никогда',
  settings_phone_mode_window: 'Только в интервале',
  settings_phone_mode_off: 'Никогда',
  settings_phone_windowBefore: 'За сколько часов до выезда',
  settings_phone_windowAfter: 'Сколько часов после выезда',
  modal_company_title: 'Название компании',
  modal_timezone_title: 'Выберите часовой пояс',
  modal_phoneMode_title: 'Показывать номер телефона',
  timezone_subtitle_device: 'Текущий часовой пояс устройства',
  btn_saving: 'Сохраняю…',
  errors_companyName_required: 'Укажите название компании',
  errors_companyName_tooLong: 'Слишком длинное название (макс. 64)',
  errors_noDb: 'Нет подключения к базе',
  errors_companyNotFound: 'Компания не найдена',
  toast_companyNameSaved: 'Название компании сохранено',
  toast_timezoneSaved: 'Часовой пояс обновлён',
  toast_settingsSaved: 'Настройки сохранены',

  fields_company_name: 'Название компании',

  hints_company_name_visible: 'Название будет видно сотрудникам и в документах',

  // Added keys for company settings interval
  'routes.settings': 'Настройки компании',
  'routes.settings/index': 'Настройки компании',
  time_unit_minutes: 'минуты',
  time_unit_hours: 'часы',
  time_unit_days: 'дни',
  modal_phoneWindow_title: 'Интервал показа телефона',
  phone_window_before: 'Показывать за',
  phone_window_after: 'Показывать после',
  modal_pick_unit: 'Единицы',
  common_value: 'Значение',
  common_unit: 'Единицы',
  phone_window_hint_with_time: 'Отсчёт идёт от даты и точного времени выезда.',
  phone_window_hint_date_only: 'Время выезда выключено — считаем по дате (конец дня).',
  phone_window_hint_tz: 'Все расчёты ведутся по часовому поясу компании.',

  // Users index (flat keys for t('...') in app/users/index.jsx)
  routes_users_index: 'Сотрудники',
  routes_orders_calendar: 'Календарь',
  users_search_placeholder: 'Поиск сотрудника',
  users_allDepartments: 'Все отделы',
  users_department: 'Отдел',
  users_role: 'Роль',
  users_suspended: 'Состояние',
  users_showAll: 'Все',
  users_onlySuspended: 'Отстраненные',
  users_withoutSuspended: 'Без отстраненных',
  common_noData: 'Нет данных',
  common_filter: 'Фильтры',
  common_close: 'Закрыть',
  users_filterByDepartment: 'Фильтр по отделу',
  users_found: 'Найдено',
  users_total: 'Всего',
  users_openUser: 'Открыть сотрудника',
  empty_noData: 'Нет данных',
  empty_noResults: 'Ничего не найдено',
  common_clear: 'Очистить',
  common_noName: 'Без имени',
  common_select: 'Выбрать',
  errors_loadUsers: 'Не удалось загрузить список сотрудников',
  users_online: 'В сети',
  users_lastSeen_prefix: 'Был(а) в сети:',
  users_lastLogin_never: 'никогда',
  common_at: 'в',

  // Relative time format for last seen - правильное склонение числительных
  users_relativeTime_now: 'сейчас',
  users_relativeTime_ago: 'назад',

  // Минуты: 1 минуту, 2 минуты, 5 минут, 22 минуты
  users_relativeTime_min_1: 'минуту', // 1, 21, 31, 41...
  users_relativeTime_min_2_4: 'минуты', // 2-4, 22-24, 32-34...
  users_relativeTime_min_5: 'минут', // 0, 5-20, 25-30...

  // Часы: 1 час, 2 часа, 5 часов, 22 часа
  users_relativeTime_hour_1: 'час', // 1, 21, 31...
  users_relativeTime_hour_2_4: 'часа', // 2-4, 22-24...
  users_relativeTime_hour_5: 'часов', // 0, 5-20, 25-30...

  // Дни: 1 день, 2 дня, 5 дней
  users_relativeTime_day_1: 'день', // 1, 21, 31...
  users_relativeTime_day_2_4: 'дня', // 2-4, 22-24...
  users_relativeTime_day_5: 'дней', // 0, 5-20, 25-30...

  // Месяцы (для DateTimeModal и других компонентов)
  // months_short — короткие названия (индекс 0 = январь)
  // Месяцы (для DateTimeModal и других компонентов)
  // months_short — короткие названия (индекс 0 = январь)
  months_short_0: 'янв',
  months_short_1: 'фев',
  months_short_2: 'мар',
  months_short_3: 'апр',
  months_short_4: 'май',
  months_short_5: 'июн',
  months_short_6: 'июл',
  months_short_7: 'авг',
  months_short_8: 'сен',
  months_short_9: 'окт',
  months_short_10: 'ноя',
  months_short_11: 'дек',
  // months_genitive — для вывода типа "1 января"
  months_genitive_0: 'января',
  months_genitive_1: 'февраля',
  months_genitive_2: 'марта',
  months_genitive_3: 'апреля',
  months_genitive_4: 'мая',
  months_genitive_5: 'июня',
  months_genitive_6: 'июля',
  months_genitive_7: 'августа',
  months_genitive_8: 'сентября',
  months_genitive_9: 'октября',
  months_genitive_10: 'ноября',
  months_genitive_11: 'декабря',
  // months_nominative — для вывода типа "Январь"
  months_nominative_0: 'Январь',
  months_nominative_1: 'Февраль',
  months_nominative_2: 'Март',
  months_nominative_3: 'Апрель',
  months_nominative_4: 'Май',
  months_nominative_5: 'Июнь',
  months_nominative_6: 'Июль',
  months_nominative_7: 'Август',
  months_nominative_8: 'Сентябрь',
  months_nominative_9: 'Октябрь',
  months_nominative_10: 'Ноябрь',
  months_nominative_11: 'Декабрь',
  // Сдвиг меток месяцев. По умолчанию 0 — порядок в months_short / months_genitive
  // При необходимости можно установить e.g. 11 чтобы сдвинуть метки на -1.
  month_label_offset: 0,
  common_bullet: ' • ',

  // Просмотр заявки (app/orders/[id].jsx)
  order_details_back: 'Назад',
  order_details_edit: 'Редактировать',
  order_details_general_data: 'Общие данные',
  order_details_status: 'Статус',
  order_details_executor: 'Исполнитель',
  order_details_not_assigned: 'не назначен',
  order_details_customer: '🧑‍💼 Заказчик',
  order_details_address: '📍 Адрес',
  order_details_address_not_specified: 'Адрес не указан',
  order_details_work_type: '🏷️ Тип работ',
  order_details_work_type_not_selected: 'не выбран',
  order_section_customer: 'Заказчик',
  order_section_address: 'Адрес',
  order_section_work_type: 'Тип работ',
  order_details_departure_date: '🗓️ Дата выезда',
  order_details_departure_not_specified: 'не указана',
  order_details_phone: '📞 Телефон',
  order_details_phone_hidden: 'Скрыт',
  order_details_amount: '💰 Сумма',
  order_details_fuel: '⛽ ГСМ',
  order_details_description: '📝 Описание',
  order_details_description_empty: '—',
  order_details_show_full: 'Показать полностью',
  order_details_collapse: 'Свернуть',
  order_details_contract_photo: 'Фото договора',
  order_details_photo_before: 'Фото ДО',
  order_details_photo_after: 'Фото ПОСЛЕ',
  order_details_act: 'Акт выполненных работ',
  order_details_add_photo: 'Добавить',
  order_details_accept_order: 'Принять заявку',
  order_details_finish_order: 'Завершить заявку',
  order_details_delete: 'Удалить',
  order_details_urgent: 'Срочная',

  // Модальные окна просмотра заявки
  order_modal_cancel_edit_title: 'Отменить редактирование?',
  order_modal_cancel_edit_msg: 'Все изменения будут потеряны. Вы уверены?',
  order_modal_cancel_stay: 'Остаться',
  order_modal_cancel_leave: 'Выйти',
  order_modal_select_executor: 'Выберите исполнителя',
  order_modal_to_feed: 'В общую ленту',
  order_modal_select_department: 'Выберите отдел',
  order_modal_no_departments: 'Нет отделов',
  order_modal_change_status: 'Изменить статус',
  order_modal_warning_title: 'Внимание',
  order_modal_delete_title: 'Удалить заявку?',
  order_modal_delete_msg:
    'Если удалить, все данные и фотографии будут стерты безвозвратно. Восстановить будет невозможно.',
  order_modal_delete_confirm: 'Удалить',
  order_modal_delete_countdown: 'Удалить ({n})',
  order_modal_work_type_select: 'Выберите тип работ',
  order_modal_work_type_empty: 'Список пуст. Добавьте типы работ в настройках компании.',

  // Тосты/уведомления заявки
  order_toast_phone_copied: 'Телефон скопирован',
  order_toast_photo_uploaded: 'Фото загружено',
  order_toast_upload_error: 'Ошибка загрузки',
  order_toast_photo_deleted: 'Фото удалено',
  order_toast_delete_error: 'Ошибка удаления',
  order_toast_order_finished: 'Заявка завершена',
  order_toast_finish_error: 'Ошибка при завершении',
  order_toast_network_error: 'Ошибка сети',
  order_toast_saved: 'Сохранено',
  order_toast_status_updated: 'Статус обновлён',
  order_toast_order_deleted: 'Заявка удалена',
  order_toast_add_photos: 'Добавьте: {items}',

  // Редактирование заявки (app/orders/edit/[id].jsx)
  order_field_title: 'Название заявки *',
  order_placeholder_title: 'Например: Обрезка деревьев',
  order_field_description: 'Описание',
  order_field_work_type: 'Тип работ',
  order_placeholder_description: 'Подробности (если есть)',
  order_field_region: 'Регион',
  order_field_city: 'Город',
  order_field_street: 'Улица',
  order_field_house: 'Дом',
  order_field_customer_name: 'Имя заказчика',
  order_field_departure_date: 'Дата выезда *',
  order_field_departure_time: 'Время выезда',

  // Валидация заявки
  order_validation_fill_required: 'Заполните обязательные поля: {fields}',
  order_validation_title_required: 'Укажите название заявки',
  order_validation_address_required: 'Укажите хотя бы часть адреса',
  order_validation_customer_required: 'Укажите имя заказчика',
  order_validation_phone_required: 'Укажите номер телефона',
  order_validation_date_required: 'Укажите дату выезда',
  order_validation_executor_required: 'Выберите исполнителя или отправьте в ленту',
  order_validation_phone_format: 'Введите корректный номер телефона формата +7 (9__) ___-__-__',
  order_validation_no_order_id: 'Id заявки не найден',
  order_save_error: 'Ошибка сохранения',

  // Статусы заявок
  order_status_in_feed: 'В ленте',
  order_status_new: 'Новый',
  order_status_in_progress: 'В работе',
  order_status_completed: 'Завершённая',

  // Права доступа
  order_no_camera_permission: 'Нет доступа к камере',

  // Фото категории
  order_missing_contract: 'фото договора',
  order_missing_photo_before: 'фото ДО',
  order_missing_photo_after: 'фото ПОСЛЕ',
  order_missing_act: 'акт выполненных работ',
};
