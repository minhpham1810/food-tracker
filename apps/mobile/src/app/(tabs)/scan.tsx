import * as ImagePicker from 'expo-image-picker';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DateTimeField } from '@/components/DateTimeField';
import { LabeledInput } from '@/components/LabeledInput';
import { getProfiles, ocrConfirm, ocrScan } from '@/lib/api';
import { formatPrintedDate, parsePrintedDate } from '@/lib/dates';
import { fontSize, radius, spacing, useStyles, type ThemeColors } from '@/lib/theme';
import type { FoodProfile, OCRResult } from '@/lib/types';

/** Below this, the extracted fields need an explicit warning. */
const LOW_CONFIDENCE = 0.6;
const MAX_PHOTOS = 5;

/** The editable form behind the OCR result. Every field is user-correctable. */
interface Draft {
  name: string;
  brand: string;
  printedDate: Date | null;
  packageSize: string;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function ScanScreen() {
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<OCRResult | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Deliberately starts null: an unrecognised label must NOT silently become dairy.
  const [profileId, setProfileId] = useState<string | null>(null);
  const [categoryConfirmed, setCategoryConfirmed] = useState(false);
  const [profiles, setProfiles] = useState<FoodProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Tabs stay mounted, so a one-time fetch would keep a stale category list
  // (or an empty one after a failed request) until the app restarts.
  useFocusEffect(
    useCallback(() => {
      getProfiles()
        .then(setProfiles)
        .catch(() => undefined);
    }, []),
  );

  const reset = () => {
    setPhotoUris([]);
    setCategoryConfirmed(false);
    setResult(null);
    setDraft(null);
    setProfileId(null);
  };

  const clearScanResult = () => {
    setCategoryConfirmed(false);
    setResult(null);
    setDraft(null);
    setProfileId(null);
  };

  const pickPhotos = async (source: 'camera' | 'library') => {
    setError(null);
    if (photoUris.length >= MAX_PHOTOS) {
      setError(`A scan supports up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        `Permission to use the ${source === 'camera' ? 'camera' : 'photo library'} was denied.`,
      );
      return;
    }
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.7,
            allowsMultipleSelection: true,
            selectionLimit: MAX_PHOTOS - photoUris.length,
          });
    if (picked.canceled || picked.assets.length === 0) return;

    const additions = picked.assets.map((asset) => asset.uri);
    setPhotoUris((current) => [...new Set([...current, ...additions])].slice(0, MAX_PHOTOS));
    clearScanResult();
  };

  const removePhoto = (uri: string) => {
    setPhotoUris((current) => current.filter((photo) => photo !== uri));
    clearScanResult();
  };

  const scanPhotos = async () => {
    if (photoUris.length === 0) return;
    setError(null);
    setScanning(true);
    clearScanResult();
    try {
      const scanned = await ocrScan(photoUris);
      setResult(scanned);
      setDraft({
        name: scanned.product_name,
        brand: scanned.brand ?? '',
        printedDate: parsePrintedDate(scanned.printed_date),
        packageSize: scanned.package_size ?? '',
      });
      setProfileId(scanned.suggested_profile_id);
    } catch (err) {
      setError(`OCR scan failed: ${err instanceof Error ? err.message : String(err)}`);
      router.push('/add-item');
    } finally {
      setScanning(false);
    }
  };

  const confirm = async () => {
    if (!draft || profileId === null || !categoryConfirmed) return;
    setConfirming(true);
    setError(null);
    try {
      await ocrConfirm({
        category_confirmed: categoryConfirmed,
        profile_id: profileId,
        // Adopts the photo this scan already uploaded as the item's thumbnail.
        scan_id: result?.scan_id ?? null,
        name: emptyToNull(draft.name),
        brand: emptyToNull(draft.brand),
        printed_date: draft.printedDate ? formatPrintedDate(draft.printedDate) : null,
        package_size: emptyToNull(draft.packageSize),
        lot_code: null,
      });
      reset();
      router.push('/');
    } catch (err) {
      setError(`Could not add this item: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConfirming(false);
    }
  };

  /**
   * Which line is the product and which is the brand is genuinely ambiguous:
   * some cartons set the product largest ("WHOLE MILK" over "Fresh Valley"),
   * others set the brand largest ("ORGANIC VALLEY" over the product). No
   * heuristic gets both right, so make correcting it one tap.
   */
  const swapNameAndBrand = () => {
    if (!draft) return;
    setDraft({ ...draft, name: draft.brand, brand: draft.name });
  };

  // OCR found a date but it isn't in a form we can parse; show it so the user can pick it by hand.
  const unparsedDateHint =
    result?.printed_date && parsePrintedDate(result.printed_date) === null
      ? `Label reads "${result.printed_date}"`
      : undefined;
  const unreadable = result !== null && result.raw_text.trim().length === 0;
  const nameIsEmpty = draft !== null && draft.name.trim().length === 0;
  const canConfirm = draft !== null && profileId !== null && categoryConfirmed && !nameIsEmpty && !confirming;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>Photograph the label, then check the fields before adding.</Text>

      <View style={styles.buttonRow}>
        <Button
          title={photoUris.length > 0 ? 'Add photo' : 'Take photo'}
          onPress={() => void pickPhotos('camera')}
          disabled={scanning || photoUris.length >= MAX_PHOTOS}
          style={styles.flexButton}
        />
        <Button
          title="Choose photos"
          variant="secondary"
          onPress={() => void pickPhotos('library')}
          disabled={scanning || photoUris.length >= MAX_PHOTOS}
          style={styles.flexButton}
        />
      </View>

      {(
        <Link href="/add-item" asChild>
          <Pressable accessibilityRole="button" style={styles.disclosure}>
            <Text style={styles.manualLink}>No label? Add it manually</Text>
          </Pressable>
        </Link>
      )}

      {photoUris.length > 0 && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.previewRow}>
            {photoUris.map((uri, index) => (
              <View key={uri} style={styles.previewTile}>
                <Image source={{ uri }} style={styles.preview} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1}`}
                  disabled={scanning}
                  onPress={() => removePhoto(uri)}
                  style={styles.removePhoto}>
                  <Text style={styles.removePhotoText}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          {!result && (
            <Button
              title={scanning ? 'Reading…' : 'Read label'}
              disabled={scanning}
              onPress={() => void scanPhotos()}
            />
          )}
        </>
      )}

      {scanning && (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text style={styles.muted}>Reading label…</Text>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {unreadable && (
        <Card>
          <Text style={styles.sectionTitle}>Couldn&apos;t read this label</Text>
          <Text style={styles.muted}>
            No text came through. Hold steady until it focuses, add light, and fill the frame
            with the text.
          </Text>
          <Button title="Add another photo" onPress={() => void pickPhotos('camera')} />
          <Button title="Scan again" variant="secondary" onPress={() => void scanPhotos()} />
          <Button title="Discard" variant="secondary" onPress={reset} />
        </Card>
      )}

      {result && draft && !unreadable && (
        <Card>
          <Text style={styles.sectionTitle}>Check the details</Text>
          {result.confidence < LOW_CONFIDENCE && (
            <Text style={styles.warnText}>The label read poorly. Check each field.</Text>
          )}

          <LabeledInput
            label="Product name"
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            placeholder="e.g. Whole milk"
          />
          {nameIsEmpty && <Text style={styles.errorText}>A name is required.</Text>}

          <Pressable accessibilityRole="button" onPress={swapNameAndBrand} style={styles.disclosure}>
            <Text style={styles.disclosureText}>⇅ Swap name and brand</Text>
          </Pressable>

          <LabeledInput
            label="Brand"
            value={draft.brand}
            onChangeText={(brand) => setDraft({ ...draft, brand })}
            placeholder="Optional"
          />
          <DateTimeField
            label="Printed date"
            value={draft.printedDate}
            onChange={(printedDate) => setDraft({ ...draft, printedDate })}
            hint={unparsedDateHint}
          />
          <LabeledInput
            label="Package size"
            value={draft.packageSize}
            onChangeText={(packageSize) => setDraft({ ...draft, packageSize })}
            placeholder="e.g. 1 gal"
          />

          <Text style={styles.fieldLabel}>Category</Text>
          {!categoryConfirmed && (
            <Text style={styles.warnText}>
              Tap the right category to confirm it — it sets the freshness budget.
            </Text>
          )}
          <View style={styles.chipRow}>
            {profiles.map((profile) => (
              <Chip
                key={profile.id}
                label={profile.name}
                selected={profile.id === profileId}
                onPress={() => { setProfileId(profile.id); setCategoryConfirmed(true); }}
              />
            ))}
          </View>

          <Button
            title={confirming ? 'Adding…' : 'Add to fridge'}
            disabled={!canConfirm}
            onPress={() => void confirm()}
          />
          <Button title="Discard" variant="secondary" disabled={confirming} onPress={reset} />
        </Card>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  hint: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  warnText: { color: colors.warning, fontSize: fontSize.sm, lineHeight: 18 },
  errorText: { color: colors.danger, fontSize: fontSize.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexButton: { flex: 1 },
  previewRow: { gap: spacing.sm },
  previewTile: { width: 180, gap: spacing.xs },
  preview: {
    width: 180,
    height: 150,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  removePhoto: { alignSelf: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  removePhotoText: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '600' },
  sectionTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600', letterSpacing: -0.3 },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.sm },
  disclosure: { paddingVertical: spacing.xs },
  disclosureText: { color: colors.accentText, fontSize: fontSize.xs, fontWeight: '600' },
  manualLink: { color: colors.accentText, fontSize: fontSize.sm, fontWeight: '600' },
});
