select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='orders' and column_name in ('feed_entered_at','created_by_user_id','updated_at','created_at');
