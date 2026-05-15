ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_event_type_check;

ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_event_type_check
  CHECK (
    event_type = ANY (
      ARRAY[
        'feed_new_order'::text,
        'assigned_new_order'::text,
        'feed_stale_reminder'::text,
        'support_feedback_new'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.enqueue_support_feedback_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_author text;
  v_excerpt text;
  v_recipient uuid;
BEGIN
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_author := NULLIF(BTRIM(COALESCE(NEW.full_name, NEW.contact, '')), '');

  IF v_author IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT NULLIF(
      BTRIM(
        COALESCE(
          NULLIF(BTRIM(p.full_name), ''),
          NULLIF(BTRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)), ''),
          NULLIF(BTRIM(p.email), '')
        )
      ),
      ''
    )
    INTO v_author
    FROM public.profiles p
    WHERE p.id = NEW.user_id
    LIMIT 1;
  END IF;

  v_author := COALESCE(v_author, 'Пользователь');
  v_excerpt := LEFT(NULLIF(BTRIM(REGEXP_REPLACE(COALESCE(NEW.text, ''), '\s+', ' ', 'g')), ''), 140);
  v_excerpt := COALESCE(v_excerpt, 'Откройте обращение');

  FOR v_recipient IN
    SELECT DISTINCT COALESCE(sa.user_id, sa.profile_id)
    FROM public.super_admins sa
    JOIN auth.users au ON au.id = COALESCE(sa.user_id, sa.profile_id)
    WHERE sa.is_active = true
      AND COALESCE(sa.user_id, sa.profile_id) IS NOT NULL
      AND (
        NEW.user_id IS NULL
        OR COALESCE(sa.user_id, sa.profile_id) <> NEW.user_id
      )
  LOOP
    INSERT INTO public.notification_events (
      event_type,
      company_id,
      order_id,
      recipient_user_id,
      payload,
      dedupe_key
    )
    VALUES (
      'support_feedback_new',
      NEW.company_id,
      NEW.id::text,
      v_recipient,
      jsonb_build_object(
        'feedback_id', NEW.id::text,
        'company_id', NEW.company_id::text,
        'author_name', v_author,
        'contact', NEW.contact,
        'message_excerpt', v_excerpt,
        'created_at', NEW.created_at
      ),
      'support_feedback_new:' || NEW.id::text || ':' || v_recipient::text
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedbacks_enqueue_support_notification ON public.feedbacks;

CREATE TRIGGER feedbacks_enqueue_support_notification
AFTER INSERT ON public.feedbacks
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_support_feedback_notification();
