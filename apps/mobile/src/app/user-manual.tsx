import { ScrollView, StyleSheet, Text } from 'react-native';

import { Card } from '@/components/Card';
import { fontSize, spacing, useStyles, type ThemeColors } from '@/lib/theme';

const sections = [
  {
    title: '1 · Add food',
    body: 'Tap the + button and photograph the label. Add more photos if the date, size or lot code sit elsewhere on the package, up to five in all. Check every field before adding. If there is no readable label, choose Add manually.',
  },
  {
    title: '2 · Read the fridge',
    body: 'Items are ordered by urgency, soonest first, and each one shows the days left. The line above them is the fridge right now; it turns orange when the fridge is warm enough to spend shelf life faster. “Outside modelled range” means the app cannot make a defensible estimate for that food.',
  },
  {
    title: '3 · Update an item',
    body: 'Tap an item for its estimate, what to change to keep it longer, and its storage advice. From there you can rename it, correct its category, mark it opened or remove it. Humidity does not change the days left.',
  },
  {
    title: '4 · Use the assistant',
    body: 'Open Assistant and type a question, or tap the microphone in a native build. It can read the fridge and make controlled changes, such as marking an item opened. It needs the local model server running.',
  },
  {
    title: '5 · Check alerts',
    body: 'The bell opens active fridge and food alerts. “Fridge sensor offline” means there is no recent reading — it does not mean conditions are fine.',
  },
  {
    title: '6 · Fix connection problems',
    body: 'Keep the phone and the API computer on the same network, and point the app at the computer’s LAN address rather than localhost. Voice input needs a native build with microphone and speech-recognition permissions.',
  },
] as const;

export default function UserManualScreen() {
  const styles = useStyles(makeStyles);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Estimates support storage decisions. They do not certify that food is safe to eat.
      </Text>
      {sections.map((section) => (
        <Card key={section.title}>
          <Text style={styles.heading}>{section.title}</Text>
          <Text style={styles.body}>{section.body}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
    intro: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 20 },
    heading: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
    body: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
  });
