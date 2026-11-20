package kz.qadamx.bccshield;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(DeviceVault.class);
        registerPlugin(PacketPrinter.class);
        super.onCreate(state);
    }
}
