import type { CapacitorConfig } from '@capacitor/cli'

// Catatan: Aplikasi web (Next.js) sudah dibuild statis dan disalin ke folder ./www
// Capacitor akan membungkusnya sebagai APK Android.

const config: CapacitorConfig = {
  appId: 'com.dashcam.app',
  appName: 'DashCam',
  webDir: 'www',
  android: {
    allowMixedContent: false,
    backgroundColor: '#000000',
    // Aktifkan orientation lock ke portrait agar konsisten dengan dashcam
    // (ganti ke 'landscape' jika ingin mode landscape)
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#000000',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    // Permission requests ditangani otomatis oleh Capacitor plugins (Camera, Geolocation)
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
