import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { LabeledInput } from '@/components/LabeledInput';
import { addItem, getProfiles } from '@/lib/api';
import { formatTemperature, useSettings } from '@/lib/settings';
import { fontSize, spacing, useStyles, type ThemeColors } from '@/lib/theme';
import type { FoodProfile } from '@/lib/types';

export default function AddItemScreen() {
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const { temperatureUnit } = useSettings();
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
      {error !== null && <Text style={styles.errorText}>{error}</Text>}

      <Card>
        <Text style={styles.fieldLabel}>Category</Text>
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
            About {selected.d0_days} days at {formatTemperature(4, temperatureUnit)}, or{' '}
            {selected.opened_d0_days} once opened.
            {selected.placeholder ? ' Demo figures, not validated data.' : ''}
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSize.sm },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footnote: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 16 },
});
