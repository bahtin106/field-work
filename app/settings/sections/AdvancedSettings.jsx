// app/settings/sections/AdvancedSettings.jsx
import React, { useEffect, useState } from 'react';
import {Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabase';
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
  // === Departments state ===
  const [departments, setDepartments] = useState([]);           // {id, name, is_enabled}
  const [deptName, setDeptName] = useState('');
  const [deptLoading, setDeptLoading] = useState(true);
  const [deptError, setDeptError] = useState('');

  // delete dialog state
  const [deleteDlg, setDeleteDlg] = useState({ open: false, id: null, name: '', action: 'unset_employees', target: null });


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

  
  // === Departments: realtime + actions ===
  useEffect(() => {
    const ch = supabase
      .channel('rt-departments-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => {
        (async () => {
          const { data } = await supabase
            .from('departments')
            .select('id, name, is_enabled, deleted_at')
            .is('deleted_at', null)
            .order('name');
          setDepartments(Array.isArray(data) ? data : []);
        })();
      })
      .subscribe();
    return () => { try { ch.unsubscribe(); } catch {} };
  }, []);

  const refreshDepartments = async () => {
    const { data } = await supabase
      .from('departments')
      .select('id, name, is_enabled, deleted_at')
      .is('deleted_at', null)
      .order('name');
    setDepartments(Array.isArray(data) ? data : []);
  };

  const toggleDept = async (dept) => {
    try {
      await supabase.from('departments').update({ is_enabled: !dept.is_enabled }).eq('id', dept.id);
      await refreshDepartments();
      toast.success('Сохранено');
    } catch (e) {
      toast.error(e.message || 'Не удалось изменить статус');
    }
  };

  const addDept = async () => {
  const name = (deptName || '').trim();
  if (!name || !companyId) return;
  try {
    const { error } = await supabase
      .from('departments')
      .insert({ name, company_id: companyId, is_enabled: true })
      .select('id'); // force insert to detect RLS/limit errors
    if (error) throw error;
    setDeptName('');
    await refreshDepartments();
    toast.success('Добавлено');
  } catch (e) {
    toast.error(e.message || 'Не удалось добавить отдел');
  }
};

  const openDeleteDialog = async (dept) => {
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('department_id', dept.id);

      const hasEmployees = !error && typeof count === 'number' && count > 0;

      setDeleteDlg({
        open: true,
        id: dept.id,
        name: dept.name,
        action: hasEmployees ? 'unset_employees' : 'unset_employees',
        target: null,
        hasEmployees,
      });
    } catch (e) {
      // если что-то пошло не так, открываем упрощённый диалог
      setDeleteDlg({
        open: true,
        id: dept.id,
        name: dept.name,
        action: 'unset_employees',
        target: null,
        hasEmployees: false,
      });
    }
  };

  const performDelete = async () => {
    const { id, action, target } = deleteDlg;
    try {
      // шаг 1: обработать сотрудников выбранным действием
      await supabase.rpc('departments_delete_action', {
        p_department_id: id,
        p_action: action,
        p_target_department: target,
      });

      // шаг 2: жёстко удалить сам отдел из таблицы
      const { error: delErr } = await supabase
        .from('departments')
        .delete()
        .eq('id', id);
      if (delErr) throw delErr;

      setDeleteDlg({ open: false, id: null, name: '', action: 'unset_employees', target: null, hasEmployees: false });
      await refreshDepartments();
      toast.success('Удалено');
    } catch (e) {
      toast.error(e.message || 'Не удалось удалить отдел');
    }
  };

  const renameDept = async (id, name) => {
    try {
      await supabase.from('departments').update({ name }).eq('id', id).select('id');
      await refreshDepartments();
      toast.success('Сохранено');
    } catch (e) {
      toast.error(e.message || 'Не удалось переименовать отдел');
    }
  };


  // === Departments: initial load ===
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    (async () => {
      try {
        setDeptLoading(true);
        const { data, error } = await supabase
          .from('departments')
          .select('id, name, is_enabled, deleted_at')
          .is('deleted_at', null)
          .order('name');
        if (error) throw error;
        if (alive) setDepartments(Array.isArray(data) ? data : []);
      } catch (e) {
        if (alive) {
          setDeptError('Не удалось загрузить отделы');
          toast.error(e.message || 'Не удалось загрузить отделы');
        }
      } finally {
        if (alive) setDeptLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [companyId]);
if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 16 }}>
        <Text style={{ color: theme.colors.text }}>Загрузка...</Text>
      </View>
    );
  }

  return (
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
            {/* list of work types */}
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
      <Card style={{ marginTop: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8, color: theme.colors.text }}>
          Отделы
        </Text>

        {deptLoading ? (
          <Text style={{ color: theme.colors.textSecondary }}>Загрузка...</Text>
        ) : (
          <View>
            {departments.length < 10 && (
              <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                <TextInput
                  value={deptName}
                  onChangeText={setDeptName}
                  placeholder="Новый отдел"
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
                <Button title="Добавить" onPress={addDept} style={{ marginLeft: 8 }} />
              </View>
            )}

            {departments.length === 0 ? (
              <Text style={{ color: theme.colors.textSecondary }}>Отделов пока нет</Text>
            ) : (
              
              <View>
                {/* departments list (no virtualization) */}
                {departments.map((item) => (
    <View
      key={String(item.id)}
      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
    >
      <View style={{ flex: 1 }}>
        <TextInput
          value={item.name}
          onChangeText={(txt) =>
            setDepartments((prev) =>
              prev.map((d) => (d.id === item.id ? { ...d, name: txt } : d))
            )
          }
          onEndEditing={(e) => renameDept(item.id, e.nativeEvent.text)}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 6,
            color: theme.colors.text,
          }}
        />
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
          {item.is_enabled ? 'Включен' : 'Выключен'}
        </Text>
      </View>

      <Pressable
        onPress={() => toggleDept(item)}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 10,
          backgroundColor: theme.colors.surface,
          marginRight: 8,
        }}
      >
        <Text style={{ color: item.is_enabled ? theme.colors.success : theme.colors.textSecondary }}>
          {item.is_enabled ? 'Выключить' : 'Включить'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => openDeleteDialog(item)}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 10,
          backgroundColor: theme.colors.surface,
        }}
      >
        <Text style={{ color: theme.colors.danger }}>Удалить</Text>
      </Pressable>
    </View>
                ))}
              </View>


                      
            )}
          </View>
        )}

        {deleteDlg.open && (
          <View style={{ marginTop: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 12, backgroundColor: theme.colors.surface }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', marginBottom: 8 }}>
              {deleteDlg.hasEmployees
                ? `Удалить отдел «${deleteDlg.name}»?`
                : `В отделе «${deleteDlg.name}» сотрудников нет. Просто удалить?`}
           </Text>

            {deleteDlg.hasEmployees ? (
              <View style={{ gap: 8 }}>
                <Pressable onPress={() => setDeleteDlg({ ...deleteDlg, action: 'delete_employees' })}>
                  <Text style={{ color: deleteDlg.action === 'delete_employees' ? theme.colors.primary : theme.colors.text }}>
                    • Удалить сотрудников вместе с отделом
                  </Text>
                </Pressable>
                <Pressable onPress={() => setDeleteDlg({ ...deleteDlg, action: 'unset_employees', target: null })}>
                  <Text style={{ color: deleteDlg.action === 'unset_employees' ? theme.colors.primary : theme.colors.text }}>
                    • Оставить сотрудников без отдела
                  </Text>
                </Pressable>
                <View>
                  <Pressable onPress={() => setDeleteDlg({ ...deleteDlg, action: 'move_employees' })}>
                    <Text style={{ color: deleteDlg.action === 'move_employees' ? theme.colors.primary : theme.colors.text }}>
                      • Перенести сотрудников в другой отдел
                    </Text>
                  </Pressable>
                  {deleteDlg.action === 'move_employees' && (
                    <View style={{ marginTop: 8 }}>
                      {departments.filter(d => String(d.id) !== String(deleteDlg.id) && d.is_enabled).map((item) => (
                        <Pressable key={String(item.id)} onPress={() => setDeleteDlg({ ...deleteDlg, target: item.id })} style={{ paddingVertical: 6 }}>
                          <Text style={{ color: String(deleteDlg.target) === String(item.id) ? theme.colors.primary : theme.colors.text }}>
                            {item.name}
                          </Text>
                        </Pressable>
                      ))}
                      {!deleteDlg.target && (
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Выберите отдел для переноса</Text>
                      )}
                    </View>
                  )}
                </View>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Pressable onPress={() => setDeleteDlg({ open: false, id: null, name: '', action: 'unset_employees', target: null, hasEmployees: false })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: theme.colors.surface, marginRight: 8 }}>
                <Text style={{ color: theme.colors.text }}>Отмена</Text>
              </Pressable>
              <Button
                title="Удалить"
                onPress={performDelete}
                disabled={deleteDlg.action === 'move_employees' && !deleteDlg.target}
                variant="destructive"
              />
            </View>
          </View>
        )}
      </Card>

    </ScrollView>
  );
}
