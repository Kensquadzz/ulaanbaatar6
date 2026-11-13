import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ulaancreative.ub6',
  appName: 'ULAANBAATAR 6',
  webDir: 'dist',
  backgroundColor: '#0b1020',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false }
};

export default config;
