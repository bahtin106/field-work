export { handleRegisterUserRequest } from '../register_user/index.ts';

import { handleRegisterUserRequest } from '../register_user/index.ts';

if (import.meta.main) {
  Deno.serve(handleRegisterUserRequest);
}
