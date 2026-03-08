update public.messenger_field_catalog
set
  is_active = false,
  updated_at = now()
where provider = 'telegram'
  and field_key in ('title', 'object_name');

insert into public.messenger_field_catalog (
  provider,
  field_key,
  entity_scope,
  input_kind,
  label,
  prompt,
  placeholder,
  default_sort_order,
  default_enabled,
  supports_required,
  is_active
)
values
  (
    'telegram',
    'customer_name',
    'client',
    'text',
    U&'\0418\043C\044F \043A\043B\0438\0435\043D\0442\0430',
    U&'\041A\0430\043A \043A \0432\0430\043C \043E\0431\0440\0430\0449\0430\0442\044C\0441\044F\003F',
    U&'\0418\043C\044F \043A\043B\0438\0435\043D\0442\0430',
    20,
    true,
    true,
    true
  ),
  (
    'telegram',
    'phone',
    'client',
    'phone',
    U&'\0422\0435\043B\0435\0444\043E\043D',
    U&'\0423\043A\0430\0436\0438\0442\0435 \0442\0435\043B\0435\0444\043E\043D \0434\043B\044F \0441\0432\044F\0437\0438.',
    U&'+7 (999) 123-45-67',
    30,
    true,
    true,
    true
  ),
  (
    'telegram',
    'secondary_phone',
    'client',
    'phone',
    U&'\0414\043E\043F. \0442\0435\043B\0435\0444\043E\043D',
    U&'\0423\043A\0430\0436\0438\0442\0435 \0434\043E\043F\043E\043B\043D\0438\0442\0435\043B\044C\043D\044B\0439 \043D\043E\043C\0435\0440, \0435\0441\043B\0438 \043E\043D \0435\0441\0442\044C.',
    U&'+7 (999) 123-45-67',
    40,
    false,
    false,
    true
  ),
  (
    'telegram',
    'email',
    'client',
    'text',
    'Email',
    U&'\0423\043A\0430\0436\0438\0442\0435 email, \0435\0441\043B\0438 \043E\043D \0435\0441\0442\044C.',
    'client@example.com',
    50,
    false,
    false,
    true
  ),
  (
    'telegram',
    'comment',
    'order',
    'multiline',
    U&'\041A\043E\043C\043C\0435\043D\0442\0430\0440\0438\0439',
    U&'\041E\043F\0438\0448\0438\0442\0435 \0437\0430\0434\0430\0447\0443 \0438\043B\0438 \0434\0435\0442\0430\043B\0438.',
    U&'\041A\043E\0440\043E\0442\043A\043E \043E\043F\0438\0448\0438\0442\0435 \043F\0440\043E\0431\043B\0435\043C\0443',
    60,
    true,
    false,
    true
  ),
  (
    'telegram',
    'country',
    'object',
    'text',
    U&'\0421\0442\0440\0430\043D\0430',
    U&'\0412\0432\0435\0434\0438\0442\0435 \0441\0442\0440\0430\043D\0443, \0435\0441\043B\0438 \043D\0443\0436\043D\043E.',
    U&'\0421\0442\0440\0430\043D\0430',
    70,
    false,
    false,
    true
  ),
  (
    'telegram',
    'region',
    'object',
    'text',
    U&'\0420\0435\0433\0438\043E\043D',
    U&'\0412\0432\0435\0434\0438\0442\0435 \0440\0435\0433\0438\043E\043D, \0435\0441\043B\0438 \043D\0443\0436\0435\043D.',
    U&'\0420\0435\0433\0438\043E\043D',
    80,
    false,
    false,
    true
  ),
  (
    'telegram',
    'district',
    'object',
    'text',
    U&'\0420\0430\0439\043E\043D',
    U&'\0412\0432\0435\0434\0438\0442\0435 \0440\0430\0439\043E\043D, \0435\0441\043B\0438 \043D\0443\0436\0435\043D.',
    U&'\0420\0430\0439\043E\043D',
    90,
    false,
    false,
    true
  ),
  (
    'telegram',
    'city',
    'object',
    'text',
    U&'\0413\043E\0440\043E\0434',
    U&'\0412\0432\0435\0434\0438\0442\0435 \0433\043E\0440\043E\0434.',
    U&'\0413\043E\0440\043E\0434',
    100,
    true,
    true,
    true
  ),
  (
    'telegram',
    'street',
    'object',
    'text',
    U&'\0423\043B\0438\0446\0430',
    U&'\0412\0432\0435\0434\0438\0442\0435 \0443\043B\0438\0446\0443.',
    U&'\0423\043B\0438\0446\0430',
    110,
    true,
    true,
    true
  ),
  (
    'telegram',
    'house',
    'object',
    'text',
    U&'\0414\043E\043C',
    U&'\0412\0432\0435\0434\0438\0442\0435 \0434\043E\043C.',
    U&'\0414\043E\043C',
    120,
    true,
    true,
    true
  ),
  (
    'telegram',
    'postal_code',
    'object',
    'text',
    U&'\0418\043D\0434\0435\043A\0441',
    U&'\0412\0432\0435\0434\0438\0442\0435 \0438\043D\0434\0435\043A\0441, \0435\0441\043B\0438 \043E\043D \0435\0441\0442\044C.',
    U&'\0418\043D\0434\0435\043A\0441',
    130,
    false,
    false,
    true
  ),
  (
    'telegram',
    'office',
    'object',
    'text',
    U&'\041E\0444\0438\0441',
    U&'\0412\0432\0435\0434\0438\0442\0435 \043E\0444\0438\0441, \0435\0441\043B\0438 \043E\043D \0435\0441\0442\044C.',
    U&'\041E\0444\0438\0441',
    140,
    false,
    false,
    true
  ),
  (
    'telegram',
    'floor',
    'object',
    'text',
    U&'\042D\0442\0430\0436',
    U&'\0412\0432\0435\0434\0438\0442\0435 \044D\0442\0430\0436, \0435\0441\043B\0438 \043E\043D \043D\0443\0436\0435\043D.',
    U&'\042D\0442\0430\0436',
    150,
    false,
    false,
    true
  ),
  (
    'telegram',
    'entrance',
    'object',
    'text',
    U&'\041F\043E\0434\044A\0435\0437\0434',
    U&'\0412\0432\0435\0434\0438\0442\0435 \043F\043E\0434\044A\0435\0437\0434, \0435\0441\043B\0438 \043E\043D \043D\0443\0436\0435\043D.',
    U&'\041F\043E\0434\044A\0435\0437\0434',
    160,
    false,
    false,
    true
  ),
  (
    'telegram',
    'apartment',
    'object',
    'text',
    U&'\041A\0432\0430\0440\0442\0438\0440\0430',
    U&'\0412\0432\0435\0434\0438\0442\0435 \043A\0432\0430\0440\0442\0438\0440\0443, \0435\0441\043B\0438 \043E\043D\0430 \0435\0441\0442\044C.',
    U&'\041A\0432\0430\0440\0442\0438\0440\0430',
    170,
    false,
    false,
    true
  ),
  (
    'telegram',
    'entrance_info',
    'object',
    'multiline',
    U&'\041A\0430\043A \043F\043E\043F\0430\0441\0442\044C',
    U&'\041E\043F\0438\0448\0438\0442\0435, \043A\0430\043A \043F\043E\043F\0430\0441\0442\044C \043D\0430 \043E\0431\044A\0435\043A\0442.',
    U&'\0414\043E\043C\043E\0444\043E\043D, \043A\043E\0434, \043E\0440\0438\0435\043D\0442\0438\0440\044B',
    180,
    false,
    false,
    true
  ),
  (
    'telegram',
    'parking_notes',
    'object',
    'multiline',
    U&'\041F\0430\0440\043A\043E\0432\043A\0430',
    U&'\0415\0441\0442\044C \043B\0438 \0432\0430\0436\043D\044B\0435 \043A\043E\043C\043C\0435\043D\0442\0430\0440\0438\0438 \043F\043E \043F\0430\0440\043A\043E\0432\043A\0435\003F',
    U&'\0413\0434\0435 \043F\0430\0440\043A\043E\0432\0430\0442\044C\0441\044F, \0448\043B\0430\0433\0431\0430\0443\043C \0438 \0442.\043F.',
    190,
    false,
    false,
    true
  )
on conflict (provider, field_key) do update
set
  entity_scope = excluded.entity_scope,
  input_kind = excluded.input_kind,
  label = excluded.label,
  prompt = excluded.prompt,
  placeholder = excluded.placeholder,
  default_sort_order = excluded.default_sort_order,
  default_enabled = excluded.default_enabled,
  supports_required = excluded.supports_required,
  is_active = excluded.is_active,
  updated_at = now();

update public.company_messenger_field_settings as settings
set
  sort_order = catalog.default_sort_order,
  updated_at = now()
from public.messenger_field_catalog as catalog
where settings.provider = 'telegram'
  and catalog.provider = settings.provider
  and catalog.field_key = settings.field_key;

delete from public.company_messenger_field_settings
where provider = 'telegram'
  and field_key in ('title', 'object_name');
