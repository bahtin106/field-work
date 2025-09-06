// app/settings/sections/AdvancedSettings.jsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
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

export default function AdvancedSettings() {
  const { theme } = useTheme();
  const toast = useToast();
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [useWorkTypes, setUseWT] = useState(false);
  const [types, setTypes] = useState([]);
  const [newName, setNewName] = useState('');

  // загрузка компании и списка
  useEffect(() => {
    (async () => {
      try {
        const cid = await getMyCompanyId();
        setCompanyId(cid);
        const { useWorkTypes, types } = await fetchWorkTypes(cid);
        setUseWT(useWorkTypes);
        setTypes(types);
      } catch (e) {
        toast.error(e.message);
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
      toast.error(e.message);
    }
  };

  const addType = async () => {
    if (!newName.trim()) return;
    try {
      const t = await createWorkType(companyId, { name: newName.trim(), position: types.length + 1 });
      setTypes([...types, t]);
      setNewName('');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const renameType = async (id, name) => {
    try {
      const t = await updateWorkType(id, { name });
      setTypes(types.map(x => (x.id === id ? t : x)));
    } catch (e) {
      toast.error(e.message);
    }
  };

  const removeType = async (id) => {
    try {
      await deleteWorkType(id);
      setTypes(types.filter(x => x.id !== id));
    } catch (e) {
      toast.error(e.message);
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
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 16 }}>
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
            <FlatList
              data={types}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <TextInput
                    value={item.name}
                    onChangeText={(txt) => renameType(item.id, txt)}
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
              )}
            />

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
    </View>
  );
}
