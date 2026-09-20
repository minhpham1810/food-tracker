import { requireOptionalNativeModule } from 'expo';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  ExpoSpeechRecognitionNativeEventMap,
  ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { sendAssistantMessage } from '@/lib/api';
import {
  eyebrow,
  fontSize,
  radius,
  spacing,
  useStyles,
  useTheme,
  type ThemeColors,
} from '@/lib/theme';

interface Exchange {
  id: string;
  question: string;
  reply?: string;
  error?: string;
}

type VoiceState = 'idle' | 'requesting' | 'listening' | 'processing';

interface ListenerSubscription {
  remove(): void;
}

interface SpeechRecognitionModule {
  start(options: ExpoSpeechRecognitionOptions): void;
  stop(): void;
  abort(): void;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  isRecognitionAvailable(): boolean;
  addListener<EventName extends keyof ExpoSpeechRecognitionNativeEventMap>(
    eventName: EventName,
    listener: (event: ExpoSpeechRecognitionNativeEventMap[EventName]) => void,
  ): ListenerSubscription;
}

// `requireOptionalNativeModule` keeps the rest of the app usable in Expo Go,
// which does not contain this third-party native module. A development/release
// build includes it through the config plugin in app.json.
const speechRecognition =
  requireOptionalNativeModule<SpeechRecognitionModule>('ExpoSpeechRecognition');

const EXAMPLES = ['What should I eat first?', 'Is the milk still good?', 'Mark the spinach opened'];

/**
 * The backend returns 502 when it cannot reach the local model server. That is a
 * configuration state, not a failure of this app, so say so plainly instead of
 * leaving a dead-looking feature on screen.
 */
function isUnreachable(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('Local LLM unavailable') || text.includes('502');
}

function speechErrorMessage(code: string, message: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Microphone or speech recognition permission was denied. Enable it in Settings.';
    case 'no-speech':
    case 'speech-timeout':
      return 'No speech was detected. Tap the microphone and try again.';
    case 'network':
      return 'Speech recognition could not reach the device speech service.';
    case 'service-not-allowed':
    case 'language-not-supported':
      return 'Speech recognition is unavailable for English on this device.';
    case 'audio-capture':
      return 'The microphone could not start. Check that another app is not using it.';
    default:
      return message || 'Voice recognition failed. Please try again.';
  }
}

export default function AssistantScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const speechPrefix = useRef('');

  useEffect(() => {
    if (!speechRecognition) return;

    const subscriptions = [
      speechRecognition.addListener('start', () => setVoiceState('listening')),
      speechRecognition.addListener('result', (event) => {
        const transcript = event.results[0]?.transcript.trim();
        if (!transcript) return;
        setMessage([speechPrefix.current, transcript].filter(Boolean).join(' '));
        if (event.isFinal) setVoiceState('processing');
      }),
      speechRecognition.addListener('nomatch', () => {
        setVoiceError('No speech was recognized. Tap the microphone and try again.');
      }),
      speechRecognition.addListener('error', (event) => {
        setVoiceState('idle');
        if (event.error !== 'aborted') {
          setVoiceError(speechErrorMessage(event.error, event.message));
        }
      }),
      speechRecognition.addListener('end', () => setVoiceState('idle')),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      speechRecognition.abort();
    };
  }, []);

  const toggleVoiceInput = async () => {
    if (!speechRecognition) {
      setVoiceError('Voice input requires a development or release build of the iOS app.');
      return;
    }

    if (voiceState === 'listening') {
      setVoiceState('processing');
      speechRecognition.stop();
      return;
    }
    if (voiceState !== 'idle') return;

    setVoiceError(null);
    setVoiceState('requesting');
    try {
      if (!speechRecognition.isRecognitionAvailable()) {
        setVoiceError('Speech recognition is disabled or unavailable on this device.');
        setVoiceState('idle');
        return;
      }

      const permission = await speechRecognition.requestPermissionsAsync();
      if (!permission.granted) {
        setVoiceError(
          'Microphone and speech recognition access are required. Enable them in Settings.',
        );
        setVoiceState('idle');
        return;
      }

      speechPrefix.current = message.trim();
      speechRecognition.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        addsPunctuation: true,
        iosTaskHint: 'dictation',
        contextualStrings: [
          'freshness',
          'fridge',
          'milk',
          'spinach',
          'chicken',
          'opened',
          'discard',
        ],
      });
      setVoiceState('listening');
    } catch (error) {
      setVoiceState('idle');
      setVoiceError(
        `Could not start voice input: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const send = async () => {
    if (sending || voiceState !== 'idle') return;
    const question = message.trim();
    if (!question) return;
    const id = `${Date.now()}`;
    setExchanges((prev) => [...prev, { id, question }]);
    setMessage('');
    setSending(true);
    try {
      const result = await sendAssistantMessage(question);
      setOffline(false);
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? { ...exchange, reply: result.reply }
            : exchange,
        ),
      );
    } catch (err) {
      const unreachable = isUnreachable(err);
      setOffline(unreachable);
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? {
                ...exchange,
                error: unreachable
                  ? 'No local model server is running.'
                  : `Assistant error: ${err instanceof Error ? err.message : String(err)}`,
              }
            : exchange,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}>
      <FlatList
        data={exchanges}
        keyExtractor={(exchange) => exchange.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {offline ? (
              <Card style={styles.noticeCard}>
                <Text style={styles.noticeTitle}>Assistant is offline</Text>
                <Text style={styles.noticeBody}>
                  This tab needs Ollama or another OpenAI-compatible model server (set
                  {' '}<Text style={styles.code}>LLM_BASE_URL</Text> before starting the API).
                  Everything else in the app — freshness tracking, scanning, alerts — works
                  without it.
                </Text>
              </Card>
            ) : (
              <Text style={styles.hint}>
                Runs against a local model with controlled tool calls — it can read fridge state
                and request actions like marking an item opened, but it never writes freshness
                numbers itself.
              </Text>
            )}
            {exchanges.length === 0 && !offline && (
              <View style={styles.examples}>
                <Text style={styles.examplesLabel}>TRY ASKING</Text>
                {EXAMPLES.map((example) => (
                  <Text key={example} style={styles.exampleText}>
                    · {example}
                  </Text>
                ))}
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.exchange}>
            <Text style={styles.question}>{item.question}</Text>
            {item.error && <Text style={styles.errorText}>{item.error}</Text>}
            {item.reply && <Text style={styles.reply}>{item.reply}</Text>}
            {!item.reply && !item.error && (
              <View style={styles.row}>
                <ActivityIndicator size="small" />
                <Text style={styles.muted}>Thinking…</Text>
              </View>
            )}
          </Card>
        )}
      />
      <View style={styles.composer}>
        {voiceState !== 'idle' && (
          <Text style={styles.voiceStatus} accessibilityLiveRegion="polite">
            {voiceState === 'requesting'
              ? 'Preparing microphone…'
              : voiceState === 'listening'
                ? 'Listening… tap stop when finished.'
                : 'Finishing transcription…'}
          </Text>
        )}
        {voiceError && (
          <Text style={styles.voiceError} accessibilityLiveRegion="polite">
            {voiceError}
          </Text>
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type or speak a question…"
            placeholderTextColor={colors.textDim}
            value={message}
            editable={!sending && voiceState === 'idle'}
            onChangeText={(text) => {
              setMessage(text);
              setVoiceError(null);
            }}
            onSubmitEditing={() => void send()}
            returnKeyType="send"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={voiceState === 'listening' ? 'Stop voice input' : 'Start voice input'}
            accessibilityState={{ disabled: sending || voiceState === 'processing' }}
            disabled={sending || voiceState === 'requesting' || voiceState === 'processing'}
            onPress={() => void toggleVoiceInput()}
            style={({ pressed }) => [
              styles.micButton,
              voiceState === 'listening' && styles.micButtonActive,
              pressed && styles.micButtonPressed,
              (sending || voiceState === 'requesting' || voiceState === 'processing') &&
                styles.micButtonDisabled,
            ]}>
            <SymbolView
              name={voiceState === 'listening' ? 'stop.fill' : 'mic.fill'}
              size={21}
              tintColor={voiceState === 'listening' ? colors.danger : colors.text}
              fallback={
                <Text style={styles.micFallback}>
                  {voiceState === 'listening' ? '■' : '●'}
                </Text>
              }
            />
          </Pressable>
          <Button
            title="Ask"
            disabled={sending || voiceState !== 'idle' || message.trim().length === 0}
            onPress={() => void send()}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { gap: spacing.md, marginBottom: spacing.md },
  hint: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  noticeCard: { borderColor: colors.warningBorder, backgroundColor: colors.warningBg },
  noticeTitle: { color: colors.warning, fontSize: fontSize.md, fontWeight: '700' },
  noticeBody: { color: colors.warning, fontSize: fontSize.sm, lineHeight: 18 },
  code: { color: colors.codeText, fontWeight: '700' },
  examples: { gap: spacing.xs },
  examplesLabel: { ...eyebrow, color: colors.textDim },
  exampleText: { color: colors.textMuted, fontSize: fontSize.sm },
  list: { padding: spacing.lg, gap: spacing.md },
  exchange: { padding: spacing.md, marginBottom: spacing.xs },
  question: { color: colors.accentText, fontWeight: '700' },
  reply: { color: colors.text, lineHeight: 20 },
  errorText: { color: colors.danger, fontSize: fontSize.sm },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  composer: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
  },
  voiceStatus: { color: colors.accentText, fontSize: fontSize.sm },
  voiceError: { color: colors.danger, fontSize: fontSize.sm, lineHeight: 18 },
  micButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.buttonSecondaryBorder,
    backgroundColor: colors.buttonSecondaryBg,
  },
  micButtonActive: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  micButtonPressed: { opacity: 0.75 },
  micButtonDisabled: { opacity: 0.5 },
  micFallback: { color: colors.text, fontSize: fontSize.md },
});
