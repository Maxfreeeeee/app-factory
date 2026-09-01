// Expo config. Values that differ per app are substituted by new-app.sh.
export default {
  expo: {
    name: "__APP_NAME__",
    slug: "__APP_SLUG__",
    scheme: "__SCHEME__",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: false,
      bundleIdentifier: "__BUNDLE_ID__",
      // Every app ships a privacy manifest; App Store review rejects without it.
      privacyManifests: {
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
            NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
          },
        ],
      },
    },
    android: { package: "__BUNDLE_ID__", edgeToEdgeEnabled: true },
    plugins: [
      "expo-router",
      "expo-secure-store",
      // icons.mjs derives splash-icon.png from assets/icon.png. It keeps its alpha
      // on purpose — it composites onto backgroundColor, which the theme sets.
      ["expo-splash-screen", { image: "./assets/splash-icon.png", backgroundColor: "#0B0B0C", resizeMode: "contain", imageWidth: 200 }],
    ],
    experiments: { typedRoutes: true },
    // `eas init` writes extra.eas.projectId here on first build. Don't invent one.
  },
};
