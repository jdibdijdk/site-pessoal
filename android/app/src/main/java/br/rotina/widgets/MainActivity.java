package br.rotina.widgets;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Tela do app: estado da sincronização, endereço do site e como adicionar os widgets. */
public class MainActivity extends Activity {
    private TextView estado;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        int pad = dp(20);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, pad + dp(16), pad, pad);

        TextView t = new TextView(this);
        t.setText("Rotina Widgets");
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        col.addView(t);

        estado = new TextView(this);
        estado.setPadding(0, dp(8), 0, dp(16));
        col.addView(estado);

        TextView como = new TextView(this);
        como.setText("Como adicionar:\n1. Segure um espaço vazio da tela inicial.\n2. Toque em Widgets e procure \"Rotina Widgets\".\n3. Arraste Hoje, Semana, Tarefas, Hábitos, Notas ou Finanças.\n\nOs widgets mostram o resumo que o site grava no Firebase. Abra o site com o Firebase conectado para atualizar; os widgets buscam sozinhos a cada 30 minutos e no botão de atualizar.");
        como.setLineSpacing(0, 1.2f);
        col.addView(como);

        TextView rot = new TextView(this);
        rot.setText("Endereço do site (opcional; em branco usa o que o site informou)");
        rot.setPadding(0, dp(20), 0, dp(4));
        col.addView(rot);
        final EditText site = new EditText(this);
        site.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        site.setSingleLine(true);
        site.setHint("https://…");
        site.setText(Dados.prefs(this).getString("site", ""));
        col.addView(site);

        Button salvar = new Button(this);
        salvar.setText("Salvar e atualizar agora");
        salvar.setOnClickListener(v -> {
            Dados.prefs(this).edit().putString("site", site.getText().toString().trim()).apply();
            atualizar();
        });
        col.addView(salvar);

        Button abrir = new Button(this);
        abrir.setText("Abrir o site");
        abrir.setOnClickListener(v -> {
            String u = Dados.site(this);
            if (!u.isEmpty()) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
            else estado.setText("Ainda não sei o endereço do site. Preencha o campo acima.");
        });
        col.addView(abrir);

        ScrollView sv = new ScrollView(this);
        sv.addView(col);
        setContentView(sv);
        mostrar();
        atualizar();
    }

    private void atualizar() {
        estado.setText("Buscando os dados…");
        new Thread(() -> {
            boolean ok = Dados.baixar(getApplicationContext());
            BaseWidget.redesenharTodos(getApplicationContext());
            runOnUiThread(() -> { mostrar(); if (!ok) estado.append("\nNão consegui buscar agora: " + Dados.prefs(this).getString("erro", "sem conexão") + "."); });
        }).start();
    }

    private void mostrar() {
        org.json.JSONObject s = Dados.cache(this);
        if (s == null) { estado.setText("Ainda sem dados. Abra o site da Rotina com o Firebase conectado."); return; }
        long at = s.optLong("at");
        estado.setText("Resumo do site de " + new SimpleDateFormat("dd/MM 'às' HH:mm", new Locale("pt", "BR")).format(new Date(at))
                + "\nSite: " + (Dados.site(this).isEmpty() ? "não informado" : Dados.site(this)));
        estado.setGravity(Gravity.START);
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
