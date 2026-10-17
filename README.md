# DashCam Android

UI dashcam (HTML/CSS/JS di `www/`) dibungkus jadi APK dengan Capacitor 6.
Build dilakukan di GitHub Actions; folder `android/` TIDAK disimpan di repo karena dibuat otomatis.

## Build APK
1. Push repo ke GitHub (branch `main`).
2. Tab **Actions > Build Android APK > Run workflow** (atau cukup push).
3. Unduh artefak `dashcam-debug-apk` dari halaman run, lalu pasang `app-debug.apk`.

Jika gagal: buka halaman run, lihat bagian **Summary** (ringkasan penyebab error) atau unduh artefak `dashcam-build-log`.

## Simpan ke galeri HP
Rekaman disalin ke galeri (folder **Movies/DashCam**) oleh plugin native `MediaSaverPlugin`.
Atur di Pengaturan > "Simpan ke Galeri HP": semua rekaman (bawaan), hanya yang ditandai/darurat, atau manual
(tombol "Simpan ke galeri" di pratinjau rekaman). Salinan otomatis ikut terhapus saat loop menimpa segmen lama.

## Kustomisasi native
- `android-overrides/MainActivity.java` : mode imersif, bar sistem hitam.
- `android-overrides/MediaSaverPlugin.java` : plugin penyimpan video ke galeri (MediaStore).
- `android-overrides/ic_launcher*.png`  : ikon aplikasi.
- `scripts/patch-android.py`            : menambah izin kamera/mic/GPS dan mengunci orientasi potret.

## Build lokal (opsional)
```
npm install
npx cap add android
python3 scripts/patch-android.py
npx cap sync android
cd android && ./gradlew assembleDebug
```
Butuh JDK 17 dan Android SDK 34.
