import { supabase } from '../../../lib/supabase';
import { AVATAR, STORAGE } from '../../../lib/constants';

export async function uploadClientAvatar(clientId: string, uri: string) {
  if (!clientId || !uri) return null;

  const response = await fetch(uri);
  const arrayBuffer = await response.arrayBuffer();
  const fileData = new Uint8Array(arrayBuffer);
  const filename = `client_${Date.now()}.jpg`;
  const path = `${STORAGE.AVATAR_PREFIX}/clients/${clientId}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE.AVATARS)
    .upload(path, fileData, {
      contentType: AVATAR.MIME,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(STORAGE.AVATARS).getPublicUrl(path);
  return data?.publicUrl || null;
}
