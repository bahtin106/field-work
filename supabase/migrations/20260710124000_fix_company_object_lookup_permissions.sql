alter function public.search_company_objects_for_order(text, text, text, text, uuid, integer)
  security definer;

alter function public.find_exact_company_object_for_order(text, text, text, text, text, integer)
  security definer;

grant execute on function public.search_company_objects_for_order(text, text, text, text, uuid, integer)
  to authenticated, service_role;

grant execute on function public.find_exact_company_object_for_order(text, text, text, text, text, integer)
  to authenticated, service_role;
