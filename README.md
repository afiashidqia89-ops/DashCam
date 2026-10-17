# DashCam Android — Build APK di GitHub

Aplikasi **DashCam** untuk Android. UI-nya ditulis dengan HTML/CSS/JS biasa (di folder `www/`), lalu dibungkus jadi APK native Android dengan **Capacitor**. Build APK dilakukan otomatis di **GitHub Actions** — tidak butuh Android Studio atau laptop.

> Tujuan awal: merekam perjalanan dengan kualitas **rendah agar tidak boros memori**. Default 480p @ 400 kbps (~3 MB per menit).

---

## ✨ Fitur

- 🎥 UI dashcam asli — preview kamera full-screen, dark theme, overlay jam/GPS/baterai/status REC
- 💾 Kualitas rendah hemat memori — Low / Medium / High (pilih di Settings)
- 🔁 **Loop Recording** — video dipecah per segmen (default 3 menit), segmen lama tak tersimpan otomatis ditimpa
- ⚡ **Emergency Save** — tombol Zap untuk melindungi segmen penting
- 🔄 Switch kamera depan/belakang
- 📍 GPS overlay (lat/lon/speed) dari Geolocation API
- 🔋 Indikator baterai (level + charging status)
- 🎬 Galeri rekaman: thumbnail, preview, download, save, hapus
- 📱 Status bar tersembunyi, support notch (immersive mode)

---

## 📁 Struktur folder

```
dashcam-android/
├── .github/workflows/
│   └── build-apk.yml        # GitHub Actions workflow (build APK otomatis)
├── android/                 # Project Android native (Capacitor)
│   ├── app/
│   │   ├── build.gradle
│   │   ├── proguard-rules.pro
│   │   └── src/main/
│   │       ├── AndroidManifest.xml    # Permissions: CAMERA, GPS, AUDIO, STORAGE
│   │       ├── java/com/dashcam/app/MainActivity.java
│   │       └── res/
│   │           ├── values/
│   │           │   ├── strings.xml
│   │           │   ├── styles.xml
│   │           │   └── colors.xml
│   │           └── xml/file_paths.xml
│   ├── build.gradle
│   ├── settings.gradle
│   ├── variables.gradle
│   ├── gradle.properties
│   ├── gradle/wrapper/gradle-wrapper.properties
│   ├── gradlew
│   └── gradlew.bat
├── www/                     # Web assets (yang dibungkus jadi APK)
│   ├── index.html
│   ├── styles.css
│   ├── app.js               # Semua logika dashcam ada di sini
│   ├── manifest.json
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── capacitor.config.ts      # Konfigurasi Capacitor (appId, appName, dll)
├── package.json             # Dependencies (Capacitor + plugins)
├── tsconfig.json
├── .gitignore
├── LICENSE
└── README.md                # File ini
```

---

## 🚀 Cara Build APK di GitHub (RECOMMEND)

Cara termudah — tanpa install Android Studio di laptop.

### 1. Buat repository baru di GitHub
- Pergi ke https://github.com/new
- Nama repo: `dashcam-android` (atau apa pun)
- Public atau Private, bebas
- **JANGAN** centang "Add a README" atau ".gitignore"
- Klik **Create repository**

### 2. Push file-file ini ke repo

Di komputer lokal (clone repo dulu), salin semua isi folder `dashcam-android/` ke dalam repo lalu commit:

```bash
# clone repo yang baru dibuat
git clone https://github.com/<USERNAME>/dashcam-android.git
cd dashcam-android

# Salin semua file dari folder dashcam-android/ ke sini
# (termasuk folder .github, android, www, dll)

git add .
git commit -m "feat: initial DashCam Android project"
git push origin main
```

### 3. Build APK otomatis berjalan

 begitu Anda push, GitHub Actions akan:
1. Setup Node.js 20 + Java 17 + Android SDK 34
2. Install dependencies Capacitor
3. Sync web assets ke project Android
4. Build debug APK + release APK

Lihat progres di:
**tab Actions** → `Build Android APK` → klik run terbaru.

Build butuh sekitar **5–10 menit** untuk first run (subsequent run pakai cache, jadi lebih cepat).

### 4. Download APK

Setelah build sukses:
1. Buka **tab Actions** → klik run yang sukses
2. Scroll ke bawah ke section **Artifacts**
3. Download **`dashcam-debug-apk`** (untuk test) atau **`dashcam-release-apk-unsigned`** (untuk distribusi)
4. Unzip file yang didownload → dapat `app-debug.apk`
5. Install di HP Android:
   - Transfer APK ke HP, atau
   - Upload ke Google Drive / Telegram, download di HP
   - Buka file manager → tap APK → **izinkan dari sumber ini** → Install

### 5. Buat APK release yang bisa di-upload ke Play Store

APK release dari workflow di atas **belum ditandatangani**. Untuk Play Store, Anda butuh signing keystore:

```bash
# Generate keystore sekali di laptop
keytool -genkey -v -keystore dashcam.keystore -alias dashcam \
  -keyalg RSA -keysize 2048 -validity 10000

# Tambahkan ke GitHub Secrets:
# KEYSTORE_BASE64   -> base64 dari file .keystore
# KEYSTORE_PASSWORD
# KEY_ALIAS         -> "dashcam"
# KEY_PASSWORD

# Lalu tambahkan step signing ke .github/workflows/build-apk.yml
# (lihat komentar di file itu untuk contoh)
```

Untuk distribusi langsung ke teman / pakai sendiri, APK debug sudah cukup.

---

## 🛠️ Cara Build APK Lokal (alternatif jika tidak pakai GitHub Actions)

Butuh di laptop/PC dengan Android Studio. Lebih rumit tapi lebih cepat untuk iterasi.

### Prasyarat
- **Node.js 20+** — https://nodejs.org
- **Android Studio** (dengan Android SDK 34 + Build Tools 34.0.0) — https://developer.android.com/studio
- **Java 17** (terpasang otomatis dengan Android Studio)

### Langkah

```bash
# 1. Install dependency Capacitor
npm install

# 2. Sync web assets ke project Android
npx cap sync android

# 3. Build APK debug
cd android
./gradlew assembleDebug         # Linux/macOS
# atau: gradlew.bat assembleDebug  # Windows

# 4. APK hasil ada di:
#    android/app/build/outputs/apk/debug/app-debug.apk

# 5. Buka project di Android Studio (untuk running di emulator / debug USB):
npx cap open android
```

---

## 🔒 Permissions Android

APK meminta permissions berikut (lihat `AndroidManifest.xml`):

| Permission | Keperluan |
|---|---|
| `CAMERA` | Akses kamera (wajib) |
| `RECORD_AUDIO` | Mikrofon (jika user enable audio di Settings) |
| `ACCESS_FINE_LOCATION` | GPS untuk koordinat & kecepatan |
| `ACCESS_COARSE_LOCATION` | GPS kasar (fallback) |
| `WRITE_EXTERNAL_STORAGE` (SDK ≤28) | Simpan file di Android lama |
| `FOREGROUND_SERVICE` | Recording tetap jalan saat layar mati |
| `WAKE_LOCK` | Cegah sleep saat recording |
| `POST_NOTIFICATIONS` | Notif saat recording (Android 13+) |

Semua permission diminta saat pertama kali pengguna menjalankan fitur terkait.

---

## 🧩 Customisasi

### Ganti nama aplikasi
Edit `android/app/src/main/res/values/strings.xml` → ubah `<string name="app_name">…`

### Ganti package ID
- Edit `capacitor.config.ts` → `appId`
- Edit `android/app/build.gradle` → `applicationId`
- Edit `AndroidManifest.xml` → `package`
- Rename folder `java/com/dashcam/app` → sesuai package baru

### Ganti ikon
Timpa file di `www/icons/icon-192.png` dan `icon-512.png`. Untuk ikon native Android (launcher icon), generate dengan https://romannurik.github.io/AndroidAssetStudio/icons-launcher.html lalu taruh di `android/app/src/main/res/mipmap-*/`

### Ganti kualitas default
Edit `www/app.js` → objek `DEFAULT_SETTINGS` (lihat `quality`, `segmentSeconds`, `maxSegments`)

---

## ❓ Troubleshooting

**Build gagal: "Could not find gradle-wrapper.jar"**
- Tidak perlu khawatir — `android/gradlew` sudah otomatis mendownload `gradle-wrapper.jar` saat pertama dijalankan. Step `Generate Gradle wrapper` di GitHub Actions juga sudah handle ini sebagai backup.
- Jika build lokal di komputer gagal, jalankan: `cd android && ./gradlew assembleDebug` (script akan auto-download wrapper jar) atau `gradle wrapper --gradle-version 8.7` jika Anda punya Gradle terinstall.

**Warning GitHub Actions: "Unexpected input(s) 'sdk-platform', 'sdk-build-tools'"**
- Sudah diperbaiki di versi terbaru workflow — input yang benar untuk `android-actions/setup-android@v3` adalah `packages` (string berisi daftar paket dipisah spasi), contoh: `'platform-tools platforms;android-34 build-tools;34.0.0'`. Push ulang perubahan ke GitHub untuk memakai versi yang benar.

**APK install ditolak: "App not installed"**
- Pastikan "Install unknown apps" diizinkan untuk File Manager / browser Anda
- Untuk Android 13+, izinkan "Restricted setting" di info APK

**Aplikasi buka tapi kamera hitam**
- Buka Settings Android → Apps → DashCam → Permissions → Izinkan Camera
- Restart aplikasi

**GPS tidak muncul overlay**
- Pastikan "Location" aktif di Settings Android
- Izinkan permission lokasi saat diminta
- Restart aplikasi

**Recording berhenti saat layar mati**
- Aktifkan foreground service (sudah dikonfigurasi di manifest)
- Sebagian HP agresif mematikan service — coba matikan "Battery optimization" untuk DashCam di Settings Android

---

## 📝 Lisensi

MIT — bebas pakai, modifikasi, dan distribusi. Lihat `LICENSE`.

## 🙌 Credits

Dibangun dengan:
- [Capacitor](https://capacitorjs.com/) — wrap web jadi APK native
- [GitHub Actions](https://docs.github.com/en/actions) — CI/CD otomatis
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) — perekam video native
