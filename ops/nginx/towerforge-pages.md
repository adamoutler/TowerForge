# One HTML file per page (nginx site config)

Since 2026-11-13 the build writes `dist/<page>.html` for every address
(`towerforge.client/routePagesPlugin.ts`): the same app with that page's
title, description, link-preview tags and canonical address in its head, so
search engines and Discord / Reddit / X previews show the page that was
linked, not the home page's card.

nginx has to look for `<address>.html` before falling back to `index.html`.
In `/etc/nginx/sites-enabled/towerforge`, the `location /` block:

```nginx
location / {
    try_files $uri $uri.html $uri/ /index.html;
}
```

(before: `try_files $uri $uri/ /index.html;`). Not `optimizer/index.html`: a
folder makes nginx redirect `/optimizer` to `/optimizer/`.

Install (on the VPS):

```bash
sudo cp /etc/nginx/sites-enabled/towerforge /etc/nginx/towerforge.bak-pages
sudo sed -i 's#try_files $uri $uri/ /index.html;#try_files $uri $uri.html $uri/ /index.html;#' /etc/nginx/sites-enabled/towerforge
sudo nginx -t && sudo systemctl reload nginx
curl -s https://towerforge.net/optimizer | grep -o '<title>[^<]*</title>'   # Optimizer — TowerForge
curl -s -o /dev/null -w '%{http_code}\n' https://towerforge.net/optimizer    # 200, no redirect
```

The page files are revalidated on every visit like `index.html`
(`towerforge-cache.conf`), so a deploy shows at once.
