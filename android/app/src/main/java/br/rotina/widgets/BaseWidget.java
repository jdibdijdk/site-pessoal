package br.rotina.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
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

    private static PendingIntent abrir(Context c, String url, int req) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void desenhar(Context c, Class<?> cls, String frente) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, cls));
        if (ids.length == 0) return;
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        JSONObject s = Dados.cache(c);
        String site = Dados.site(c);
        int base = frente.hashCode() & 0xffff;

        Intent atu = new Intent(c, cls).setAction(ATUALIZAR);
        v.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(c, base, atu, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        if (s == null) {
            v.setTextViewText(R.id.title, "Rotina");
            v.setTextViewText(R.id.sub, "");
            v.setTextViewText(R.id.empty, "Abra o site da Rotina com o Firebase conectado para preparar o widget.");
            v.setViewVisibility(R.id.empty, View.VISIBLE);
            for (int id : LINHA) v.setViewVisibility(id, View.GONE);
            v.setViewVisibility(R.id.bar, View.GONE);
            v.setTextViewText(R.id.foot, "");
            v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(c, base + 1,
                    new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE));
            m.updateAppWidget(ids, v);
            return;
        }

        Frente f = Frente.montar(frente, s);
        v.setTextViewText(R.id.title, f.nome);
        v.setTextViewText(R.id.sub, f.sub);
        if (f.progresso >= 0) { v.setViewVisibility(R.id.bar, View.VISIBLE); v.setProgressBar(R.id.bar, 100, f.progresso, false); }
        else v.setViewVisibility(R.id.bar, View.GONE);

        boolean vazio = f.linhas.isEmpty();
        v.setViewVisibility(R.id.empty, vazio ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.empty, f.vazio);
        for (int i = 0; i < LINHA.length; i++) {
            if (i >= f.linhas.size()) { v.setViewVisibility(LINHA[i], View.GONE); continue; }
            Frente.Linha l = f.linhas.get(i);
            v.setViewVisibility(LINHA[i], View.VISIBLE);
            v.setTextViewText(TEXTO[i], l.texto);
            v.setTextViewText(META[i], l.meta);
            v.setViewVisibility(PONTO[i], l.titulo ? View.GONE : View.VISIBLE);
            v.setTextViewTextSize(TEXTO[i], android.util.TypedValue.COMPLEX_UNIT_SP, l.titulo ? 11 : 14);
            v.setTextColor(TEXTO[i], c.getColor(l.feito || l.titulo ? R.color.w_mut : R.color.w_tx));
            if (!site.isEmpty()) v.setOnClickPendingIntent(LINHA[i], abrir(c, site + l.link, base + 10 + i));
        }

        long at = s.optLong("at");
        v.setTextViewText(R.id.foot, at > 0 ? "Atualizado " + new SimpleDateFormat("dd/MM HH:mm", new Locale("pt", "BR")).format(new Date(at)) : "");
        if (!site.isEmpty()) v.setOnClickPendingIntent(R.id.root, abrir(c, site + f.abrir, base + 2));
        else v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(c, base + 1,
                new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE));
        m.updateAppWidget(ids, v);
    }
}
