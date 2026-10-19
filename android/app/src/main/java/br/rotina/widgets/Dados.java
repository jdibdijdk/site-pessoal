package br.rotina.widgets;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Busca o resumo que o site grava no Firestore (rotina/<chave>_widgets) e guarda a última cópia no aparelho. */
final class Dados {
    static final String PROJETO = "site-pessoal-b4b19";
    static final String API_KEY = "AIzaSyBU4owCJwloUlcfTP-cOeHjEo5hyzMH2tU";
    static final String CHAVE = "hRM2z3YEF6yPtTwKQyFMIAQs551d6Jwh";
    private static final String URL_DOC = "https://firestore.googleapis.com/v1/projects/" + PROJETO
            + "/databases/(default)/documents/rotina/" + CHAVE + "_widgets?key=" + API_KEY;

    private Dados() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("rotina", Context.MODE_PRIVATE);
    }

    /** Última cópia guardada (ou null). */
    static JSONObject cache(Context c) {
        String s = prefs(c).getString("json", null);
        if (s == null) return null;
        try { return new JSONObject(s); } catch (Exception e) { return null; }
    }

    /** Endereço do site: o escolhido no app ou o que o próprio site informou no resumo. */
    static String site(Context c) {
        String u = prefs(c).getString("site", "");
        if (u.isEmpty()) {
            JSONObject j = cache(c);
            if (j != null) u = j.optString("url", "");
        }
        if (!u.isEmpty() && !u.endsWith("/")) u += "/";
        return u;
    }

    /** Baixa o resumo; devolve true se trouxe dados novos. Roda fora da linha principal. */
    static boolean baixar(Context c) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(URL_DOC).openConnection();
            con.setConnectTimeout(10000);
            con.setReadTimeout(15000);
            if (con.getResponseCode() != 200) return false;
            InputStream in = con.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            JSONObject doc = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            String json = doc.getJSONObject("fields").getJSONObject("json").getString("stringValue");
            new JSONObject(json); // confere se é válido antes de guardar
            prefs(c).edit().putString("json", json).putLong("baixado", System.currentTimeMillis()).apply();
            return true;
        } catch (Exception e) {
            prefs(c).edit().putString("erro", String.valueOf(e.getMessage())).apply();
            return false;
        } finally {
            if (con != null) con.disconnect();
        }
    }
}
