// ============================================================
//  TowerForge Link for Android — the setup screen
//  A checklist in the order the player needs it, each step with the
//  one button that fixes it:
//    1. Shizuku installed            → Get Shizuku (Google Play)
//    2. Shizuku running              → Open Shizuku (start it there)
//    3. This app allowed in Shizuku  → Allow
//    4. The Tower's export found     → Open The Tower
//    5. Link on                      → Start Link
//  then "Open towerforge.net" (?link=android tells the site this phone
//  has Link). Checked again whenever the screen comes back and when
//  Shizuku starts, stops or answers.
//  The full guide: towerforge.net/import-guide#android-phone.
// ============================================================

package net.towerforge.link;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.method.LinkMovementMethod;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.DateFormat;
import java.util.Date;

import rikka.shizuku.Shizuku;

public class MainActivity extends Activity {

    static final String SITE = "https://towerforge.net/?link=android";
    static final String GUIDE = "https://towerforge.net/import-guide#android-phone";
    private static final String GAME = "com.TechTreeGames.TheTower";

    // Synthwave, the site's default theme.
    private static final int BG = Color.parseColor("#0b0812");
    private static final int CARD = Color.parseColor("#130f1c");
    private static final int LINE = Color.parseColor("#2e2642");
    private static final int ACCENT = Color.parseColor("#ff4fa3");
    private static final int TEXT = Color.parseColor("#ded7ea");
    private static final int DIM = Color.parseColor("#a096b6");
    private static final int BRIGHT = Color.parseColor("#f8f3fe");
    private static final int GOOD = Color.parseColor("#3ee08f");
    private static final int WARN = Color.parseColor("#ffc14d");

    private LinearLayout list;
    private final Handler main = new Handler(Looper.getMainLooper());
    // The export check needs Shizuku's reader; done off the main thread.
    private volatile String exportLine;
    private volatile Boolean exportFound;

    private final Shizuku.OnBinderReceivedListener onBinder = () -> main.post(this::refresh);
    private final Shizuku.OnBinderDeadListener onDead = () -> main.post(this::refresh);
    private final Shizuku.OnRequestPermissionResultListener onPermission = (code, result) -> main.post(this::refresh);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(22), dp(18), dp(28));
        scroll.addView(root);

        TextView title = text("TowerForge Link", 26, BRIGHT, true);
        root.addView(title);
        TextView lead = text("Brings The Tower's data export to towerforge.net in this phone's browser — no file "
                + "hunting. Do the steps below once; after that, open the site and your data is there.", 15, TEXT, false);
        lead.setPadding(0, dp(6), 0, dp(14));
        root.addView(lead);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list);

        TextView guide = text("Stuck on a step? The full step-by-step guide, with what each screen says: "
                + "towerforge.net/import-guide", 13, DIM, false);
        guide.setPadding(0, dp(16), 0, 0);
        guide.setOnClickListener(v -> open(GUIDE));
        root.addView(guide);

        TextView safety = text("TowerForge Link only reads the game's export file, only answers towerforge.net on this "
                + "phone, and never uploads anything. Version " + BuildConfig.VERSION_NAME + ".", 12, DIM, false);
        safety.setPadding(0, dp(10), 0, 0);
        root.addView(safety);

        setContentView(scroll);
        Shizuku.addBinderReceivedListenerSticky(onBinder);
        Shizuku.addBinderDeadListener(onDead);
        Shizuku.addRequestPermissionResultListener(onPermission);
    }

    @Override
    protected void onDestroy() {
        Shizuku.removeBinderReceivedListener(onBinder);
        Shizuku.removeBinderDeadListener(onDead);
        Shizuku.removeRequestPermissionResultListener(onPermission);
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        // Starting Link takes a moment to show.
        main.postDelayed(this::refresh, 1200);
    }

    // ── The checklist ───────────────────────────────────────────
    private void refresh() {
        if (list == null) return;
        list.removeAllViews();
        ShizukuReader.State st = ShizukuReader.state(this);
        boolean installed = st != ShizukuReader.State.NOT_INSTALLED;
        boolean shizukuRunning = installed && st != ShizukuReader.State.NOT_RUNNING;
        boolean allowed = st == ShizukuReader.State.READY;

        step(1, "Install Shizuku", installed,
                installed ? "Shizuku is installed."
                        : "Shizuku is a free app that gives TowerForge Link the same access a computer has, so it can open "
                        + "the game's data export (Android hides it from other apps). Install it from Google Play.",
                installed ? null : "Get Shizuku", installed ? null : v -> openStore(ShizukuReader.SHIZUKU_PACKAGE));

        step(2, "Start Shizuku", shizukuRunning,
                shizukuRunning ? "Shizuku is running."
                        : "Open Shizuku and start it with \"Start via Wireless debugging\" (Wi-Fi must be on). The first "
                        + "time it asks you to pair — the guide shows every screen. After the phone restarts, open Shizuku "
                        + "and tap Start again.",
                !installed || shizukuRunning ? null : "Open Shizuku", v -> launch(ShizukuReader.SHIZUKU_PACKAGE));

        step(3, "Allow TowerForge Link in Shizuku", allowed,
                allowed ? "Allowed."
                        : shizukuRunning ? "Tap Allow, then allow it in the window Shizuku shows."
                        : "Comes after step 2.",
                shizukuRunning && !allowed ? "Allow" : null, v -> Shizuku.requestPermission(1));

        String exportText;
        Boolean found = allowed ? exportFound : null;
        if (!allowed) exportText = "Comes after step 3.";
        else if (found == null) exportText = "Checking…";
        else exportText = exportLine;
        step(4, "Export your data in The Tower", Boolean.TRUE.equals(found), exportText,
                allowed && !Boolean.TRUE.equals(found) ? "Open The Tower" : null, v -> launch(GAME));
        if (allowed) checkExport();

        boolean on = LinkService.running;
        String linkText = on ? "TowerForge Link is on (see its notification). Leave it on while you play."
                : LinkService.problem != null ? LinkService.problem
                : "Turn it on so towerforge.net can ask for your data. It stays on until you stop it or the phone restarts.";
        step(5, "Turn on TowerForge Link", on, linkText, on ? "Stop Link" : "Start Link", v -> toggleLink());

        Button site = button("Open towerforge.net", true);
        site.setOnClickListener(v -> open(SITE));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        list.addView(site, lp);
        TextView after = text("On the site, tap \"Get from emulator or phone\", or turn on Auto import to bring in each new "
                + "export by itself. The first time, the browser asks to let towerforge.net talk to apps on this device: "
                + "tap Allow.", 13, DIM, false);
        after.setPadding(0, dp(8), 0, 0);
        list.addView(after);
    }

    private void checkExport() {
        new Thread(() -> {
            IExportReader reader = ShizukuReader.reader(this, 5000);
            Boolean found;
            String line;
            if (reader == null) {
                found = false;
                line = "Couldn't reach Shizuku. Open Shizuku and check it says it's running.";
            } else {
                try {
                    int s = reader.state();
                    found = s == 0;
                    line = s == 0 ? "Found your export from " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                            .format(new Date(reader.modified() * 1000)) + ". Turn on Auto in the game to keep it fresh."
                            : s == 1 ? "The Tower isn't installed on this phone, or hasn't been opened yet."
                            : s == 2 ? "No export yet. In The Tower: Settings → tap your player ID 5 times → External Tools Export, then export — or "
                            + "choose Auto so the game exports every time it saves."
                            : "Found the export but couldn't read it. Export again in the game.";
                } catch (Exception e) {
                    found = false;
                    line = "Lost the connection to Shizuku. Open Shizuku and tap Start.";
                }
            }
            boolean changed = !found.equals(exportFound) || !line.equals(exportLine);
            exportFound = found;
            exportLine = line;
            if (changed) main.post(this::refresh);
        }, "export-check").start();
    }

    private void toggleLink() {
        if (LinkService.running) {
            LinkService.stop(this);
        } else {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2);
            }
            LinkService.start(this);
        }
        main.postDelayed(this::refresh, 600);
    }

    // ── Pieces ──────────────────────────────────────────────────
    private void step(int n, String title, boolean done, String detail, String action, View.OnClickListener onAction) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(CARD);
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), done ? GOOD : LINE);
        card.setBackground(bg);

        TextView head = text((done ? "✓  " : n + ".  ") + title, 17, done ? GOOD : BRIGHT, true);
        card.addView(head);
        if (detail != null) {
            TextView body = text(detail, 14, done ? DIM : TEXT, false);
            body.setPadding(0, dp(4), 0, 0);
            card.addView(body);
        }
        if (action != null) {
            Button b = button(action, false);
            b.setOnClickListener(onAction);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(10);
            card.addView(b, lp);
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        list.addView(card, lp);
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setLineSpacing(0, 1.15f);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setMovementMethod(LinkMovementMethod.getInstance());
        return t;
    }

    private Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? Color.parseColor("#1c0411") : ACCENT);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(18), dp(10), dp(18), dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(8));
        if (primary) bg.setColor(ACCENT);
        else {
            bg.setColor(Color.TRANSPARENT);
            bg.setStroke(dp(2), ACCENT);
        }
        b.setBackground(bg);
        return b;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void open(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            // no browser
        }
    }

    private void openStore(String pkg) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)));
        } catch (ActivityNotFoundException e) {
            open("https://play.google.com/store/apps/details?id=" + pkg);
        }
    }

    private void launch(String pkg) {
        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i != null) startActivity(i);
        else openStore(pkg);
    }
}
