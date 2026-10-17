#!/usr/bin/env python3
"""Sesuaikan proyek Android hasil `npx cap add android` dengan kebutuhan DashCam.

Dijalankan oleh GitHub Actions setelah `cap add android`, sebelum `cap sync`.
Mengedit berkas hasil generate (bukan menimpa total), supaya struktur Gradle
tetap sesuai versi Capacitor yang terpasang.
"""
import glob
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(ROOT, "android")
MAIN = os.path.join(ANDROID, "app", "src", "main")
OVR = os.path.join(ROOT, "android-overrides")
APP_ID_PATH = os.path.join("com", "dashcam", "app")


def die(msg):
    print("GAGAL: " + msg)
    sys.exit(1)


# ---------- 1. AndroidManifest: izin + orientasi ----------
manifest = os.path.join(MAIN, "AndroidManifest.xml")
if not os.path.isfile(manifest):
    die("AndroidManifest.xml tidak ada. Apakah `npx cap add android` sudah dijalankan?")
xml = open(manifest, encoding="utf-8").read()

PERMS = [
    '<uses-permission android:name="android.permission.CAMERA" />',
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '<uses-permission android:name="android.permission.WAKE_LOCK" />',
    '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    # Simpan ke galeri di Android 9 ke bawah (Android 10+ memakai MediaStore tanpa izin)
    '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />',
    '<uses-feature android:name="android.hardware.camera" android:required="true" />',
    '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
]
add = [p for p in PERMS if re.search(re.escape(p.split('"')[1]) + r'"', xml) is None]
if add:
    if "</manifest>" not in xml:
        die("Tag </manifest> tidak ditemukan di AndroidManifest.xml")
    block = "".join("    " + p + "\n" for p in add)
    xml = xml.replace("</manifest>", block + "</manifest>", 1)

if "screenOrientation" not in xml:
    if 'android:name=".MainActivity"' not in xml:
        die('Activity ".MainActivity" tidak ditemukan di AndroidManifest.xml')
    xml = xml.replace(
        'android:name=".MainActivity"',
        'android:name=".MainActivity"\n            android:screenOrientation="portrait"',
        1,
    )
open(manifest, "w", encoding="utf-8").write(xml)
print("OK  AndroidManifest.xml dipatch (%d izin/fitur ditambah)" % len(add))

# ---------- 2. MainActivity (mode imersif, bar hitam) ----------
dest_dir = os.path.join(MAIN, "java", APP_ID_PATH)
if not os.path.isdir(dest_dir):
    die("Folder %s tidak ada. Pastikan appId di capacitor.config.json = com.dashcam.app" % dest_dir)
for java_file in ("MainActivity.java", "MediaSaverPlugin.java"):
    shutil.copyfile(os.path.join(OVR, java_file), os.path.join(dest_dir, java_file))
print("OK  MainActivity.java + MediaSaverPlugin.java dipasang")

# ---------- 3. Ikon aplikasi ----------
res = os.path.join(MAIN, "res")
# Buang ikon adaptif bawaan template dan variasi .webp supaya tidak ada resource ganda.
for f in glob.glob(os.path.join(res, "mipmap-anydpi*", "ic_launcher*.xml")):
    os.remove(f)
for f in glob.glob(os.path.join(res, "mipmap-*", "ic_launcher*.webp")):
    os.remove(f)
for d in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
    folder = os.path.join(res, "mipmap-" + d)
    os.makedirs(folder, exist_ok=True)
    shutil.copyfile(os.path.join(OVR, "ic_launcher.png"), os.path.join(folder, "ic_launcher.png"))
    shutil.copyfile(os.path.join(OVR, "ic_launcher_round.png"), os.path.join(folder, "ic_launcher_round.png"))
print("OK  ikon diganti (PNG biasa, tanpa ikon adaptif)")

print("Selesai.")
