update public.messenger_field_catalog
set
  label = U&'\041D\0430\0437\0432\0430\043D\0438\0435 \0437\0430\044F\0432\043A\0438',
  prompt = U&'\041A\0430\043A \043D\0430\0437\0432\0430\0442\044C \0437\0430\044F\0432\043A\0443\003F',
  placeholder = U&'\041D\0430\043F\0440\0438\043C\0435\0440: \041F\0440\043E\0442\0435\043A\0430\0435\0442 \043A\0440\0430\043D'
where provider = 'telegram' and field_key = 'title';

update public.messenger_field_catalog
set
  label = U&'\0418\043C\044F \043A\043B\0438\0435\043D\0442\0430',
  prompt = U&'\041A\0430\043A \043A \0432\0430\043C \043E\0431\0440\0430\0449\0430\0442\044C\0441\044F\003F',
  placeholder = U&'\0418\043C\044F \043A\043B\0438\0435\043D\0442\0430'
where provider = 'telegram' and field_key = 'customer_name';

update public.messenger_field_catalog
set
  label = U&'\0422\0435\043B\0435\0444\043E\043D',
  prompt = U&'\0423\043A\0430\0436\0438\0442\0435 \0442\0435\043B\0435\0444\043E\043D \0434\043B\044F \0441\0432\044F\0437\0438.',
  placeholder = U&'+7 (999) 123-45-67'
where provider = 'telegram' and field_key = 'phone';

update public.messenger_field_catalog
set
  label = U&'\041A\043E\043C\043C\0435\043D\0442\0430\0440\0438\0439',
  prompt = U&'\041E\043F\0438\0448\0438\0442\0435 \0437\0430\0434\0430\0447\0443 \0438\043B\0438 \0434\0435\0442\0430\043B\0438.',
  placeholder = U&'\041A\043E\0440\043E\0442\043A\043E \043E\043F\0438\0448\0438\0442\0435 \043F\0440\043E\0431\043B\0435\043C\0443'
where provider = 'telegram' and field_key = 'comment';

update public.messenger_field_catalog
set
  label = U&'\041D\0430\0437\0432\0430\043D\0438\0435 \043E\0431\044A\0435\043A\0442\0430',
  prompt = U&'\041A\0430\043A \043D\0430\0437\0432\0430\0442\044C \043E\0431\044A\0435\043A\0442\003F',
  placeholder = U&'\041D\0430\043F\0440\0438\043C\0435\0440: \041A\0432\0430\0440\0442\0438\0440\0430 \043D\0430 \041B\0435\043D\0438\043D\0430'
where provider = 'telegram' and field_key = 'object_name';

update public.messenger_field_catalog
set
  label = U&'\0413\043E\0440\043E\0434',
  prompt = U&'\0412\0432\0435\0434\0438\0442\0435 \0433\043E\0440\043E\0434.',
  placeholder = U&'\0413\043E\0440\043E\0434'
where provider = 'telegram' and field_key = 'city';

update public.messenger_field_catalog
set
  label = U&'\0423\043B\0438\0446\0430',
  prompt = U&'\0412\0432\0435\0434\0438\0442\0435 \0443\043B\0438\0446\0443.',
  placeholder = U&'\0423\043B\0438\0446\0430'
where provider = 'telegram' and field_key = 'street';

update public.messenger_field_catalog
set
  label = U&'\0414\043E\043C',
  prompt = U&'\0412\0432\0435\0434\0438\0442\0435 \0434\043E\043C.',
  placeholder = U&'\0414\043E\043C'
where provider = 'telegram' and field_key = 'house';

update public.messenger_field_catalog
set
  label = U&'\041A\0432\0430\0440\0442\0438\0440\0430',
  prompt = U&'\0412\0432\0435\0434\0438\0442\0435 \043A\0432\0430\0440\0442\0438\0440\0443, \0435\0441\043B\0438 \0435\0441\0442\044C.',
  placeholder = U&'\041A\0432\0430\0440\0442\0438\0440\0430'
where provider = 'telegram' and field_key = 'apartment';

update public.messenger_field_catalog
set
  label = U&'\041E\0444\0438\0441',
  prompt = U&'\0412\0432\0435\0434\0438\0442\0435 \043E\0444\0438\0441, \0435\0441\043B\0438 \0435\0441\0442\044C.',
  placeholder = U&'\041E\0444\0438\0441'
where provider = 'telegram' and field_key = 'office';

update public.messenger_field_catalog
set
  label = U&'\041F\043E\0434\044A\0435\0437\0434',
  prompt = U&'\0412\0432\0435\0434\0438\0442\0435 \043F\043E\0434\044A\0435\0437\0434, \0435\0441\043B\0438 \043D\0443\0436\0435\043D.',
  placeholder = U&'\041F\043E\0434\044A\0435\0437\0434'
where provider = 'telegram' and field_key = 'entrance';

update public.messenger_field_catalog
set
  label = U&'\042D\0442\0430\0436',
  prompt = U&'\0412\0432\0435\0434\0438\0442\0435 \044D\0442\0430\0436, \0435\0441\043B\0438 \043D\0443\0436\0435\043D.',
  placeholder = U&'\042D\0442\0430\0436'
where provider = 'telegram' and field_key = 'floor';

update public.messenger_field_catalog
set
  label = U&'\041A\0430\043A \043F\043E\043F\0430\0441\0442\044C',
  prompt = U&'\041E\043F\0438\0448\0438\0442\0435, \043A\0430\043A \043F\043E\043F\0430\0441\0442\044C \043D\0430 \043E\0431\044A\0435\043A\0442.',
  placeholder = U&'\0414\043E\043C\043E\0444\043E\043D, \043A\043E\0434, \043E\0440\0438\0435\043D\0442\0438\0440\044B'
where provider = 'telegram' and field_key = 'entrance_info';

update public.messenger_field_catalog
set
  label = U&'\041F\0430\0440\043A\043E\0432\043A\0430',
  prompt = U&'\041D\0443\0436\043D\044B \043B\0438 \043A\043E\043C\043C\0435\043D\0442\0430\0440\0438\0438 \043F\043E \043F\0430\0440\043A\043E\0432\043A\0435\003F',
  placeholder = U&'\0413\0434\0435 \043F\0430\0440\043A\043E\0432\0430\0442\044C\0441\044F, \0448\043B\0430\0433\0431\0430\0443\043C \0438 \0442.\043F.'
where provider = 'telegram' and field_key = 'parking_notes';
