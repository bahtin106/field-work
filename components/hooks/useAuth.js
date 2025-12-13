import { useAuthContext } from '../../providers/SimpleAuthProvider';

export function useAuth() {
  return useAuthContext();
}
