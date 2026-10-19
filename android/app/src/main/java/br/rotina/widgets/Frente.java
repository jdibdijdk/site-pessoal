package br.rotina.widgets;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/** Monta as linhas de cada widget a partir do resumo (uma informação por linha). */
final class Frente {
    static final class Linha {
        final String texto, meta, link;
        final boolean feito, titulo;
        Linha(String texto, String meta, String link, boolean feito, boolean titulo) {
            this.texto = texto; this.meta = meta; this.link = link; this.feito = feito; this.titulo = titulo;
        }
    }

    String nome = "", sub = "", abrir = "";
    int progresso = -1; // 0..100 ou -1 sem barra
    final List<Linha> linhas = new ArrayList<>();
    String vazio = "";

    private static final String[] DIAS = {"Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"};

    static String hoje() { return iso(Calendar.getInstance()); }
    static String iso(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }
    static String mais(String iso, int dias) {
        Calendar c = Calendar.getInstance();
        String[] p = iso.split("-");
        c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]));
        c.add(Calendar.DAY_OF_MONTH, dias);
        return iso(c);
    }
    static String dm(String iso) {
        String[] p = iso.split("-");
        return p.length == 3 ? p[2] + "/" + p[1] : iso;
    }
    static String dia(String iso, String T) {
        if (iso.equals(T)) return "Hoje";
        if (iso.equals(mais(T, 1))) return "Amanhã";
        Calendar c = Calendar.getInstance();
        String[] p = iso.split("-");
        c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]));
        return DIAS[c.get(Calendar.DAY_OF_WEEK) - 1] + ", " + dm(iso);
    }
    static String agora() {
        Calendar c = Calendar.getInstance();
        return String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    }
    private static String enc(String s) {
        try { return java.net.URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    static Frente montar(String f, JSONObject s) {
        Frente r = new Frente();
        String T = hoje();
        JSONArray ev = s.optJSONArray("ev"), tasks = s.optJSONArray("tasks"), habits = s.optJSONArray("habits"),
                notes = s.optJSONArray("notes"), bills = s.optJSONArray("bills");
        if (ev == null) ev = new JSONArray();
        if (tasks == null) tasks = new JSONArray();
        if (habits == null) habits = new JSONArray();
        if (notes == null) notes = new JSONArray();
        if (bills == null) bills = new JSONArray();
        switch (f) {
            case "hoje": {
                r.nome = "Hoje"; r.abrir = "?tab=painel";
                int total = 0, feitos = 0;
                for (int i = 0; i < ev.length(); i++) {
                    JSONObject x = ev.optJSONObject(i);
                    if (x == null || !T.equals(x.optString("d"))) continue;
                    total++;
                    if (x.optInt("ok") == 1) { feitos++; continue; }
                    if (x.optString("e").compareTo(agora()) < 0) continue;
                    if (r.linhas.size() < 4) r.linhas.add(new Linha(x.optString("t"), x.optString("s") + "–" + x.optString("e"), "?tab=semana&d=" + T, false, false));
                }
                int nt = 0;
                for (int i = 0; i < tasks.length(); i++) {
                    JSONObject x = tasks.optJSONObject(i);
                    if (x != null && !x.optString("d").isEmpty() && x.optString("d").compareTo(T) <= 0) nt++;
                }
                int nh = 0, hf = 0;
                for (int i = 0; i < habits.length(); i++) {
                    JSONObject x = habits.optJSONObject(i);
                    if (x == null || !T.equals(x.optString("d"))) continue;
                    nh++; total++;
                    if (x.optInt("ok") == 1) { hf++; feitos++; }
                }
                if (nt > 0) r.linhas.add(new Linha(nt + (nt == 1 ? " tarefa para hoje" : " tarefas para hoje"), "", "?tab=tarefas", false, false));
                if (nh > 0) r.linhas.add(new Linha("Hábitos: " + hf + " de " + nh, "", "?tab=habitos", false, false));
                if (total > 0) { r.progresso = feitos * 100 / total; r.sub = feitos + "/" + total; }
                r.vazio = "Nada pendente hoje.";
                break;
            }
            case "semana": {
                r.nome = "Semana"; r.abrir = "?tab=semana";
                for (int k = 0; k < 2; k++) {
                    String d = mais(T, k);
                    r.linhas.add(new Linha(dia(d, T).toUpperCase(new Locale("pt", "BR")), "", "?tab=semana&d=" + d, false, true));
                    int n = 0;
                    for (int i = 0; i < ev.length() && n < (k == 0 ? 3 : 2); i++) {
                        JSONObject x = ev.optJSONObject(i);
                        if (x == null || !d.equals(x.optString("d"))) continue;
                        n++;
                        r.linhas.add(new Linha(x.optString("t"), x.optString("s") + "–" + x.optString("e"), "?tab=semana&d=" + d, x.optInt("ok") == 1, false));
                    }
                    if (n == 0) r.linhas.add(new Linha("Sem eventos", "", "?tab=semana&d=" + d, false, false));
                }
                break;
            }
            case "tarefas": {
                r.nome = "Tarefas"; r.abrir = "?tab=tarefas";
                if (tasks.length() > 0) r.sub = String.valueOf(tasks.length());
                for (int i = 0; i < tasks.length() && r.linhas.size() < 6; i++) {
                    JSONObject x = tasks.optJSONObject(i);
                    if (x == null) continue;
                    String d = x.optString("d"), m = d.isEmpty() ? "" : (d.compareTo(T) < 0 ? "Atrasada" : dia(d, T));
                    if (!x.optString("h").isEmpty()) m += " " + x.optString("h");
                    r.linhas.add(new Linha(x.optString("t"), m, "?tab=tarefas", false, false));
                }
                r.vazio = "Nenhuma tarefa pendente.";
                break;
            }
            case "habitos": {
                r.nome = "Hábitos"; r.abrir = "?tab=habitos";
                int n = 0, ok = 0;
                for (int i = 0; i < habits.length(); i++) {
                    JSONObject x = habits.optJSONObject(i);
                    if (x == null || !T.equals(x.optString("d"))) continue;
                    n++;
                    boolean feito = x.optInt("ok") == 1;
                    if (feito) ok++;
                    if (r.linhas.size() < 6) {
                        String m = x.optString("s");
                        if (m.isEmpty() && x.optInt("m") > 0) m = x.optInt("m") + " min";
                        r.linhas.add(new Linha((feito ? "✓  " : "") + x.optString("t"), m, "?tab=habitos", feito, false));
                    }
                }
                if (n > 0) { r.progresso = ok * 100 / n; r.sub = ok + "/" + n; }
                r.vazio = "Nenhum hábito para hoje.";
                break;
            }
            case "notas": {
                r.nome = "Notas"; r.abrir = "?tab=notas";
                for (int i = 0; i < notes.length() && r.linhas.size() < 6; i++) {
                    JSONObject x = notes.optJSONObject(i);
                    if (x == null) continue;
                    long u = x.optLong("u");
                    String m = "";
                    if (u > 0) { Calendar c = Calendar.getInstance(); c.setTimeInMillis(u); m = dm(iso(c)); }
                    r.linhas.add(new Linha(x.optString("t"), m, "?nota=" + enc(x.optString("id")), false, false));
                }
                r.vazio = "Nenhuma nota ainda.";
                break;
            }
            default: { // fin
                r.nome = "Finanças"; r.abrir = "?tab=fin";
                for (int i = 0; i < bills.length() && r.linhas.size() < 6; i++) {
                    JSONObject x = bills.optJSONObject(i);
                    if (x == null) continue;
                    r.linhas.add(new Linha(x.optString("t"), dia(x.optString("d"), T) + " · " + x.optString("v"), "?tab=fin", false, false));
                }
                r.vazio = "Nenhuma conta nos próximos dias.";
            }
        }
        return r;
    }

    @SuppressWarnings("unused")
    static String moeda(double v) { return NumberFormat.getCurrencyInstance(new Locale("pt", "BR")).format(v); }
}
