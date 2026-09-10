# Offline-Test: Buchungsbestätigung und Rechnung nach Stripe-Zahlung

Dieses Update verändert ausschließlich das lokale Projekt `~/TheaterSoftware`.
Es enthält keinerlei SSH-, SCP- oder Live-Server-Befehle.

## Ablauf

1. Stripe bestätigt eine Testzahlung über den signierten lokalen Webhook.
2. Die bezahlte Buchung wird wie bisher genau einmal angelegt.
3. Die zum Event gehörende aktive Rechnungsvorlage wird gewählt.
4. Die Rechnung wird mit den tatsächlich bei Stripe bezahlten Positionen erstellt.
5. Ein einseitiges A4-PDF wird ohne Browser-Kopfzeilen erzeugt.
6. Buchungsbestätigung und Rechnung werden nur an `EMAIL_TEST_RECIPIENT` gesendet.

Wiederholte Stripe-Webhooks erzeugen weder eine zweite Rechnung noch absichtlich
eine zweite E-Mail. Fehlgeschlagene Versandversuche werden in
`invoice_email_deliveries` gespeichert. Zahlung, Buchung und Rechnung bleiben
bei einem Mailfehler erhalten.

## Installation

Entpacke das Paket. Starte anschließend im Terminal:

```bash
cd "$HOME/Downloads/TheaterSoftware_Offline_Stripe_Rechnungsversand" || exit 1
chmod 700 TheaterSoftware_Offline_Stripe_Rechnungsversand.sh
./TheaterSoftware_Offline_Stripe_Rechnungsversand.sh
```

Das Installationsprogramm erstellt zuerst ein Backup und prüft den bekannten
Offline-Programmstand. Der Live-Server wird nicht angesprochen.

## Mailkonto einrichten

Nach der Installation öffnest du ausschließlich lokal:

```bash
open -e "$HOME/TheaterSoftware/.env"
```

Ergänze die SMTP-Werte. `EMAIL_TEST_RECIPIENT` muss deine eigene Testadresse
sein. Das SMTP-Passwort gehört ausschließlich in diese lokale `.env`-Datei.
Solange Pflichtwerte fehlen, werden Buchung und Rechnung erstellt, aber keine
E-Mail versendet.

Übliche Varianten:

- Port 587: `SMTP_SECURITY=starttls`
- Port 465: `SMTP_SECURITY=ssl`

Danach das lokale Backend neu starten.

## Test

1. Stripe CLI lokal starten:

   ```bash
   stripe listen --forward-to http://127.0.0.1:8000/api/public/stripe/webhook
   ```

2. Im lokalen Ticketshop eine Testbuchung mit `4242 4242 4242 4242` bezahlen.
3. Prüfen, dass genau eine Buchung und genau eine Rechnung entstanden sind.
4. Prüfen, dass nur `EMAIL_TEST_RECIPIENT` die Testmail samt PDF erhalten hat.

Der Versandstatus ist nach Anmeldung als Mitarbeiter oder Admin erreichbar:

```text
GET http://127.0.0.1:8000/api/invoice-emails
```

Ein fehlgeschlagener Versand kann über folgenden Endpunkt erneut angestoßen
werden:

```text
POST http://127.0.0.1:8000/api/invoice-emails/BUCHUNGS_ID/retry
```

