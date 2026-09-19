import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/lib/theme';

interface Props {
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Shown under the field, e.g. the label text OCR could not parse. */
  hint?: string;
}

function display(date: Date): string {
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

/**
 * Optional date + time field that looks like the other form inputs. Tapping it
 * opens the picker: an inline calendar panel on iOS, and the date dialog
 * followed by the time dialog on Android (which has no combined picker). The
 * @expo/ui picker renders nothing on web, so the field is read-only there.
 */
export function DateTimeField({ label, value, onChange, hint }: Props) {
  const [iosOpen, setIosOpen] = useState(false);
  const [androidStep, setAndroidStep] = useState<'date' | 'time' | null>(null);
  const [androidDraft, setAndroidDraft] = useState<Date>(() => value ?? new Date());

  const onPressField = () => {
    if (Platform.OS === 'ios') {
      if (value === null) onChange(new Date());
      setIosOpen((open) => !open);
    } else if (Platform.OS === 'android') {
      setAndroidDraft(value ?? new Date());
      setAndroidStep('date');
    }
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPressField}
        style={[styles.field, iosOpen && styles.fieldActive]}>
        <Text style={[styles.value, value === null && styles.placeholder]} numberOfLines={1}>
          {value ? display(value) : 'Select date and time'}
        </Text>
        {value !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={10}
            onPress={() => {
              setIosOpen(false);
              onChange(null);
            }}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : (
          <Text style={styles.chevron}>▾</Text>
        )}
      </Pressable>

      {Platform.OS === 'ios' && iosOpen && value !== null && (
        <View style={styles.panel}>
          <DateTimePicker
            value={value}
            mode="datetime"
            display="inline"
            themeVariant="dark"
            accentColor={colors.accent}
            onValueChange={(_event, date) => onChange(date)}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setIosOpen(false)}
            style={styles.done}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      )}

      {hint && <Text style={styles.hint}>{hint}</Text>}

      {androidStep === 'date' && (
        <DateTimePicker
          value={androidDraft}
          mode="date"
          accentColor={colors.accent}
          onValueChange={(_event, date) => {
            const next = new Date(androidDraft);
            next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
            setAndroidDraft(next);
            setAndroidStep('time');
          }}
          onDismiss={() => setAndroidStep(null)}
        />
      )}
      {androidStep === 'time' && (
        <DateTimePicker
          value={androidDraft}
          mode="time"
          accentColor={colors.accent}
          onValueChange={(_event, date) => {
            const next = new Date(androidDraft);
            next.setHours(date.getHours(), date.getMinutes(), 0, 0);
            setAndroidStep(null);
            onChange(next);
          }}
          // Keep the chosen day even if the time step is skipped.
          onDismiss={() => {
            setAndroidStep(null);
            onChange(androidDraft);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { color: colors.textMuted, fontSize: fontSize.xs },
  // Same box as LabeledInput so the form reads as one set of fields.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.inputBg,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  fieldActive: { borderColor: colors.accent },
  value: { flex: 1, color: colors.text, fontSize: fontSize.sm },
  placeholder: { color: colors.textDim },
  chevron: { color: colors.textDim, fontSize: fontSize.sm },
  clear: { color: colors.accentText, fontSize: fontSize.xs, fontWeight: '600' },
  panel: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  done: { alignSelf: 'flex-end', paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  doneText: { color: colors.accentText, fontSize: fontSize.sm, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: fontSize.xs },
});
