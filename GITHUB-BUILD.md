# Build APK melalui GitHub Actions

## 1. Buat repository
1. Masuk ke GitHub.
2. Klik **New repository**.
3. Nama yang disarankan: `DashCam-Lite`.
4. Pilih Public atau Private.
5. Jangan menambahkan README/Gitignore dari GitHub karena file sudah tersedia.
6. Klik **Create repository**.

## 2. Unggah proyek
Unggah **isi folder `dashcam_lite`**, bukan folder ZIP dan bukan satu folder yang membungkus proyek.
Pada root repository harus langsung terlihat:

- `.github/workflows/build-apk.yml`
- `app/`
- `build.gradle.kts`
- `settings.gradle.kts`
- `gradle.properties`

Folder `.github` kadang tersembunyi di file manager. Pastikan folder tersebut ikut diunggah.

## 3. Jalankan build
1. Buka tab **Actions**.
2. Pilih workflow **Build Android APK**.
3. Klik **Run workflow**.
4. Pilih branch `main`.
5. Klik tombol hijau **Run workflow**.
6. Tunggu hingga status centang hijau.

Workflow juga otomatis berjalan setiap ada push ke branch `main` atau `master`.

## 4. Unduh APK
1. Buka hasil workflow yang selesai.
2. Gulir ke bagian **Artifacts**.
3. Unduh `DashCam-Lite-debug-apk`.
4. Ekstrak ZIP artifact.
5. File instalasinya bernama `DashCam-Lite-debug.apk`.

## 5. Instal ke Android
Aktifkan izin instalasi dari sumber tak dikenal untuk aplikasi browser/file manager yang dipakai, lalu buka APK.
APK debug cocok untuk pengujian pribadi, bukan rilis Google Play.

## Jika build gagal
- Pastikan struktur repository benar dan folder `app` berada di root.
- Buka langkah merah pada Actions dan baca pesan paling bawah.
- Jangan mengunggah `local.properties`.
- Workflow memakai JDK 17 dan Gradle 8.9.
