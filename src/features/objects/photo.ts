import { uploadProfileMedia } from '../profileMedia/api';

export async function uploadClientObjectPhoto(objectId: string, uri: string) {
  return uploadProfileMedia('object', String(objectId || ''), uri);
}
