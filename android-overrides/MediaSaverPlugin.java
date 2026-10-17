package com.dashcam.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Menyimpan video ke galeri HP (folder Movies/DashCam).
 * Android 10+ : MediaStore (tanpa izin tambahan).
 * Android 9 ke bawah : tulis ke folder Movies publik + minta izin WRITE_EXTERNAL_STORAGE.
 *
 * Alur dari JavaScript: begin -> write (berulang, potongan base64) -> finish.
 * Dipotong-potong supaya video besar tidak dikirim sekaligus lewat bridge.
 */
@CapacitorPlugin(
    name = "MediaSaver",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class MediaSaverPlugin extends Plugin {

    private static final String FOLDER = "DashCam";

    private static class Session {
        OutputStream out;
        Uri uri;      // Android 10+
        File file;    // Android 9 ke bawah
        String name;
        String mime;
    }

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private int counter = 0;

    @PluginMethod
    public void begin(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.trim().isEmpty()) {
            call.reject("Parameter name wajib diisi");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermCallback");
            return;
        }
        doBegin(call);
    }

    @PermissionCallback
    private void storagePermCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            doBegin(call);
        } else {
            call.reject("Izin penyimpanan ditolak");
        }
    }

    private void doBegin(PluginCall call) {
        String name = sanitize(call.getString("name"));
        String mime = call.getString("mime", "video/mp4");
        Long takenAt = call.getLong("takenAt");
        try {
            Session s = new Session();
            s.name = name;
            s.mime = mime;
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Video.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Video.Media.MIME_TYPE, mime);
                v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + FOLDER);
                if (takenAt != null) {
                    v.put(MediaStore.Video.Media.DATE_TAKEN, takenAt);
                }
                v.put(MediaStore.Video.Media.IS_PENDING, 1);
                Uri uri = ctx.getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) {
                    throw new IOException("MediaStore menolak membuat berkas");
                }
                s.uri = uri;
                s.out = ctx.getContentResolver().openOutputStream(uri);
                if (s.out == null) {
                    ctx.getContentResolver().delete(uri, null, null);
                    throw new IOException("Tidak bisa membuka berkas tujuan");
                }
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), FOLDER);
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IOException("Tidak bisa membuat folder " + dir.getAbsolutePath());
                }
                s.file = uniqueFile(dir, name);
                s.out = new BufferedOutputStream(new FileOutputStream(s.file));
            }
            String id = "s" + (++counter);
            sessions.put(id, s);
            JSObject r = new JSObject();
            r.put("id", id);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Gagal membuka berkas: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        Session s = id == null ? null : sessions.get(id);
        if (s == null || data == null) {
            call.reject("Sesi tidak valid");
            return;
        }
        try {
            s.out.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            sessions.remove(id);
            discard(s);
            call.reject("Gagal menulis: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void finish(PluginCall call) {
        String id = call.getString("id");
        Session s = id == null ? null : sessions.remove(id);
        if (s == null) {
            call.reject("Sesi tidak valid");
            return;
        }
        try {
            s.out.flush();
            s.out.close();
            JSObject r = new JSObject();
            if (s.uri != null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Video.Media.IS_PENDING, 0);
                getContext().getContentResolver().update(s.uri, v, null, null);
                r.put("uri", s.uri.toString());
            } else {
                MediaScannerConnection.scanFile(
                    getContext(),
                    new String[] { s.file.getAbsolutePath() },
                    new String[] { s.mime },
                    null
                );
                r.put("uri", Uri.fromFile(s.file).toString());
            }
            r.put("name", s.name);
            call.resolve(r);
        } catch (Exception e) {
            discard(s);
            call.reject("Gagal menyelesaikan berkas: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String id = call.getString("id");
        Session s = id == null ? null : sessions.remove(id);
        if (s != null) {
            discard(s);
        }
        call.resolve();
    }

    /** Hapus berkas yang dibuat plugin ini (dipakai saat loop menimpa segmen lama). */
    @PluginMethod
    public void remove(PluginCall call) {
        String raw = call.getString("uri");
        JSObject r = new JSObject();
        if (raw == null) {
            call.reject("Parameter uri wajib diisi");
            return;
        }
        try {
            Uri uri = Uri.parse(raw);
            boolean removed = false;
            if (isAllowedUri(uri)) {
                if ("content".equals(uri.getScheme())) {
                    removed = getContext().getContentResolver().delete(uri, null, null) > 0;
                } else {
                    File f = new File(uri.getPath());
                    removed = f.delete();
                    if (removed) {
                        MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, null, null);
                    }
                }
            }
            r.put("removed", removed);
            call.resolve(r);
        } catch (SecurityException e) {
            // Berkas bukan milik aplikasi ini (mis. setelah pasang ulang): biarkan saja
            r.put("removed", false);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Gagal menghapus: " + e.getMessage(), e);
        }
    }

    /** Buka video di aplikasi pemutar/galeri bawaan HP. */
    @PluginMethod
    public void play(PluginCall call) {
        String raw = call.getString("uri");
        String mime = call.getString("mime", "video/*");
        if (raw == null) {
            call.reject("Parameter uri wajib diisi");
            return;
        }
        try {
            Uri uri = Uri.parse(raw);
            if (!isAllowedUri(uri)) {
                call.reject("Alamat video tidak dikenali");
                return;
            }
            if ("file".equals(uri.getScheme())) {
                // Android 9 ke bawah: file:// tidak boleh dibagikan ke aplikasi lain, pakai content://
                Uri content = contentUriForFile(new File(uri.getPath()));
                if (content == null) {
                    call.reject("Berkas belum terdaftar di galeri");
                    return;
                }
                uri = content;
            }
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Tidak ada aplikasi pemutar video di HP");
        } catch (Exception e) {
            call.reject("Gagal membuka pemutar: " + e.getMessage(), e);
        }
    }

    /** Hanya video MediaStore atau berkas di Movies/DashCam yang boleh dihapus/dibuka lewat plugin ini. */
    private boolean isAllowedUri(Uri uri) throws IOException {
        if (uri == null || uri.getScheme() == null) {
            return false;
        }
        if ("content".equals(uri.getScheme())) {
            String path = uri.getPath() == null ? "" : uri.getPath();
            return "media".equals(uri.getAuthority()) && path.contains("/video/");
        }
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), FOLDER);
            File f = new File(uri.getPath());
            return f.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator);
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private Uri contentUriForFile(File f) {
        Cursor c = getContext().getContentResolver().query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            new String[] { MediaStore.Video.Media._ID },
            MediaStore.Video.Media.DATA + "=?",
            new String[] { f.getAbsolutePath() },
            null
        );
        if (c == null) {
            return null;
        }
        try {
            if (c.moveToFirst()) {
                return ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, c.getLong(0));
            }
        } finally {
            c.close();
        }
        return null;
    }

    private void discard(Session s) {
        try {
            if (s.out != null) {
                s.out.close();
            }
        } catch (Exception ignored) {
        }
        try {
            if (s.uri != null) {
                getContext().getContentResolver().delete(s.uri, null, null);
            } else if (s.file != null) {
                s.file.delete();
            }
        } catch (Exception ignored) {
        }
    }

    private static String sanitize(String name) {
        String n = name == null ? "dashcam.mp4" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        return n.isEmpty() ? "dashcam.mp4" : n;
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        int i = 1;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        while (f.exists()) {
            f = new File(dir, base + "_" + (i++) + ext);
        }
        return f;
    }
}
