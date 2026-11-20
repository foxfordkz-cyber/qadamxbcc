package kz.qadamx.bccshield;

import android.content.Context;
import android.graphics.Color;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.text.TextUtils;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PacketPrinter")
public class PacketPrinter extends Plugin {
    private WebView document;

    @PluginMethod public void print(PluginCall call) {
        JSArray lines = call.getArray("lines");
        if (lines == null || lines.length() < 5 || lines.length() > 128) {
            call.reject("Invalid document");
            return;
        }
        StringBuilder html = new StringBuilder("<!doctype html><meta charset=utf-8><style>"
            + "body{font:12pt sans-serif;color:#173d33;margin:32pt}header{color:#236451;font-weight:bold}"
            + "h1{font-size:24pt}p{line-height:1.5;page-break-inside:avoid}</style><header>QADAM SHIELD</header>");
        for (int i = 0; i < lines.length(); i++) {
            String line = lines.optString(i, "");
            if (line.length() > 640) { call.reject("Line too long"); return; }
            String tag = i == 0 ? "h1" : "p";
            html.append("<").append(tag).append(">").append(TextUtils.htmlEncode(line))
                .append("</").append(tag).append(">");
        }
        getActivity().runOnUiThread(() -> {
            if (document != null) document.destroy();
            document = new WebView(getActivity());
            document.setBackgroundColor(Color.WHITE);
            document.getSettings().setBlockNetworkLoads(true);
            document.getSettings().setAllowFileAccess(false);
            document.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    if (manager == null) { call.reject("Printing unavailable"); return; }
                    String name = "Qadam Shield";
                    manager.print(name, view.createPrintDocumentAdapter(name), new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                    call.resolve();
                }
            });
            document.loadDataWithBaseURL(null, html.toString(), "text/html", "UTF-8", null);
        });
    }

    @Override protected void handleOnDestroy() {
        if (document != null) document.destroy();
    }
}

