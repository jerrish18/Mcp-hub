import { Tabs } from 'expo-router';
import { useWorkspaceTheme } from '../../ui/workspace';
import { Bot, MessageSquare, Server, Settings } from 'lucide-react-native';

export default function TabLayout() {
  const theme = useWorkspaceTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.onAccentSurface,
        tabBarActiveBackgroundColor: theme.accentSurface,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
        tabBarItemStyle: { borderRadius: 10, marginHorizontal: 4, marginVertical: 4 },
        tabBarStyle: { backgroundColor: theme.panel, borderTopColor: theme.border },

      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size }) => <MessageSquare color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="servers"
        options={{
          title: 'Servers',
          tabBarIcon: ({ color, size }) => <Server color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="agents"
        options={{
          title: 'Agents',
          tabBarIcon: ({ color, size }) => <Bot color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
