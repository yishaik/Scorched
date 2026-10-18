package com.yishai.scorchedtanks;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  private WebView web;

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(true);
    web.addJavascriptInterface(this, "AndroidShare");
    web.setWebViewClient(new ShareClient());
    setContentView(web);
    hideBars();
    String c = codeFrom(getIntent());
    web.loadUrl("file:///android_asset/index.html" + (c != null ? "#room=" + c : ""));
  }

  private void hideBars() {
    web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
      | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
      | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }

  static String codeFrom(Intent i) {
    if (i == null) return null;
    Uri u = i.getData();
    if (u == null) return null;
    String last = u.getLastPathSegment();
    if (last == null) last = u.getHost();
    if (last != null && last.matches("[A-Za-z]{4}")) return last.toUpperCase();
    return null;
  }

  @Override protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    setIntent(i);
    String c = codeFrom(i);
    if (c != null && web != null) web.evaluateJavascript("location.hash='';location.hash='#room=" + c + "';", null);
  }

  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideBars(); }
  @Override protected void onPause() { super.onPause(); web.onPause(); }
  @Override protected void onResume() { super.onResume(); web.onResume(); }
  @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
  @JavascriptInterface public void share(String text) {
    Intent i = new Intent(Intent.ACTION_SEND); i.setType("text/plain"); i.putExtra(Intent.EXTRA_TEXT, text);
    startActivity(Intent.createChooser(i, "Invite to Scorched Tanks"));
  }
}

class ShareClient extends WebViewClient {
  @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
    if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
      try { v.getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) {}
      return true;
    }
    return false;
  }
  @Override public void onPageFinished(WebView v, String url) {
    v.evaluateJavascript("navigator.share=function(d){AndroidShare.share((d&&(d.text||'')+(d.url?(' '+d.url):''))||'');return Promise.resolve();};navigator.canShare=function(){return true;};", null);
  }
}
