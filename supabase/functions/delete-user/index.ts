import { handleDeleteUserRequest } from '../delete_user/index.ts';

if (import.meta.main) {
  Deno.serve(handleDeleteUserRequest);
}

export { handleDeleteUserRequest };
