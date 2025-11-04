// app/company_settings/sections/WorkTypesSettings.jsx
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Screen from '../../../components/layout/Screen';
import { useNavigation } from 'expo-router';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import { useToast } from '../../../components/ui/ToastProvider';
import {
  fetchWorkTypes,
  setUseWorkTypes,
  createWorkType,
  updateWorkType,
  deleteWorkType,
  getMyCompanyId,
} from '../../../lib/workTypes';

export default function WorkTypesSettings() {
  const nav = useNavigation();
  const { theme } = useTheme();
  const toast = useToast();

  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [useWorkTypes, setUseWT] = useState(false);
  const [types, setTypes] = useState([]);
  const [newName, setNewName] = useState('');

  // Header
  React.useLayoutEffect(() => {
    try { nav?.setParams?.({ title: 'Виды работ', headerTitle: 'Виды работ' }); } catch {}
  }, [nav]);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const cid = await getMyCompanyId();
        setCompanyId(cid);
        const { useWorkTypes, types } = await fetchWorkTypes(cid);
        setUseWT(useWorkTypes);
        setTypes(types);
      } catch (e) {
        toast.error(e?.message || 'Не удалось загрузить виды работ');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleUseWT = async () => {
    try {
      await setUseWorkTypes(companyId, !useWorkTypes);
      setUseWT(!useWorkTypes);
      toast.success('Сохранено');
    } catch (e) {
      toast.error(e?.message || 'Ошибка сохранения');
    }
  };

  const addType = async () => {
    if (!newName.trim()) return;
    try {
      const t = await createWorkType(companyId, { name: newName.trim(), position: types.length + 1 });
      setTypes([...types, t]);
      setNewName('');
    } catch (e) {
      toast.error(e?.message || 'Не удалось добавить');
    }
  };

  const renameType = async (id, name) => {
    try {
      const t = await updateWorkType(id, { name });
      setTypes(types.map(x => (x.id === id ? t : x)));
    } catch (e) {
      toast.error(e?.message || 'Не удалось переименовать');
    }
  };

  const removeType = async (id) => {
    try {
      await deleteWorkType(id);
      setTypes(types.filter(x => x.id !== id));
    } catch (e) {
      toast.error(e?.message || 'Не удалось удалить');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 16 }}>
        <Text style={{ color: theme.colors.text }}>Загрузка...</Text>
      </View>
    );
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16 }}>
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8, color: theme.colors.text }}>
            Виды работ
          </Text>

          <Pressable onPress={toggleUseWT} style={{ marginBottom: 12 }}>
            <Text style={{ color: theme.colors.text }}>
              {useWorkTypes ? '✅ Используются' : '❌ Не используются'} (нажми, чтобы переключить)
            </Text>
          </Pressable>

          {useWorkTypes && (
            <View>
              {/* Список видов работ */}
              <View>
                {types.map((item) => (
                  <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <TextInput
                      value={item.name}
                      onChangeText={(txt) => setTypes(prev => prev.map(x => x.id === item.id ? { ...x, name: txt } : x))}
                      onEndEditing={(e) => renameType(item.id, e.nativeEvent.text)}
                      style={{
                        flex: 1,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 6,
                        color: theme.colors.text,
                      }}
                    />
                    <Pressable onPress={() => removeType(item.id)} style={{ marginLeft: 8 }}>
                      <Text style={{ color: theme.colors.danger }}>Удалить</Text>
                    </Pressable>
                  </View>
                ))}
              </View>

              {types.length < 10 && (
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="Новый вид"
                    placeholderTextColor={theme.colors.textSecondary}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      color: theme.colors.text,
                    }}
                  />
                  <Button title="Добавить" onPress={addType} style={{ marginLeft: 8 }} />
                </View>
              )}
            </View>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
