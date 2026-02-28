import { uploadProfileMedia } from '../profileMedia/api';

export async function uploadClientAvatar(clientId: string, uri: string) {
  return uploadProfileMedia('client', String(clientId || ''), uri);
}
