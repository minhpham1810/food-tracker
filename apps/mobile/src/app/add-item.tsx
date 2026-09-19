import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { LabeledInput } from '@/components/LabeledInput';
import { addItem, getProfiles } from '@/lib/api';
import { colors, eyebrow, fontSize, spacing } from '@/lib/theme';
import type { FoodProfile } from '@/lib/types';

export default function AddItemScreen() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<FoodProfile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfiles()
      .then(setProfiles)
      .catch(() => setError('Could not load food categories. Is the API running?'));
  }, []);

  const selected = profiles.find((profile) => profile.id === profileId) ?? null;

  const submit = async () => {
    if (profileId === null) return;
    setSaving(true);
    setError(null);
    try {
      // An empty name is sent as null so the backend uses the profile's own name.
      await addItem(profileId, name.trim().length > 0 ? name.trim() : null);
      router.back();
    } catch (err) {
      setError(`Could not add this item: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>
        Add an item by hand when there is no label to scan, or when OCR can&apos;t read one.
      </Text>

      {error !== null && <Text style={styles.errorText}>{error}</Text>}

      <Card>
        <Text style={styles.eyebrow}>NEW ITEM</Text>
        <Text style={styles.fieldLabel}>Food category</Text>
        <View style={styles.chipRow}>
          {profiles.map((profile) => (
            <Chip
              key={profile.id}
              label={profile.name}
              selected={profile.id === profileId}
              onPress={() => setProfileId(profile.id)}
            />
          ))}
        </View>

        {selected !== null && (
          <Text style={styles.footnote}>
            {selected.name} starts with a {selected.d0_days}-day budget at 4 °C
            {' '}({selected.opened_d0_days} days once opened), Q10 {selected.q10}.
            {selected.placeholder ? ' These are demo coefficients, not validated data.' : ''}
          </Text>
        )}

        <LabeledInput
          label="Name (optional)"
          value={name}
          onChangeText={setName}
          placeholder={selected ? selected.name : 'Defaults to the category name'}
        />

        <Button
          title={saving ? 'Adding…' : 'Add to fridge'}
          disabled={profileId === null || saving}
          onPress={() => void submit()}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  hint: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  errorText: { color: colors.danger, fontSize: fontSize.sm },
  eyebrow: { ...eyebrow, color: colors.textDim },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footnote: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 16 },
});
