import { Platform, ToastAndroid } from 'react-native';

export const createToastHelper = (setBannerMessage) => {
  return (msg) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
    } else {
      setBannerMessage(msg);
      setTimeout(() => setBannerMessage(''), 2000);
    }
  };
};
