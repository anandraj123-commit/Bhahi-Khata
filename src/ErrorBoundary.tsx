import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "./ui";

export default class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 24,
          backgroundColor: colors.bg,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: colors.dark, fontSize: 22, fontWeight: "700" }}
        >
          Something went wrong
        </Text>
        <Text style={{ color: colors.muted, marginTop: 10, lineHeight: 22 }}>
          Your saved khata data has not been removed. Restart this screen to try
          again.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => this.setState({ failed: false })}
          style={{
            alignSelf: "flex-start",
            marginTop: 20,
            borderRadius: 10,
            paddingHorizontal: 18,
            paddingVertical: 12,
            backgroundColor: colors.green,
          }}
        >
          <Text style={{ color: "white", fontWeight: "700" }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
