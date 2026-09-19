import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { sendAssistantMessage } from '@/lib/api';
import { colors, eyebrow, fontSize, radius, spacing } from '@/lib/theme';
import type { AssistantToolCall } from '@/lib/types';

interface Exchange {
  id: string;
  question: string;
  reply?: string;
  toolCalls?: AssistantToolCall[];
  error?: string;
}

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

export default function AssistantScreen() {
  const [message, setMessage] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);

  const send = async () => {
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
            ? { ...exchange, reply: result.reply, toolCalls: result.tool_calls }
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
            {item.toolCalls && item.toolCalls.length > 0 && (
              <View style={styles.toolTrace}>
                <Text style={styles.toolTraceLabel}>TOOL CALLS</Text>
                {item.toolCalls.map((call, index) => (
                  <View key={index} style={styles.toolCall}>
                    <Text style={styles.toolCallText}>
                      {call.name}({JSON.stringify(call.arguments)})
                    </Text>
                    {/* The result is the point: it proves the number came from the
                        engine rather than from the model. */}
                    <Text style={styles.toolResultText}>
                      → {JSON.stringify(call.result)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {!item.reply && !item.error && (
              <View style={styles.row}>
                <ActivityIndicator size="small" />
                <Text style={styles.muted}>Thinking…</Text>
              </View>
            )}
          </Card>
        )}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="e.g. What should I eat first?"
          placeholderTextColor={colors.textDim}
          value={message}
          onChangeText={setMessage}
          onSubmitEditing={() => void send()}
        />
        <Button title="Ask" disabled={sending || message.trim().length === 0} onPress={() => void send()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
  toolTrace: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.xs + 2,
    gap: spacing.xs,
  },
  toolTraceLabel: { ...eyebrow, color: colors.textDim },
  toolCall: { gap: 1 },
  toolCallText: { color: colors.codeText, fontSize: fontSize.xs },
  toolResultText: { color: colors.textDim, fontSize: fontSize.xs, paddingLeft: spacing.sm },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
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
});
