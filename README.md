# DashCam Lite

Dashcam hemat memori: 426x240 @10fps atau 640x360 @15fps, suara mati secara bawaan,
rekam berputar (segmen 1-10 menit), berkas terlama dihapus otomatis saat melewati batas.

## Build APK lewat GitHub
1. Hapus isi repo lama (atau buat repo baru), lalu unggah semua berkas ini ke root repo.
2. Buka tab Actions > "Build Debug APK" > Run workflow (atau cukup push ke main).
3. Unduh artefak `DashCam-debug-apk` dari halaman run, ekstrak, lalu pasang `app-debug.apk`.

Berkas rekaman ada di Android/data/com.dashcam.lite/files/DashCam/ (bisa diputar/dihapus dari dalam aplikasi).
