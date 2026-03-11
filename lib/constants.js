// Centralized constants used across the app.
export const TBL = {
  NOTIF_PREFS: 'notification_prefs',
  PROFILES: 'profiles',
  CLIENTS: 'clients',
  APP_ROLE_PERMS: 'app_role_permissions',
  ORDERS: 'orders',
  DEPARTMENTS: 'departments',
};

export const PERM_KEYS = {
  CAN_CREATE_ORDERS: 'canCreateOrders',
  CAN_VIEW_CLIENTS: 'canViewClients',
  CAN_CREATE_CLIENTS: 'canCreateClients',
  CAN_EDIT_CLIENTS: 'canEditClients',
  CAN_DELETE_CLIENTS: 'canDeleteClients',
  CAN_VIEW_OBJECTS: 'canViewObjects',
  CAN_CREATE_OBJECTS: 'canCreateObjects',
  CAN_EDIT_OBJECTS: 'canEditObjects',
  CAN_DELETE_OBJECTS: 'canDeleteObjects',
};

export const STORAGE = {
  AVATARS: 'avatars',
  AVATAR_PREFIX: 'profiles',
  ORDERS_PHOTOS: 'orders-photos',
  ORDERS_PREFIX: 'orders',
};

export const STORAGE_LIMITS = {
  COMPANY_TOTAL_GB: 1,
  COMPANY_TOTAL_BYTES: 1024 * 1024 * 1024,
};

export const AVATAR = {
  FILENAME_PREFIX: 'avatar_',
  MIME: 'image/jpeg',
};

export const OBJECT_PHOTO = {
  FILENAME_PREFIX: 'object_',
  MIME: 'image/jpeg',
  STORAGE_SEGMENT: 'objects',
};

export const ORDER_MEDIA = {
  CATEGORIES: ['contract_file', 'photo_before', 'photo_after', 'act_file'],
};

export const IMAGE = {
  MIME_JPEG: 'image/jpeg',
  ORDER_UPLOAD_MAX_BYTES: 200 * 1024,
  ORDER_UPLOAD_INITIAL_WIDTH: 1600,
  ORDER_UPLOAD_MIN_WIDTH: 960,
};

export const FUNCTIONS = {
  UPDATE_USER: 'update_user',
  DELETE_USER: 'delete-user',
  CREATE_USER: 'create_user',
  REGISTER_USER: 'register_user',
  DELETE_USERAliases: [],
};
