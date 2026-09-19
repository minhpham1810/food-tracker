import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/lib/theme';

interface Props {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}

export function LabeledInput({ label, value, onChangeText, placeholder }: Props) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { color: colors.textMuted, fontSize: fontSize.xs },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    fontSize: fontSize.sm,
  },
});
