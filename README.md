# DashCam Lite

Aplikasi dashcam Android native berbasis Kotlin + CameraX.

## Fitur
- Preview kamera layar penuh gaya dashcam
- Rekam kualitas SD, fallback ke kualitas terendah yang didukung
- Tanpa audio secara default agar file lebih kecil dan lebih privat
- Rekaman otomatis dibagi menjadi segmen 3 menit
- Batas folder sekitar 2 GB, rekaman paling lama dihapus otomatis
- Jam/tanggal, timer REC, penggunaan penyimpanan
- Kamera belakang/depan
- Berhenti otomatis saat aplikasi tidak terlihat

## Cara build
1. Ekstrak ZIP.
2. Buka folder `dashcam_lite` dengan Android Studio.
3. Gunakan JDK 17.
4. Tunggu Gradle Sync selesai.
5. Hubungkan HP dengan USB debugging, lalu Run.
6. Untuk APK: Build > Build Bundle(s) / APK(s) > Build APK(s).

APK debug: `app/build/outputs/apk/debug/app-debug.apk`.

## Lokasi video
Video disimpan di folder khusus aplikasi: `Android/data/com.iqbal.dashcamlite/files/Movies/DashCamLite`.
Menghapus aplikasi dapat ikut menghapus video. Salin video penting terlebih dahulu.

## Catatan
Gunakan hanya saat kendaraan berhenti untuk mengoperasikan tombol. Pasang ponsel dengan dudukan yang stabil dan jangan menutupi pandangan pengemudi.

## Build otomatis di GitHub
Repository ini sudah menyediakan `.github/workflows/build-apk.yml`. Petunjuk lengkap tersedia di `GITHUB-BUILD.md`.
