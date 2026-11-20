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
            + "body{font:11pt sans-serif;color:#173d33;margin:28pt}header{color:#fff;background:#173f38;padding:14pt;font-weight:bold;letter-spacing:2pt}"
            + "h1{font-size:22pt}h2{font-size:15pt;border-bottom:1pt solid #9db8a9;padding-bottom:6pt;margin-top:18pt}p{line-height:1.4;page-break-inside:avoid}.event{border-left:2pt solid #a6c8b2;padding-left:10pt}.draft{background:#f7eddf;padding:10pt}small{color:#456555}</style><header>QADAM SHIELD</header>");
        for (int i = 0; i < lines.length(); i++) {
            String line = lines.optString(i, "");
            if (line.length() > 640) { call.reject("Line too long"); return; }
            int total = lines.length();
            String tag = i == 0 ? "h1" : (i == 3 || i == total - 3) ? "h2" : i == total - 1 ? "small" : "p";
            String style = i >= 4 && i < total - 3 ? " class='event'" : i == total - 2 ? " class='draft'" : "";
            html.append("<").append(tag).append(style).append(">").append(TextUtils.htmlEncode(line))
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
