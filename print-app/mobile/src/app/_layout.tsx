import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { I18nManager } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "../components/ui";
import { HistoryProvider } from "../lib/history";
import { SettingsProvider } from "../lib/settings";

// הממשק כולו בעברית. app.json כבר מכריח RTL ברמת האפליקציה (forcesRTL),
// והקריאות כאן מבטיחות את אותו הדבר גם בהרצה בפיתוח.
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <HistoryProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.accent },
              headerTintColor: "#fff",
              headerTitleStyle: { fontWeight: "700" },
              contentStyle: { backgroundColor: colors.paper },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ title: "הגדרות" }} />
          </Stack>
        </HistoryProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
