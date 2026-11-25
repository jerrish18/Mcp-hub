import { memo, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { parseInlineTokens, parseMarkdownBlocks } from '@core/utils/markdownParser';
import type { useWorkspaceTheme } from './workspace';

type ChatTheme = ReturnType<typeof useWorkspaceTheme>;

function inline(text: string, theme: ChatTheme) {
  return parseInlineTokens(text).map((token, index) => {
    switch (token.type) {
      case 'bold': return <Text key={index} style={{ fontWeight: '700' }}>{token.text}</Text>;
      case 'italic': return <Text key={index} style={{ fontStyle: 'italic' }}>{token.text}</Text>;
      case 'strike': return <Text key={index} style={{ textDecorationLine: 'line-through' }}>{token.text}</Text>;
      case 'code': return <Text key={index} style={{ fontFamily: 'monospace', backgroundColor: theme.mutedPanel }}>{token.text}</Text>;
      case 'link': return <Text key={index} accessibilityRole="link" style={{ color: theme.accent, textDecorationLine: 'underline' }}
        onPress={() => { void Linking.openURL(token.url).catch(() => {}); }}>{token.label}</Text>;
      case 'image': return token.alt;
      default: return token.text;
    }
  });
}

function SourceBlock({ source, language, theme }: { source: string; language?: string; theme: ChatTheme }) {
  const [open, setOpen] = useState(false);
  const isArtifact = language?.startsWith('artifact-') || language === 'app-project';
  return (
    <View style={{ backgroundColor: theme.background, borderRadius: 10, padding: 10 }}>
      {isArtifact && <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
        <Text style={{ color: theme.accent, fontWeight: '600', paddingVertical: 8 }}>{open ? 'Hide artifact source' : 'View artifact source'}</Text>
      </Pressable>}
      {(!isArtifact || open) && <ScrollView horizontal>
        <Text selectable style={{ color: theme.text, fontFamily: 'monospace', fontSize: 13, lineHeight: 20 }}>{source}</Text>
      </ScrollView>}
    </View>
  );
}

export const ChatReply = memo(function ChatReply({ content, theme }: { content: string; theme: ChatTheme }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  const body = { color: theme.text, fontSize: 15, lineHeight: 23 };
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return <Text key={index} accessibilityRole="header" selectable style={{
              ...body, fontSize: block.level < 3 ? 19 : 16, lineHeight: 25, fontWeight: '700',
            }}>{inline(block.text, theme)}</Text>;
          case 'paragraph':
            return <Text key={index} selectable style={body}>{inline(block.text, theme)}</Text>;
          case 'blockquote':
            return <Text key={index} selectable style={{ ...body, color: theme.muted, paddingLeft: 10,
              borderLeftWidth: 2, borderLeftColor: theme.accent }}>
              {inline([block.calloutTitle, ...block.lines].filter(Boolean).join('\n'), theme)}
            </Text>;
          case 'ul':
          case 'ol':
            return <View key={index} style={{ gap: 5 }}>
              {block.items.map((item, position) => {
                const indicator = typeof item === 'string' ? `${position + 1}.` : item.checked === undefined ? '•' : item.checked ? '✓' : '○';
                return <View key={position} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ ...body, color: theme.muted }}>{indicator}</Text>
                  <Text selectable style={{ ...body, flex: 1 }}>{inline(typeof item === 'string' ? item : item.text, theme)}</Text>
                </View>;
              })}
            </View>;
          case 'code':
            return <SourceBlock key={index} source={block.code} language={block.language} theme={theme} />;
          case 'math_block':
            return <SourceBlock key={index} source={block.latex} theme={theme} />;
          case 'image':
            return <Text key={index} accessibilityRole="link" style={{ ...body, color: theme.accent, textDecorationLine: 'underline' }}
              onPress={() => { void Linking.openURL(block.url).catch(() => {}); }}>{block.caption || block.alt}</Text>;
          case 'table':
            return <ScrollView key={index} horizontal>
              <View>
                {[block.headers, ...block.rows].map((row, rowIndex) => (
                  <View key={rowIndex} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.border,
                    backgroundColor: rowIndex === 0 ? theme.mutedPanel : theme.panel }}>
                    {row.map((cell, cellIndex) => <Text key={cellIndex} selectable style={{ ...body, width: 144,
                      padding: 8, fontWeight: rowIndex === 0 ? '700' : '400' }}>{inline(cell, theme)}</Text>)}
                  </View>
                ))}
              </View>
            </ScrollView>;
          case 'hr':
            return <View key={index} style={{ height: 1, backgroundColor: theme.border }} />;
        }
      })}
    </View>
  );
});
