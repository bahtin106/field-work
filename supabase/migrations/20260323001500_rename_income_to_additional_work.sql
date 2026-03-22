-- Rename only legacy default income labels to "Доп. работы" to avoid user confusion.
-- Custom names are intentionally not touched.

update public.order_finance_entries
   set title = 'Доп. работы'
 where kind = 'income'
   and btrim(coalesce(title, '')) in (
     'Доход',
     'Новый доход',
     'Income',
     'New income'
   );

update public.company_finance_rules
   set name = 'Доп. работы'
 where kind = 'income'
   and btrim(coalesce(name, '')) in (
     'Доход',
     'Новый доход',
     'Income',
     'New income'
   );
