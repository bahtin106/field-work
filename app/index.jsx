// app/index.jsx
import { Redirect } from 'expo-router';

export default function Index() {
  // Простой редирект - логику авторизации контролирует _layout.js
  return <Redirect href="/(auth)/login" />;
}
