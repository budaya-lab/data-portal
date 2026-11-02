import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta
          name="description"
          content="Browse datasets catalogued by Budaya Lab."
        />
        <meta name="theme-color" content="#fafaf8" />
        {/* DCAT feed autodiscovery — lets national/EU/US open-data portals (and
            harvesters like data.europa.eu) find this catalog's machine-readable
            metadata. /catalog.jsonld is the stable canonical feed, regenerated at
            build by scripts/generate-dcat.ts. Additional profile/serialization feeds
            are indexed in /catalog-feeds.json. See /portaljs-add-dcat. */}
        <link
          rel="alternate"
          type="application/ld+json"
          href="/catalog.jsonld"
          title="DCAT catalog feed"
        />
        {/* Budaya Lab type system. Fonts load at runtime, so static builds do
            not fetch or bundle font binaries. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
