Changes (2026-02-12 12:15)

Files added:
- components/ui/ProfileImageEditor.tsx  — new immersive fullscreen circular crop editor

Files backed up:
- backups/2026-02-12_121500/ProfileImageCropper.tsx  — backup of prior ProfileImageCropper
- backups/2026-02-12_120000/AvatarCropModal.jsx — earlier backup
- backups/2026-02-12_120000/PROFILE_IMAGE_CROPPER_CHANGES.md — earlier changelog

Files modified:
- app/users/[id]/edit.jsx  — now imports and uses `ProfileImageEditor` (prop `onSave`)

Rollback instructions:
1) Restore previous editor usage only:
   - Replace the `ProfileImageEditor` usage with `ProfileImageCropper` in `app/users/[id]/edit.jsx` or restore the file from git:

```powershell
# restore edit.jsx from previous commit
git checkout -- app/users/[id]/edit.jsx
```

2) Restore backup of `ProfileImageCropper` (if you want the old component file back):

```powershell
copy .\backups\2026-02-12_121500\ProfileImageCropper.tsx .\components\ui\ProfileImageCropper.tsx
git add components/ui/ProfileImageCropper.tsx
git commit -m "Restore ProfileImageCropper from backup"
```

3) Remove new editor and its import:

```powershell
git rm components/ui/ProfileImageEditor.tsx
git commit -m "Remove ProfileImageEditor"
```

Notes:
- `ProfileImageEditor.tsx` depends on `react-native-reanimated`, `react-native-gesture-handler` and `expo-image-manipulator` (already present). It uses feature-detection for Reanimated and safely degrades where needed.
- For fastest local testing use `npx expo start` (JS fallback will not be used for reanimated gestures). If you need native Reanimated behavior, ensure your project has Reanimated properly installed and rebuild the native binary (EAS).