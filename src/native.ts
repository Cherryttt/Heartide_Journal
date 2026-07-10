import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

export async function initializeNativeApp() {
  if (!Capacitor.isNativePlatform()) return;

  await StatusBar.setStyle({ style: Style.Light });
  await StatusBar.setOverlaysWebView({ overlay: true });

  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
}
