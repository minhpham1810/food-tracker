import { ScrollView, StyleSheet, Text } from 'react-native';

import { Card } from '@/components/Card';
import { fontSize, spacing, useStyles, type ThemeColors } from '@/lib/theme';

const sections = [
  {
    title: '1 · Add food',
    body: 'Tap the center Add button. Photograph the front label and any separate date, size or lot-code areas. You can use up to five photos of the same package. Review every extracted field before adding the item. If there is no readable label, choose Add manually.',
  },
  {
    title: '2 · Read the fridge screen',
    body: 'Items are ordered by urgency. The estimate uses recorded temperature exposure; experimental gas and color-label signals may shorten it, but never extend it. “Outside modelled range” means the app cannot make a defensible estimate from the available profile.',
  },
  {
    title: '3 · Update an item',
    body: 'Tap an item to see Maximize remaining time, rename it, correct its food category, mark it opened, score a supported colorimetric label, or remove it. The recommendation compares the current temperature with a 4°C reference and includes category-specific storage advice. Humidity does not directly change calculated days.',
  },
  {
    title: '4 · Use the assistant',
    body: 'Open Assistant and type a question, or tap the microphone in a native app build. The assistant can read fridge state and request controlled actions such as marking an item opened. Ollama and the Freshness API must be running for replies.',
  },
  {
    title: '5 · Check alerts and sensors',
    body: 'The bell opens active fridge and food alerts. Live Fridge shows the latest temperature, humidity and experimental gas status. “Disconnected” or “Unavailable” means the app does not have a recent usable reading; it does not mean conditions are safe.',
  },
  {
    title: '6 · Fix connection problems',
    body: 'Keep the phone and API computer on the same network. Confirm the API address in the mobile .env file uses the computer’s LAN address, not localhost. For voice input, use a rebuilt native app and allow both microphone and speech-recognition permissions.',
  },
] as const;

export default function UserManualScreen() {
  const styles = useStyles(makeStyles);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        A quick guide to the Freshness Tracker prototype. Estimates support storage decisions;
        they do not certify that food is safe to eat.
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
    heading: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
    body: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
  });
