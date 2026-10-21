package io.github.thewhytewolf.pf2esubsystems;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.EditText;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline host for the same encounter engine used by the browser app. */
public final class MainActivity extends ComponentActivity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/www/index.html";
    private static final int SAVE_BACKUP = 101;
    private static final int OPEN_BACKUP = 102;
    private static final int MAX_BACKUP_BYTES = 5 * 1024 * 1024;
    private final ExecutorService fileWorker = Executors.newSingleThreadExecutor();
    private WebView webView;
    private FrameLayout content;
    private final OnBackPressedCallback backCallback = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() { handleBack(); }
    };
    private boolean resumed;
    private boolean keepAwakeRequested;
    private boolean pageReady;
    private int documentRequest;
    private String pendingRestoreText;
    private TipBilling tipBilling;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, backCallback);
        tipBilling = new TipBilling(this);
        if (state != null) documentRequest = state.getInt("documentRequest", 0);
        content = new FrameLayout(this);
        content.setBackgroundColor(Color.rgb(20, 22, 27));
        setContentView(content);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
            content.requestApplyInsets();
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(20, 22, 27));
        content.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message,
                    String defaultValue, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this);
                input.setInputType(InputType.TYPE_CLASS_TEXT);
                input.setText(defaultValue);
                input.selectAll();
                int margin = Math.round(24 * getResources().getDisplayMetrics().density);
                FrameLayout field = new FrameLayout(MainActivity.this);
                field.setPadding(margin, 0, margin, 0);
                field.addView(input, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
                AlertDialog prompt = new AlertDialog.Builder(MainActivity.this)
                        .setTitle(R.string.app_name).setMessage(message).setView(field)
                        .setPositiveButton(android.R.string.ok,
                                (dialog, which) -> result.confirm(input.getText().toString()))
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel()).create();
                prompt.setOnShowListener(dialog -> {
                    input.requestFocus();
                    prompt.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
                });
                prompt.show();
                return true;
            }
        });
        webView.addJavascriptInterface(new NativeActions(), "PF2ENative");

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (START.equals(url)) {
                    pageReady = true;
                    deliverRestore();
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = assets.shouldInterceptRequest(request.getUrl());
                // Unmatched URLs never fall through to the network.
                return response != null ? response : new WebResourceResponse(
                        "text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
                        new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                        && uri.getPort() == -1 && uri.getPath() != null
                        && uri.getPath().startsWith("/assets/www/")) {
                    return false;
                }
                // Open user-tapped web links in the browser, away from the native bridge.
                if (request.isForMainFrame() && request.hasGesture()
                        && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (ActivityNotFoundException ignored) {
                        // A device may have no browser installed.
                    }
                }
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                content.removeView(view);
                view.destroy();
                webView = null;
                pageReady = false;
                keepAwakeRequested = false;
                updateKeepAwake();
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(R.string.view_stopped)
                        .setPositiveButton(R.string.reload, (dialog, which) -> recreate())
                        .setOnCancelListener(dialog -> finish())
                        .show();
                return true;
            }
        });
        webView.loadUrl(START);
    }

    private void updateBackEnabled(boolean enabled) {
        backCallback.setEnabled(enabled);
    }

    private void handleBack() {
        if (webView == null) { systemBack(); return; }
        webView.evaluateJavascript("handleAndroidBack()", handled -> {
            if (!"true".equals(handled)) systemBack();
        });
    }

    private void systemBack() {
        if (isDestroyed() || isFinishing()) return;
        // Disable this callback before delegating, so the dispatcher can reach Android.
        backCallback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
    }

    private void updateKeepAwake() {
        if (resumed && keepAwakeRequested) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private File stagedBackup() { return new File(getCacheDir(), "pending-library-backup.json"); }

    private void notifyUser(String message) {
        if (isDestroyed() || isFinishing()) return;
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private void deliverRestore() {
        if (pageReady && webView != null && pendingRestoreText != null) {
            String contents = pendingRestoreText;
            pendingRestoreText = null;
            webView.evaluateJavascript("receiveBackupFile(" + JSONObject.quote(contents) + ")", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putInt("documentRequest", documentRequest);
        super.onSaveInstanceState(state);
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SAVE_BACKUP && request != OPEN_BACKUP) return;
        if (result != RESULT_OK || data == null || data.getData() == null) {
            documentRequest = 0;
            if (request == SAVE_BACKUP) stagedBackup().delete();
            return;
        }
        Uri uri = data.getData();
        fileWorker.execute(() -> {
            String restored = null;
            String message = null;
            try {
                if (request == SAVE_BACKUP) {
                    try (InputStream input = new FileInputStream(stagedBackup());
                         OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                        if (output == null) throw new IOException("No output stream");
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                    stagedBackup().delete();
                    message = "Backup file saved.";
                } else {
                    try (InputStream input = getContentResolver().openInputStream(uri);
                         ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        if (input == null) throw new IOException("No input stream");
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (output.size() + count > MAX_BACKUP_BYTES) throw new IOException("Backup too large");
                            output.write(buffer, 0, count);
                        }
                        restored = new String(output.toByteArray(), StandardCharsets.UTF_8);
                    }
                }
            } catch (IOException | SecurityException | IllegalArgumentException error) {
                message = request == SAVE_BACKUP ? "Could not save the backup file. Try another location."
                        : "Could not read that backup. Choose a JSON backup smaller than 5 MB.";
            }
            final String incoming = restored;
            final String status = message;
            runOnUiThread(() -> {
                documentRequest = 0;
                if (isDestroyed() || isFinishing()) return;
                if (incoming != null) { pendingRestoreText = incoming; deliverRestore(); }
                if (status != null) notifyUser(status);
            });
        });
    }

    /** App-owned actions; document access always uses the user's system picker. */
    public final class NativeActions {
        @JavascriptInterface
        public void showTips() {
            runOnUiThread(() -> {
                if (!isDestroyed() && !isFinishing()) tipBilling.showTips();
            });
        }

        @JavascriptInterface
        public void setKeepAwake(boolean enabled) {
            runOnUiThread(() -> {
                if (isDestroyed() || isFinishing()) return;
                keepAwakeRequested = enabled;
                updateKeepAwake();
            });
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void saveBackup(String contents) {
            if (contents == null) return;
            runOnUiThread(() -> {
                if (isDestroyed() || isFinishing()) return;
                if (documentRequest != 0) { notifyUser("Finish choosing a backup file first."); return; }
                documentRequest = SAVE_BACKUP;
                fileWorker.execute(() -> {
                    try {
                        byte[] bytes = contents.getBytes(StandardCharsets.UTF_8);
                        if (bytes.length > MAX_BACKUP_BYTES) throw new IOException("Backup too large");
                        try (OutputStream output = new FileOutputStream(stagedBackup())) { output.write(bytes); }
                        runOnUiThread(() -> {
                            if (isDestroyed() || isFinishing()) return;
                            try {
                                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT)
                                        .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json")
                                        .putExtra(Intent.EXTRA_TITLE, "pf2e-subsystems-backup.json"), SAVE_BACKUP);
                            } catch (ActivityNotFoundException error) {
                                documentRequest = 0;
                                stagedBackup().delete();
                                notifyUser("No document picker is available.");
                            }
                        });
                    } catch (IOException error) {
                        runOnUiThread(() -> { documentRequest = 0; notifyUser("Could not prepare the backup file."); });
                    }
                });
            });
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void openBackup() {
            runOnUiThread(() -> {
                if (isDestroyed() || isFinishing()) return;
                if (documentRequest != 0) { notifyUser("Finish choosing a backup file first."); return; }
                try {
                    documentRequest = OPEN_BACKUP;
                    startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"), OPEN_BACKUP);
                } catch (ActivityNotFoundException error) {
                    documentRequest = 0;
                    notifyUser("No document picker is available.");
                }
            });
        }

        @JavascriptInterface
        public void shareEncounter(String code, String name) {
            if (code == null) return;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                // Keep the text below Android's inter-process transaction limit.
                if (code.length() > 131072) {
                    Toast.makeText(MainActivity.this, R.string.share_too_large, Toast.LENGTH_LONG).show();
                    return;
                }
                Intent send = new Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, name)
                        .putExtra(Intent.EXTRA_TEXT, code);
                try {
                    startActivity(Intent.createChooser(send, getString(R.string.share_encounter)));
                } catch (ActivityNotFoundException exception) {
                    Toast.makeText(MainActivity.this, R.string.no_share_app, Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void setBackEnabled(boolean enabled) {
            runOnUiThread(() -> {
                if (!isFinishing() && !isDestroyed()) updateBackEnabled(enabled);
            });
        }
    }

    @Override
    protected void onPause() {
        resumed = false;
        tipBilling.onPause();
        updateKeepAwake();
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        tipBilling.onResume();
        updateKeepAwake();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        tipBilling.close();
        keepAwakeRequested = false;
        updateKeepAwake();
        fileWorker.shutdownNow();
        updateBackEnabled(false);
        if (webView != null) {
            content.removeView(webView);
            webView.removeJavascriptInterface("PF2ENative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
