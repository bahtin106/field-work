import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export function useUser() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setUser(user);

      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (!error) {
          setRole(data.role);
        }
      }
    };

    fetchUser();
  }, []);

  return { user, role };
}
