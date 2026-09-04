# Lokaler Testbetrieb für Verwaltung und Ticketshop

Die Verwaltungssoftware, der neue Ticketshop und das Backend laufen lokal als drei getrennte Prozesse. Der Ticketshop ist dabei noch nicht öffentlich erreichbar. Stripe läuft ausschließlich im Testmodus; echte Zahlungen und echte Ticket-E-Mails sind in diesem Stand bewusst nicht aktiv.

## 1. Backend starten

In einem neuen Terminalfenster:

```bash
cd "/Users/eliasreiter/TheaterSoftware"
source .venv/bin/activate
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Falls die virtuelle Umgebung bereits aktiv ist, kann die Zeile mit `source` entfallen.

## 2. Verwaltungssoftware starten

In einem zweiten Terminalfenster:

```bash
cd "/Users/eliasreiter/TheaterSoftware/frontend"
npm install
npm run dev
```

Verwaltung öffnen: <http://127.0.0.1:5173/>

## 3. Ticketshop starten

In einem dritten Terminalfenster:

```bash
cd "/Users/eliasreiter/TheaterSoftware/ticketshop"
npm install
npm run dev
```

Ticketshop öffnen: <http://127.0.0.1:5174/>

## 4. Die Verbindung testen

1. In der Verwaltungssoftware den Bereich `Vorstellungen` öffnen.
2. Eine Veranstaltung zunächst als `Entwurf` anlegen.
3. Prüfen, dass der Entwurf im Ticketshop **nicht** sichtbar ist.
4. Veranstaltungsort, Preis, Platzwahl und die übrigen Angaben eintragen.
5. Den Status auf `Veröffentlicht` setzen und speichern.
6. Den Ticketshop neu laden. Das Event muss jetzt automatisch erscheinen.
7. `Im Testshop öffnen` anklicken und die Detailseite prüfen.
8. Das Event wieder auf `Entwurf` setzen. Es muss anschließend aus dem Ticketshop verschwinden.

## Veranstaltungsbild testen

1. In der Verwaltungssoftware eine Veranstaltung bearbeiten.
2. Unter `Darstellung im Ticketshop` auf `Bild auswählen` klicken.
3. Ein JPG-, PNG- oder WebP-Bild mit höchstens 8 MB auswählen.
4. Warten, bis die Vorschau erscheint, und die Veranstaltung speichern.
5. Die Veranstaltung im Testshop öffnen. Das hochgeladene Bild muss dort erscheinen.
6. Zum Sicherheitstest eine andere Datei oder ein Bild über 8 MB auswählen. Diese Datei muss abgelehnt werden.

Die Bilder liegen im lokalen Testbetrieb unter `backend/uploads/events`. Dieser Ordner wird absichtlich nicht zu GitHub hochgeladen. Vor dem Livegang wird der Speicher auf einen dauerhaften Cloud-Bildspeicher umgestellt.

## Begrenzte Passwortfreigabe testen

1. Als Administrator in der Verwaltungssoftware anmelden.
2. `Mitarbeiter` öffnen und bei Sabrina auf `Passwortfreigabe-Recht erteilen` klicken.
3. Sabrina muss sich danach einmal abmelden und erneut anmelden.
4. Sabrina kann anschließend `Mitarbeiter` öffnen, normale Konten freischalten und einen Passwort-Reset für eine Stunde erlauben.
5. Sabrina darf keine Mitarbeiter deaktivieren, keine Rechte vergeben und keine Administratorkonten freischalten oder deren Passwort-Reset erlauben.

Die vollständige Administratorrolle ist dafür nicht erforderlich. Erteilung und Entzug der Berechtigung werden im Aktivitätsprotokoll festgehalten.

## Preisberechnung testen

Im Veranstaltungsformular beispielsweise folgende Bruttopreise eintragen:

- Eintrittskarte: 59,80 EUR bei 7 % MwSt., intern
- Menü: 25,00 EUR bei 7 % MwSt., intern
- Getränke: 10,00 EUR bei 19 % MwSt., extern; Anbieter eintragen

Die automatische Berechnung muss anschließend anzeigen:

- Zwischensumme: 94,80 EUR
- externe Servicegebühr (10 %): 9,48 EUR
- Endpreis je Ticket: 104,28 EUR

Nach dem Speichern muss dieselbe Zusammensetzung auf der Detailseite im Ticketshop erscheinen. Die Servicegebühr darf nicht manuell änderbar sein.

## Stripe-Testcheckout einrichten

Der Checkout akzeptiert in diesem Entwicklungsstand absichtlich nur einen geheimen Schlüssel mit `sk_test_`. Eine Testzahlung reserviert das Kontingent für 30 Minuten. Erst die verifizierte Rückmeldung von Stripe erzeugt eine Buchung mit dem Status `bezahlt`.

1. Abhängigkeiten im aktivierten Python-Umfeld installieren:

   ```bash
   cd "/Users/eliasreiter/TheaterSoftware"
   source .venv/bin/activate
   python -m pip install -r requirements.txt
   ```

2. Die lokale Einstellungsdatei vorbereiten:

   ```bash
   cd "/Users/eliasreiter/TheaterSoftware"
   cp -n .env.stripe.example .env
   open -e .env
   ```

   In `.env` bei `STRIPE_SECRET_KEY` ausschließlich den geheimen **Testschlüssel** aus dem Stripe-Sandboxbereich eintragen. Die Datei niemals verschicken oder zu GitHub hochladen.

3. Stripe CLI einmalig installieren und mit dem Stripe-Konto verbinden:

   ```bash
   brew install stripe/stripe-cli/stripe
   stripe login
   ```

4. In einem eigenen Terminal den lokalen Webhook starten:

   ```bash
   stripe listen --forward-to http://127.0.0.1:8000/api/public/stripe/webhook
   ```

   Den dort angezeigten Schlüssel mit `whsec_` in `.env` bei `STRIPE_WEBHOOK_SECRET` eintragen. Danach das Backend neu starten. Dieser lokale Webhook-Schlüssel kann sich ändern, wenn die Stripe-CLI-Verbindung neu eingerichtet wird.

5. Backend, Verwaltung und Ticketshop wie oben beschrieben starten. Eine veröffentlichte Veranstaltung im Ticketshop öffnen und bis zur Bestellübersicht gehen.

6. `Im Stripe-Testmodus bezahlen` wählen. Für eine erfolgreiche Testzahlung verwenden:

   - Kartennummer: `4242 4242 4242 4242`
   - Ablaufdatum: ein beliebiges zukünftiges Datum
   - Prüfziffer: drei beliebige Ziffern
   - Postleitzahl: eine beliebige gültige Postleitzahl

7. Nach der Rückkehr muss eine Buchungsnummer angezeigt werden. Dieselbe Buchung muss in der Verwaltungssoftware mit dem Status `bezahlt` erscheinen. Bei Sitzplatzwahl müssen die gekauften Plätze anschließend belegt sein.

Für einen Ablehnungstest kann die Kartennummer `4000 0000 0000 0002` verwendet werden. Bis zum späteren Livegang werden ausschließlich Stripe-Testkarten und `sk_test_`-Schlüssel verwendet.
