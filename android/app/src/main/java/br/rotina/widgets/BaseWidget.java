package br.rotina.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Base dos seis widgets: desenha na hora com a última cópia e depois busca o resumo novo. */
public abstract class BaseWidget extends AppWidgetProvider {
    static final String ATUALIZAR = "br.rotina.widgets.ATUALIZAR";
    static final Class<?>[] TODOS = {HojeWidget.class, SemanaWidget.class, TarefasWidget.class, HabitosWidget.class, NotasWidget.class, FinWidget.class};
    private static final int[] LINHA = {R.id.r0, R.id.r1, R.id.r2, R.id.r3, R.id.r4, R.id.r5};
    private static final int[] TEXTO = {R.id.r0t, R.id.r1t, R.id.r2t, R.id.r3t, R.id.r4t, R.id.r5t};
    private static final int[] META = {R.id.r0m, R.id.r1m, R.id.r2m, R.id.r3m, R.id.r4m, R.id.r5m};
    private static final int[] PONTO = {R.id.r0d, R.id.r1d, R.id.r2d, R.id.r3d, R.id.r4d, R.id.r5d};

    abstract String frente();

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        desenhar(c, getClass(), frente());
        buscar(c);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        if (ATUALIZAR.equals(i.getAction())) buscar(c);
    }

    /** Busca o resumo fora da linha principal e redesenha todos os widgets. */
    private void buscar(Context c) {
        final Context app = c.getApplicationContext();
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                Dados.baixar(app);
                redesenharTodos(app);
            } finally {
                pr.finish();
            }
        }).start();
    }

    static void redesenharTodos(Context c) {
        String[] f = {"hoje", "semana", "tarefas", "habitos", "notas", "fin"};
        for (int i = 0; i < TODOS.length; i++) desenhar(c, TODOS[i], f[i]);
    }

    static int icone(String f) {
        switch (f) {
            case "semana": return R.drawable.ic_h_semana;
            case "tarefas": return R.drawable.ic_h_tarefas;
            case "habitos": return R.drawable.ic_h_habitos;
            case "notas": return R.drawable.ic_h_notas;
            case "fin": return R.drawable.ic_h_fin;
            default: return R.drawable.ic_h_hoje;
        }
    }

    private static PendingIntent abrir(Context c, String url, int req) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle op) {
        desenhar(c, getClass(), frente());
    }

    static void desenhar(Context c, Class<?> cls, String frente) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, cls))) desenharUm(c, m, id, cls, frente);
    }

    /** Um widget por vez: a quantidade de linhas acompanha o tamanho (4x3, 2x2, 2x1…). */
    static void desenharUm(Context c, AppWidgetManager m, int wid, Class<?> cls, String frente) {
        int[] ids = {wid};
        Bundle op = m.getAppWidgetOptions(wid);
        int hDp = op.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
        int cap = Math.max(1, Math.min(6, (hDp - 64) / 38));
        boolean mini = hDp < 100;
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        JSONObject s = Dados.cache(c);
        String site = Dados.site(c);
        int base = frente.hashCode() & 0xffff;

        Intent atu = new Intent(c, cls).setAction(ATUALIZAR);
        v.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(c, base, atu, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        if (s == null) {
            v.setImageViewResource(R.id.ico, icone(frente));
            v.setTextViewText(R.id.title, "Rotina");
            v.setTextViewText(R.id.sub, "");
            v.setTextViewText(R.id.empty, "Abra o site da Rotina com o Firebase conectado para preparar o widget.");
            v.setViewVisibility(R.id.empty, View.VISIBLE);
            for (int id : LINHA) v.setViewVisibility(id, View.GONE);
            v.setViewVisibility(R.id.bar, View.GONE);
            v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(c, base + 1,
                    new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE));
            m.updateAppWidget(ids, v);
            return;
        }

        v.setImageViewResource(R.id.ico, icone(frente));
        Frente f = Frente.montar(frente, s);
        v.setTextViewText(R.id.title, f.nome);
        v.setTextViewText(R.id.sub, f.sub);
        if (f.progresso >= 0 && !mini) { v.setViewVisibility(R.id.bar, View.VISIBLE); v.setProgressBar(R.id.bar, 100, f.progresso, false); }
        else v.setViewVisibility(R.id.bar, View.GONE);

        boolean vazio = f.linhas.isEmpty();
        v.setViewVisibility(R.id.empty, vazio ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.empty, f.vazio);
        for (int i = 0; i < LINHA.length; i++) {
            if (i >= f.linhas.size() || i >= cap) { v.setViewVisibility(LINHA[i], View.GONE); continue; }
            Frente.Linha l = f.linhas.get(i);
            v.setViewVisibility(LINHA[i], View.VISIBLE);
            v.setTextViewText(TEXTO[i], l.texto);
            v.setTextViewText(META[i], l.meta);
            v.setViewVisibility(PONTO[i], l.titulo ? View.GONE : View.VISIBLE);
            v.setTextViewTextSize(TEXTO[i], android.util.TypedValue.COMPLEX_UNIT_SP, l.titulo ? 11 : (mini ? 16 : 14));
            // sem setTextColor: a cor vem do tema (claro/escuro) e só a opacidade muda; assim o texto não some ao trocar o tema
            v.setFloat(TEXTO[i], "setAlpha", (l.feito || l.titulo) ? 0.55f : 1f);
            if (!site.isEmpty()) v.setOnClickPendingIntent(LINHA[i], abrir(c, site + l.link, base + 10 + i));
        }

        v.setViewVisibility(R.id.foot, View.GONE);
        if (!site.isEmpty()) v.setOnClickPendingIntent(R.id.root, abrir(c, site + f.abrir, base + 2));
        else v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(c, base + 1,
                new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE));
        m.updateAppWidget(ids, v);
    }
}
