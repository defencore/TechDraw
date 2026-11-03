# GitHub Pages deployment

TechDraw is a static application. GitHub serves HTML, JavaScript, WebAssembly, and fonts; STEP files are processed in the visitor's browser. No application backend is required.

## Repository configuration

1. In `defencore/TechDraw`, open **Settings → Pages**.
2. Select **GitHub Actions** as the build source.
3. Set the custom domain to `techdraw.defencore.com`.
4. At the DNS provider, point the `techdraw` CNAME to `defencore.github.io`.
5. Enable **Enforce HTTPS** after GitHub provisions the certificate.

For an Actions deployment, `public/CNAME` records the intended hostname but does not configure the Pages custom domain. The domain must also be saved in Pages settings or through GitHub's Pages API.

The `pages.yml` workflow runs checks and builds pull requests. A passing push to `main` publishes `dist/` through the `github-pages` environment. The environment should permit deployment from `main` only. The application uses relative asset paths so it can also run at a project URL.

The Pages site must exist before the workflow runs. The normal workflow token can deploy an existing configured site but cannot bootstrap Pages with `configure-pages`' `enablement` input. Use repository settings for initial setup. Do not add an administrator token to the workflow merely to avoid this one-time setup.

## Local checks

```sh
npm ci
npm test
npm run build
npm run preview
```

Before release, test a real STEP file, a multi-solid STEP file, all paper sizes and orientations, manual dimension changes, and a downloaded PDF. Confirm the PDF page size independently and compare dimension values with the source CAD system. Do not judge measurement accuracy from the on-screen zoom level.

## Verify a release

- Confirm the Actions **Check and publish** run is green.
- Confirm the `github-pages` deployment points to the intended commit.
- Open `https://techdraw.defencore.com` and import a STEP file.
- Confirm that the WebAssembly asset loads and that STEP processing does not send the source file to a server.

If Cloudflare proxies the hostname, its public DNS response may contain Cloudflare IP addresses rather than the origin CNAME. A GitHub origin response alone does not prove a valid Pages domain configuration. If certificate or domain validation fails, follow the provider's guidance for the proxy configuration.

## Primary references

- [GitHub: configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub: managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub: securing Pages with HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- [Official configure-pages inputs and enablement requirements](https://github.com/actions/configure-pages/blob/main/action.yml)
