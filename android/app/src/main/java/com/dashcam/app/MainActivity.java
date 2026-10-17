package com.dashcam.app;

import android.os.Bundle;
import android.webkit.WebView;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.graphics.Color;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Make app fullscreen (immersive, edge-to-edge) for a dashcam-like feel
        Window window = getWindow();
        window.setStatusBarColor(Color.BLACK);
        window.setNavigationBarColor(Color.BLACK);
        // Layout behind display cutouts (notch)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }

        super.onCreate(savedInstanceState);

        // Hide system bars (immersive mode) for dashcam UI
        hideSystemUI();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    private void hideSystemUI() {
        View decorView = getWindow().getDecorView();
        int uiOptions = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN;
        decorView.setSystemUiVisibility(uiOptions);
    }
}
