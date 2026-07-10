import type { CapacitorConfig } from '@capacitor/cli';

const debugBuild = process.env.CAPACITOR_DEBUG === 'true';

const config: CapacitorConfig = {
  appId: 'com.heartide.journal',
  appName: '心潮手帐',
  webDir: 'dist',
  android: {
    allowMixedContent: debugBuild,
  },
  server: {
    androidScheme: 'https',
    cleartext: debugBuild,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#e8eee5',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#00000000',
      overlaysWebView: true,
    },
  },
};

export default config;
