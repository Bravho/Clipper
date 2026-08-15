package com.rclipper.app;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

/**
 * Implements ModifiedMainActivityForSocialLoginPlugin because Sign in with Apple
 * on Android returns through a deep link, and nothing inside the plugin listens
 * for it. The plugin opens Apple in a Chrome Custom Tab, our server posts the
 * result back as com.rclipper.app://apple-login?..., and Android delivers that to
 * onNewIntent here. If it is not forwarded to the plugin, its pending call never
 * settles and the sign-in button spins for ever.
 *
 * See docs/NATIVE_SIGN_IN.md and src/app/api/auth/apple/android-callback/route.ts.
 */
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    /** Matches the intent-filter in AndroidManifest.xml and APPLE_ANDROID_DEEP_LINK. */
    private static final String APPLE_LOGIN_SCHEME = "com.rclipper.app";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onNewIntent(Intent intent) {
        // Capacitor's own handling first: this activity is also the App Links
        // target for https://app.rclipper.com, and that must keep working.
        super.onNewIntent(intent);

        if (intent == null) {
            return;
        }

        Uri data = intent.getData();
        if (data == null || !APPLE_LOGIN_SCHEME.equals(data.getScheme())) {
            // An https App Link or a launcher intent — not ours to handle.
            return;
        }

        forwardToSocialLogin(intent);
    }

    private void forwardToSocialLogin(Intent intent) {
        if (getBridge() == null) {
            return;
        }

        PluginHandle handle = getBridge().getPlugin("SocialLogin");
        if (handle == null) {
            return;
        }

        Plugin plugin = handle.getInstance();
        if (plugin instanceof SocialLoginPlugin) {
            ((SocialLoginPlugin) plugin).handleAppleLoginIntent(intent);
        }
    }

    /**
     * Marker required by the plugin's interface; the work is in onNewIntent.
     */
    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
        // Intentionally empty.
    }
}
