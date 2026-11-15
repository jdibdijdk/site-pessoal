package br.rotina.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/** Atalho do Pingado: abre o site já com o assistente aberto (?pg=1). */
public class PingadoWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.pingado_widget);
        String site = Dados.site(c);
        Intent i = site.isEmpty()
                ? new Intent(c, MainActivity.class)
                : new Intent(Intent.ACTION_VIEW, Uri.parse(site + (site.contains("?") ? "&" : "?") + "pg=1"));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(c, 77, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        m.updateAppWidget(ids, v);
    }
}
