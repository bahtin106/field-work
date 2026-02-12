Изменения от 2026-02-12

Файлы добавлены/изменены:

- Добавлен: components/ui/ProfileImageCropper.tsx
  - Новый fullscreen circular cropper с поддержкой жестов (reanimated + gesture-handler) и кропом через expo-image-manipulator.

- Добавлен backup старой модалки: backups/2026-02-12_120000/AvatarCropModal.jsx
  - Точная копия прежнего `components/ui/AvatarCropModal.jsx` на момент изменения.

- Изменён: app/users/[id]/edit.jsx
  - Импорт и рендер заменены: теперь используется `ProfileImageCropper` вместо `AvatarCropModal`.

Откат:

1) Восстановить старый файл модалки (быстрый способ):

Windows PowerShell:

```powershell
copy .\backups\2026-02-12_120000\AvatarCropModal.jsx .\components\ui\AvatarCropModal.jsx
git add components/ui/AvatarCropModal.jsx
git commit -m "Restore AvatarCropModal from backup"
```

2) Удалить новый компонент и вернуть импорт в экран редактирования:

```powershell
git rm components/ui/ProfileImageCropper.tsx
# вернуть изменённый файл edit.jsx из предыдущего коммита, например
git checkout -- app/users/[id]/edit.jsx
git commit -m "Revert ProfileImageCropper integration"
```

3) Полный откат всех моих изменений (если были сделаны отдельные коммиты после моих правок):

```powershell
# осторожно: сбросит рабочую ветку к предыдущему состоянию
git log --oneline
# найти хеш коммита до моих изменений
git reset --hard <commit-hash>
```

Примечания:
- `ProfileImageCropper.tsx` использует `react-native-reanimated` и `react-native-gesture-handler`. Убедитесь, что проект собран нативно для проверки нативных возможностей. JS-работа и fallback должны работать в Expo Go при наличии JS-реализаций.
- Если нужно настроить цвета/primary-цвет или радиус круга — правьте `components/ui/ProfileImageCropper.tsx` (стили внизу файла).

Если хотите — автоматически выполню интеграционный тест в Expo (запущу `npx expo start`) и проверю поведение в Expo Go (JS-fallback).