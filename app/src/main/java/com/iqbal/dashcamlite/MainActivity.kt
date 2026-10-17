package com.iqbal.dashcamlite

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import com.iqbal.dashcamlite.databinding.ActivityMainBinding
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var cameraExecutor: ExecutorService
    private val handler = Handler(Looper.getMainLooper())
    private var videoCapture: VideoCapture<Recorder>? = null
    private var recording: Recording? = null
    private var lensFacing = CameraSelector.LENS_FACING_BACK
    private var recordingRequested = false
    private var segmentStartedAt = 0L

    private val segmentLengthMs = 3 * 60 * 1000L
    private val maxFolderBytes = 2L * 1024 * 1024 * 1024

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) startCamera() else showMessage("Izin kamera diperlukan.") }

    private val clockTask = object : Runnable {
        override fun run() {
            binding.clock.text = SimpleDateFormat("dd MMM yyyy  HH:mm:ss", Locale("id", "ID")).format(Date())
            if (recordingRequested) {
                val elapsed = System.currentTimeMillis() - segmentStartedAt
                binding.timer.text = "%02d:%02d".format(elapsed / 60000, elapsed / 1000 % 60)
                if (elapsed >= segmentLengthMs) rotateSegment()
            }
            updateStorageLabel()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        cameraExecutor = Executors.newSingleThreadExecutor()

        binding.recordButton.setOnClickListener { if (recordingRequested) stopDashcam() else startDashcam() }
        binding.flipButton.setOnClickListener {
            if (recordingRequested) showMessage("Hentikan rekaman sebelum mengganti kamera.")
            else { lensFacing = if (lensFacing == CameraSelector.LENS_FACING_BACK) CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK; startCamera() }
        }
        binding.filesButton.setOnClickListener { showRecordings() }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
        else permissionLauncher.launch(Manifest.permission.CAMERA)
        handler.post(clockTask)
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = binding.preview.surfaceProvider }
            val selector = QualitySelector.fromOrderedList(
                listOf(Quality.SD, Quality.LOWEST),
                FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)
            )
            val recorder = Recorder.Builder().setQualitySelector(selector).build()
            videoCapture = VideoCapture.withOutput(recorder)
            val cameraSelector = CameraSelector.Builder().requireLensFacing(lensFacing).build()
            try {
                provider.unbindAll()
                provider.bindToLifecycle(this, cameraSelector, preview, videoCapture)
                binding.status.text = "SD/LOWEST • Tanpa audio • Segmen 3 menit"
            } catch (e: Exception) { showMessage("Kamera gagal dibuka: ${e.message}") }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun startDashcam() {
        if (videoCapture == null) return showMessage("Kamera belum siap.")
        recordingRequested = true
        startNewSegment()
    }

    private fun startNewSegment() {
        cleanupOldRecordings()
        val folder = recordingFolder().apply { mkdirs() }
        val file = File(folder, "DASH_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.mp4")
        val output = FileOutputOptions.Builder(file).build()
        segmentStartedAt = System.currentTimeMillis()
        recording = videoCapture!!.output.prepareRecording(this, output)
            .start(ContextCompat.getMainExecutor(this)) { event ->
                when (event) {
                    is VideoRecordEvent.Start -> updateRecordingUi(true)
                    is VideoRecordEvent.Finalize -> {
                        recording = null
                        if (event.hasError()) showMessage("Rekaman bermasalah: ${event.error}")
                        if (recordingRequested) handler.postDelayed({ startNewSegment() }, 300)
                        else updateRecordingUi(false)
                    }
                }
            }
    }

    private fun rotateSegment() {
        segmentStartedAt = Long.MAX_VALUE
        recording?.stop()
    }

    private fun stopDashcam() {
        recordingRequested = false
        recording?.stop()
        binding.timer.text = "00:00"
        updateRecordingUi(false)
    }

    private fun updateRecordingUi(active: Boolean) {
        if (active) {
            binding.recBadge.text = "● REC"
            binding.recBadge.setTextColor(Color.RED)
            binding.recordButton.text = "■ STOP"
        } else {
            binding.recBadge.text = "● SIAP"
            binding.recBadge.setTextColor(Color.WHITE)
            binding.recordButton.text = "● REKAM"
        }
    }

    private fun recordingFolder(): File = File(getExternalFilesDir(Environment.DIRECTORY_MOVIES), "DashCamLite")

    private fun cleanupOldRecordings() {
        val files = recordingFolder().listFiles { f -> f.extension.equals("mp4", true) }?.sortedBy { it.lastModified() }?.toMutableList() ?: return
        var total = files.sumOf { it.length() }
        while (total > maxFolderBytes * 9 / 10 && files.isNotEmpty()) {
            val oldest = files.removeAt(0)
            val size = oldest.length()
            if (oldest.delete()) total -= size
        }
    }

    private fun updateStorageLabel() {
        val bytes = recordingFolder().listFiles()?.sumOf { it.length() } ?: 0L
        binding.storage.text = "Rekaman: ${bytes / 1024 / 1024} MB / 2 GB"
    }

    private fun showRecordings() {
        val files = recordingFolder().listFiles { f -> f.extension.equals("mp4", true) }?.sortedByDescending { it.lastModified() } ?: emptyList()
        val names = if (files.isEmpty()) arrayOf("Belum ada rekaman") else files.take(20).map { "${it.name}  (${it.length() / 1024 / 1024} MB)" }.toTypedArray()
        AlertDialog.Builder(this).setTitle("Rekaman terbaru").setItems(names, null).setPositiveButton("Tutup", null).show()
    }

    private fun showMessage(message: String) = AlertDialog.Builder(this).setMessage(message).setPositiveButton("OK", null).show()

    override fun onStop() {
        super.onStop()
        if (recordingRequested) stopDashcam()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        recording?.stop()
        cameraExecutor.shutdown()
        super.onDestroy()
    }
}
