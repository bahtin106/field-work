import { useEffect, useMemo, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { View, Text, Pressable } from 'react-native';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme';
import { KeyboardProvider } from '../../../lib/keyboardControllerCompat';
import OrderPhotosModal from '../../../app/orders/components/OrderPhotosModal';
import CachedImage from '../../../components/ui/CachedImage';
import ModalImagePreview from '../../../components/media/ModalImagePreview';
import { BaseModal, SelectModal } from '../../../components/ui/modals';
import { getProfileMediaDisplayUri } from '../../../src/shared/media/profileMediaDisplayUri';

const base = 'http://127.0.0.1:8087';
const run = Date.now();
const fixture = `${base}/fixture.png?run=${run}`;
const protectedUri = `${base}/functions/v1/media-thumbnail?id=${run}`;
const report = (name, event) => fetch(`${base}/event?name=${name}&event=${event}`).catch(() => {});

function Harness() {
  const [local, setLocal] = useState('');
  const [visible, setVisible] = useState(true);
  const [lateFallback, setLateFallback] = useState('');
  const [authSource, setAuthSource] = useState(fixture);
  const [allProtected, setAllProtected] = useState(false);
  const [avatarMenu, setAvatarMenu] = useState(false);
  const [avatarVisible, setAvatarVisible] = useState(false);
  const [avatarUri, setAvatarUri] = useState(fixture);
  const pendingAvatarView = useRef(false);
  useEffect(() => {
    downloadAsync(fixture, `${cacheDirectory}preview-${run}.png`).then((r) => setLocal(r.uri));
    const timer = setTimeout(() => {
      setLateFallback(fixture);
      setAuthSource(protectedUri);
    }, 800);
    return () => clearTimeout(timer);
  }, []);
  const photos = useMemo(() => ['network', 'missing-local', 'local', 'protected'], []);
  return <SafeAreaProvider><KeyboardProvider><ThemeProvider>
    <View style={{ flex: 1, paddingTop: 60, backgroundColor: '#dddddd' }}>
      <Text>Native photo regression: retry / fallback / auth</Text>
      <Pressable onPress={() => setVisible(true)}><Text>OPEN PHOTOS</Text></Pressable>
      <Pressable onPress={() => { setAllProtected((value) => !value); setVisible(true); }}>
        <Text>TOGGLE ALL PROTECTED PHOTOS</Text>
      </Pressable>
      <Pressable onPress={() => { setAvatarUri('yadisk://employee/avatar.jpg'); setAvatarMenu(true); }}><Text>EMPLOYEE AVATAR</Text></Pressable>
      <Pressable onPress={() => { setAvatarUri(local); setAvatarMenu(true); }}><Text>LOCAL AVATAR</Text></Pressable>
      <View style={{ flexDirection: 'row' }}>
        <CachedImage uri={`${base}/flaky.png?run=${run}`} width={70} height={70} transition={0}
          onLoad={() => report('retry', 'load')} onError={() => report('retry', 'error')} />
        <CachedImage uri="file:///missing-preview.png" fallbackUri={`${base}/denied`}
          fallbackUris={[fixture]} width={70} height={70} transition={0}
          onLoad={() => report('chain', 'load')} onError={() => report('chain', 'error')} />
        <CachedImage uri={`${base}/denied`} width={70} height={70} transition={0}
          onLoad={() => report('failure', 'load')} onError={() => report('failure', 'error')} />
        <CachedImage uri="file:///late-preview.png" fallbackUri={lateFallback}
          width={70} height={70} transition={0}
          onLoad={() => report('late', 'load')} />
        <CachedImage uri={authSource} width={70} height={70} transition={0}
          onLoad={() => { if (authSource === protectedUri) report('auth', 'load'); }}
          onError={() => report('auth', 'error')} />
      </View>
      <OrderPhotosModal visible={visible} onClose={() => setVisible(false)} photos={photos}
        getDisplayUrl={(url) => allProtected ? `${protectedUri}&photo=${url}` : url === 'missing-local' ? 'file:///removed-preview.png'
          : url === 'local' && local ? local : url === 'protected' ? protectedUri : fixture}
        getThumbnailUrl={(url) => allProtected ? `${protectedUri}&photo=${url}` : url === 'protected' ? protectedUri : fixture}
        getFallbackUrl={() => `${base}/denied`}
        onRemove={() => {}} onUploadUri={async () => {}} onUploadMultiple={async () => {}} />
      <SelectModal visible={avatarMenu} title="Profile photo" searchable={false}
        items={[{id:'view', label:'View photo'}]} onClose={() => setAvatarMenu(false)}
        onSelect={() => { pendingAvatarView.current = true; setAvatarMenu(false); }}
        onDismiss={() => {
          if (!pendingAvatarView.current) return;
          pendingAvatarView.current = false;
          setAvatarVisible(true);
        }} />
      <BaseModal visible={avatarVisible} onClose={() => setAvatarVisible(false)} title="Profile photo"
        maxHeightRatio={0.9} disableContentShrink>
        <ModalImagePreview uri={getProfileMediaDisplayUri(avatarUri, fixture)} emptyLabel="No photo" accessibilityLabel="Profile photo" />
      </BaseModal>
    </View>
  </ThemeProvider></KeyboardProvider></SafeAreaProvider>;
}
registerRootComponent(Harness);
