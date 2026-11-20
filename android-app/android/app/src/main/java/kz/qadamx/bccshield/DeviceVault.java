package kz.qadamx.bccshield;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Only ciphertext goes to disk; the AES key is non-exportable. */
@CapacitorPlugin(name = "DeviceVault")
public class DeviceVault extends Plugin {
    private static final String ALIAS = "qadam.mobile.v2";
    private static final String TRANSFORM = "AES/GCM/NoPadding";

    private synchronized SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
        KeyGenerator gen = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT |
            KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return gen.generateKey();
    }
    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("qadam_ciphertext", 0);
    }
    private String slot(PluginCall call) {
        String slot = call.getString("slot", "");
        if (!slot.matches("[a-zA-Z0-9._-]{1,180}")) throw new IllegalArgumentException();
        return slot;
    }
    @PluginMethod public void openBankDialer(PluginCall call) {
        try {
            getActivity().startActivity(new android.content.Intent(android.content.Intent.ACTION_DIAL,
                android.net.Uri.parse("tel:505")));
            call.resolve();
        } catch (android.content.ActivityNotFoundException noDialer) {
            call.reject("no_dialer");
        }
    }
    @PluginMethod public void openGuardian(PluginCall call) {
        String username = call.getString("username", "");
        if (!username.matches("(?i)[a-z][a-z0-9_]{3,28}bot")) { call.reject("invalid_bot"); return; }
        try {
            getActivity().startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,
                android.net.Uri.parse("tg://resolve?domain=" + username)));
        } catch (android.content.ActivityNotFoundException absent) {
            try {
                getActivity().startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,
                    android.net.Uri.parse("https://t.me/" + username)));
            } catch (android.content.ActivityNotFoundException noBrowser) {
                call.reject("no_handler"); return;
            }
        }
        call.resolve();
    }
    @PluginMethod public void shareInvite(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.matches("https://t[.]me/[A-Za-z][A-Za-z0-9_]{3,31}\\?start=[A-Za-z0-9_-]{20,64}")) {
            call.reject("invalid_invite"); return;
        }
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_SEND);
        intent.setType("text/plain");
        intent.putExtra(android.content.Intent.EXTRA_TEXT, url);
        getActivity().startActivity(android.content.Intent.createChooser(intent, null));
        call.resolve();
    }
    @PluginMethod public void config(PluginCall call) {
        JSObject out = new JSObject();
        out.put("origin", getContext().getString(R.string.qadam_api_origin));
        call.resolve(out);
    }
    @PluginMethod public void put(PluginCall call) {
        try {
            String slot = slot(call);
            String value = call.getString("value");
            SharedPreferences.Editor editor = prefs().edit();
            if (value == null) editor.remove(slot);
            else {
                Cipher cipher = Cipher.getInstance(TRANSFORM);
                cipher.init(Cipher.ENCRYPT_MODE, key());
                cipher.updateAAD(slot.getBytes(StandardCharsets.UTF_8));
                String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." +
                    Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
                editor.putString(slot, encrypted);
            }
            if (!editor.commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception failure) { call.reject("storage_unavailable"); }
    }
    @PluginMethod public void read(PluginCall call) {
        try {
            String slot = slot(call);
            String record = prefs().getString(slot, null);
            JSObject result = new JSObject();
            if (record != null) {
                String[] parts = record.split("\\.", 2);
                Cipher cipher = Cipher.getInstance(TRANSFORM);
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                cipher.updateAAD(slot.getBytes(StandardCharsets.UTF_8));
                result.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception failure) { call.reject("storage_unavailable"); }
    }
}
