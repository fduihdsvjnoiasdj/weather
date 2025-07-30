# Předpověď počasí – česká PWA aplikace

Tento projekt je jednoduchá PWA aplikace v češtině, která využívá veřejné API služby **Open‑Meteo**. Uživatelům zobrazuje předpověď počasí pro vybraná města v České republice, umožňuje vyhledávání dalších lokalit a posílá denní notifikace o **koupacích dnech** a **deštivých dnech**. Díky využití service workeru funguje i v offline režimu a lze ji nainstalovat na mobilní zařízení jako nativní aplikaci.

## Použitá API

- **Geocoding API** – vyhledávání měst a jejich souřadnic. Endpoint `https://geocoding-api.open-meteo.com/v1/search` přijímá parametr `name` (název lokality) a lze filtrovat jazykem (`language`) a zemí (`countryCode`)【920629151532105†L72-L92】. Naše aplikace používá `language=cs` a `countryCode=CZ`, aby byly výsledky česky a pouze z České republiky.

- **DWD ICON API (Open‑Meteo)** – slouží pro získání předpovědi počasí. Pro první dva dny aplikace využívá model **ICON‑D2** (vysoké rozlišení), pro další tři dny model **ICON‑EU**. Open‑Meteo uvádí, že první 2–3 dny předpovědi jsou počítány s nejvyšším rozlišením a poté se použije globální model【794028477913913†L36-L39】. Denní agregace (např. maximum/minimum teploty nebo součet srážek) jsou dostupné pomocí parametru `daily=`【839459858877162†L754-L770】 a jednotlivé kódy počasí vycházejí ze standardu WMO【839459858877162†L852-L867】.

## Struktura projektu

| Soubor | Popis |
|-------|------|
| `index.html` | Hlavní webová stránka aplikace. |
| `style.css` | Stylopis zajišťující responzivní a přehledné rozhraní. |
| `app.js` | JavaScript s logikou aplikace – načítání dat, vyhledávání měst, ukládání do `localStorage` a plánování notifikací. |
| `service-worker.js` | Service worker umožňující offline režim a zprostředkování notifikací. |
| `manifest.json` | Definuje parametry PWA (název, ikony, barvy, režim zobrazení). |
| `icons/` | Obsahuje dvě ikony (`192×192` a `512×512`) generované jako abstraktní motiv. |
| `README.md` | Tento návod. |

## Lokální spuštění

Service worker vyžaduje ke správnému fungování webový server. Pro jednoduché vyzkoušení můžete použít integrovaný server jazyka Python:

```bash
# v kořenovém adresáři projektu spusťte:
python3 -m http.server 8000

# poté v prohlížeči otevřete:
http://localhost:8000/weather-pwa/
```

Po načtení stránky aplikace nabídne instalaci na domovskou obrazovku a požádá o povolení notifikací. Pokud aplikaci přidáte na plochu (Android/iOS) či spustíte jako samostatnou aplikaci v prohlížeči, bude nadále fungovat i bez připojení k internetu (pouze s uloženými daty).

## Spuštění serveru

Push notifikace nyní obstarává jednoduchý Node.js server. Po instalaci závislostí spusťte:

```bash
npm start
```

Server poslouchá na portu `3000` a zároveň obsluhuje statické soubory aplikace. Pro funkční web push mějte aplikaci dostupnou přes HTTPS.

## Přidání a správa měst

- **Vyhledání:** do pole *Hledat město...* zadejte minimálně tři znaky. Aplikace odešle dotaz na Geocoding API, které vrátí nejvýše pět výsledků v češtině【920629151532105†L72-L92】. Kliknutím na výsledek město přidáte do seznamu.
- **Odstranění:** každý panel města má v pravém horním rohu tlačítko ×. Tím město odstraníte ze seznamu.
- **Ukládání:** seznam měst je uložen v `localStorage`. Pokud chcete seznam vymazat, vymažte tato data v nastavení prohlížeče nebo odstraňte položky z kódu `app.js` (pole `DEFAULT_CITIES`).

## Nastavení notifikací

- V sekci **Nastavení notifikací** zvolte preferovaný čas (formát 24 h) a klikněte na *Uložit nastavení*.
- Aplikace se pokusí naplánovat notifikaci pomocí rozšíření **Notification Triggers** (dostupné především v prohlížeči Chrome na Androidu). Pokud toto rozšíření není k dispozici, provádí se kontrola každých 30&nbsp;sekund pouze při otevřené aplikaci.
- Za **koupací den** je považován den se slunečným počasím a maximální teplotou ≥ 25 °C bez výrazných srážek; za **deštivý den** se považuje den se srážkami ≥ 1 mm nebo pravděpodobností srážek nad 50 %.
- Notifikace jsou zobrazeny pouze tehdy, pokud jste je v prohlížeči povolili. V některých prohlížečích (zejména iOS Safari) nejsou notifikace na pozadí podporovány.

## Úprava kódu a přizpůsobení

- **Výchozí města:** v souboru `app.js` najdete pole `DEFAULT_CITIES`, ve kterém můžete změnit nebo doplnit výchozí názvy měst. Při prvním načtení aplikace budou uloženy do `localStorage`.
- **Výpočet notifikací:** podmínky pro koupací den a deštivý den jsou definovány ve funkcích `createLocationCard()` a `checkForNotification()` v `app.js`. Pokud chcete logiku upravit (např. zvýšit limit teploty), můžete zde snadno změnit příslušné hodnoty.
- **Styling:** vzhled aplikace můžete změnit úpravou souboru `style.css`. Použit je jednoduchý flexbox layout, který se snadno upravuje.

## Licence

Tento projekt je určen pouze ke studijním a nekomerčním účelům. Data pro předpověď počasí poskytuje služba **Open‑Meteo**. Používání API je zdarma pro nekomerční využití, jak je popsáno v jejich podmínkách.