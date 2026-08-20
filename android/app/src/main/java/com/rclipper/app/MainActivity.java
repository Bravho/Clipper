package com.rclipper.app;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
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
 * <h2>Why the forward alone is not enough</h2>
 *
 * The whole handshake — the plugin's pending {@code lastcall}, the JS promise,
 * the React state behind the button — lives only in this process's memory, and
 * this process is in the <em>background</em> for the entire Apple leg. If Android
 * reclaims it while Chrome is in front (routine for a WebView shell on a busy
 * device), the deep link cold-starts this activity instead of resuming it. The
 * intent still arrives — Capacitor's {@code BridgeActivity.load()} replays the
 * launch intent through {@code onNewIntent} — but by then
 * {@code SocialLogin.initialize()} has not run, so the plugin has no Apple
 * provider registered and no call to settle. It logs
 * "Provider is not an apple provider (could be null)" inside a
 * {@code catch (Throwable)} and drops the identity token on the floor. To the
 * user the app simply restarts and is still signed out, with no error anywhere.
 *
 * The recovery for that case is on the JS side, in
 * src/lib/mobile/appleAndroidReturn.ts: Capacitor's Bridge captures the launch
 * intent's URI, so {@code App.getLaunchUrl()} still returns the apple-login URL
 * after a cold start, and the web layer redeems the identity token itself. The
 * two paths are deliberately independent — whichever one is still alive wins.
 *
 * See docs/NATIVE_SIGN_IN.md and src/app/api/auth/apple/android-callback/route.ts.
 */
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    private static final String LOG_TAG = "RClipperAuth";

    /** Matches the intent-filter in AndroidManifest.xml and APPLE_ANDROID_DEEP_LINK. */
    private static final String APPLE_LOGIN_SCHEME = "com.rclipper.app";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        // Must precede super.onCreate: BridgeActivity builds its Bridge there,
        // and only plugins registered by that point are in it.
        registerPlugin(PushSupportPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Write the WebView's cookies to disk before this activity loses the
     * foreground.
     *
     * Android's CookieManager keeps cookies in memory and persists them on its
     * own schedule; Capacitor never calls {@link CookieManager#flush()} anywhere
     * in its lifecycle. A cookie set moments before the process dies is
     * therefore simply lost — and the NextAuth session cookie minted by a
     * just-completed sign-in is exactly that cookie.
     *
     * That turned every process death into a silent sign-out. It is what made
     * the FCM crash on "เปิดการแจ้งเตือน" so confusing: the user did not just
     * see the app restart, they came back logged out of an account they had
     * signed into a minute earlier, with nothing to connect the two.
     *
     * onPause is the right hook because it precedes everything that can take the
     * process away — the notification permission dialog, the Sign in with Apple
     * Custom Tab, and an ordinary trip to the home screen.
     */
    @Override
    public void onPause() {
        super.onPause();
        try {
            CookieManager.getInstance().flush();
        } catch (Throwable cause) {
            // A missing WebView provider is fatal to the app anyway; never let
            // a best-effort flush be the thing that reports it.
            Log.w(LOG_TAG, "Could not flush the cookie jar", cause);
        }
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

        // Make this the activity's current intent. If the activity is recreated
        // later (a configuration change, or a process restart while the task is
        // still in recents), Capacitor rebuilds its Bridge from getIntent() and
        // the JS recovery path can still see the apple-login URL. Without this,
        // a warm delivery through onNewIntent is visible exactly once and is
        // lost if whoever was waiting for it has already gone away.
        setIntent(intent);

        // The query carries an identity token; log only the shape of the result.
        Log.i(LOG_TAG, "apple-login deep link received (success=" + data.getQueryParameter("success") + ")");

        forwardToSocialLogin(intent);
    }

    private void forwardToSocialLogin(Intent intent) {
        if (getBridge() == null) {
            // Cold start: the deep link arrived before the bridge existed. The
            // JS side picks it up from App.getLaunchUrl() instead.
            Log.w(LOG_TAG, "apple-login deep link arrived with no bridge; leaving it to the web recovery path");
            return;
        }

        PluginHandle handle = getBridge().getPlugin("SocialLogin");
        if (handle == null) {
            Log.w(LOG_TAG, "SocialLogin plugin not registered; leaving apple-login to the web recovery path");
            return;
        }

        Plugin plugin = handle.getInstance();
        if (plugin instanceof SocialLoginPlugin) {
            // Swallows its own failures (including "no apple provider yet" on a
            // cold start), which is why the web recovery path exists.
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
