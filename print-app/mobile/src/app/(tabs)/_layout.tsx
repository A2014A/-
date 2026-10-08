import { Redirect, router } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { colors } from "../../components/ui";
import { useSettings } from "../../lib/settings";

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{glyph}</Text>;
}

function SettingsButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="הגדרות"
      onPress={() => router.push("/settings")}
      hitSlop={12}
      style={{ paddingHorizontal: 16 }}
    >
      <Text style={{ fontSize: 24, color: "#fff" }}>⚙</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { loaded, isConfigured } = useSettings();

  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  // פעם ראשונה: קודם מסך ההגדרות (שם מזמין + מפתח גישה)
  if (!isConfigured) {
    return <Redirect href="/settings" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.accent },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700", fontSize: 20 },
        headerRight: () => <SettingsButton />,
        tabBarActiveTintColor: colors.accent,
        tabBarLabelStyle: { fontSize: 14, fontWeight: "700" },
        tabBarStyle: { height: 64, paddingTop: 6 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "מדבקות", tabBarIcon: ({ focused }) => <TabIcon glyph="🏷️" focused={focused} /> }}
      />
      <Tabs.Screen
        name="cheese"
        options={{ title: "גבינות", tabBarIcon: ({ focused }) => <TabIcon glyph="🧀" focused={focused} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: "היסטוריה", tabBarIcon: ({ focused }) => <TabIcon glyph="🕘" focused={focused} /> }}
      />
    </Tabs>
  );
}
