package com.rclipper.app;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Answers one question the web layer cannot ask any other way: is Firebase
 * actually initialised in <em>this binary</em>?
 *
 * <h2>Why this exists</h2>
 *
 * {@code PushNotifications.register()} opens with
 * {@code FirebaseMessaging.getInstance()}. With no default FirebaseApp that
 * throws {@code IllegalStateException: Default FirebaseApp is not initialized in
 * this process}. It is thrown on Capacitor's plugin HandlerThread, and
 * {@code Bridge.callPluginMethod} does not swallow it — it logs
 * "Serious error executing plugin" and <b>rethrows it as a RuntimeException</b>
 * on that thread. An uncaught exception on a HandlerThread kills the process.
 *
 * So on a build without {@code android/app/google-services.json} — which
 * {@code build.gradle} deliberately allows, so a checkout with no Firebase
 * credentials still compiles — tapping "เปิดการแจ้งเตือน" does not fail, it
 * <b>terminates the app</b>. Android relaunches the activity, the WebView reloads
 * from {@code server.url}, and because Capacitor never flushes the cookie jar the
 * session cookie set minutes earlier is gone too: the user is thrown back to the
 * login screen with no explanation. That is the bug this plugin prevents.
 *
 * A try/catch in TypeScript cannot help — the throw is native, on another
 * thread, and the JS promise simply never settles because the process is gone.
 * The only fix is to not make the call, which means asking first.
 *
 * <h2>Reflection, deliberately</h2>
 *
 * {@code FirebaseApp} reaches this module only transitively through
 * {@code capacitor-push-notifications}, so referring to it directly would couple
 * this file to that plugin's dependency configuration. Reflection keeps the
 * probe working — and still returning {@code false} rather than throwing — even
 * in a build where Firebase is absent from the classpath entirely.
 */
@CapacitorPlugin(name = "PushSupport")
public class PushSupportPlugin extends Plugin {

    private static final String LOG_TAG = "RClipperPush";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean available = firebaseInitialised(getContext());
        if (!available) {
            Log.w(LOG_TAG, "Firebase is not initialised in this build; push registration will be skipped. " + "Add android/app/google-services.json and rebuild to enable it.");
        }

        JSObject result = new JSObject();
        result.put("available", available);
        call.resolve(result);
    }

    /**
     * True when a default FirebaseApp exists, i.e. the google-services plugin ran
     * at build time and the ContentProvider initialised it at startup.
     *
     * {@code FirebaseApp.getApps(context)} is used rather than
     * {@code getInstance()} precisely because it <em>returns an empty list</em>
     * instead of throwing when nothing is configured.
     */
    private static boolean firebaseInitialised(Context context) {
        try {
            Class<?> firebaseApp = Class.forName("com.google.firebase.FirebaseApp");
            Object apps = firebaseApp.getMethod("getApps", Context.class).invoke(null, context);
            return apps instanceof List && !((List<?>) apps).isEmpty();
        } catch (Throwable cause) {
            // Firebase not on the classpath, or the API moved. Either way the
            // honest answer is "do not call register()".
            Log.w(LOG_TAG, "Could not probe Firebase state; assuming push is unavailable", cause);
            return false;
        }
    }
}
