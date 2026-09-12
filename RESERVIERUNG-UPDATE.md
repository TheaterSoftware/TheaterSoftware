# Reservierung mit Stripe-Zahlungslink – lokaler Testbetrieb

## Ablauf

1. Person und Buchung im System anlegen; Status „reserviert“.
2. Zur Buchung eine Rechnung mit Zahlungsstatus „offen“ vorbereiten und speichern.
   Der offene Rechnungsbetrag einschließlich Zusatzkosten und abzüglich Gutscheinen ist die Grundlage für Stripe.
3. Im E-Mail-Ausgang „Reservierungsbestätigung mit Zahlungslink“ senden.
   Die Mail sagt ausdrücklich, dass die Buchung noch nicht bestätigt ist. Sie enthält keine Eintrittskarten.
4. Den Link in der Testmail auf demselben Mac öffnen und dort „Im Stripe-Testmodus bezahlen“ anklicken.
5. Nach bestätigter Stripe-Zahlung aktualisiert der signierte Webhook die vorhandene Buchung und Rechnung auf „bezahlt“.
   Es entsteht keine weitere Buchung oder Rechnungsnummer.
6. Buchungsbestätigung, digitale Tickets und Rechnung werden anschließend als drei getrennte Mails versendet.
   Bei Postversand werden nur Bestätigung und Rechnung per Mail verschickt.
7. Im E-Mail-Ausgang „Aktualisieren“ anklicken, um Versandstatus und Fehler zu sehen.

SEPA bleibt bis zur tatsächlichen Zahlungsbestätigung offen. Solange eine Zahlung verarbeitet wird, ist ein erneuter Zahlversuch gesperrt.
Ein abgelaufener Checkout wird beim erneuten Aufruf des Zahlungsbuttons ersetzt. Ein fehlgeschlagener SEPA-Versuch kann über denselben Link erneut gestartet werden.
Die Reservierung selbst wird durch dieses Update nicht automatisch storniert.

## Installieren auf dem Mac

ZIP unter dem Namen `Reservierung-Stripe-Update.zip` im Downloads-Ordner speichern.
Den folgenden Block in einem freien Terminal auf dem Mac ausführen:

```bash
(
  set -e
  cd "$HOME/TheaterSoftware"
  test -f "$HOME/Downloads/Reservierung-Stripe-Update.zip"
  backup_dir="$HOME/TheaterSoftware-Backup-Reservierung-$(date +%Y-%m-%d_%H-%M-%S)"
  mkdir -p "$backup_dir/backend" "$backup_dir/frontend/src"
  cp backend/main.py "$backup_dir/backend/main.py"
  cp frontend/src/EmailOutbox.tsx "$backup_dir/frontend/src/EmailOutbox.tsx"
  unzip -o "$HOME/Downloads/Reservierung-Stripe-Update.zip"
  .venv/bin/python -m py_compile backend/main.py
  cd frontend
  npm run build
  echo "Update-Dateien installiert und Build erfolgreich."
)
```

Im laufenden Backend-Terminal mit Ctrl+C stoppen und neu starten:

```bash
cd "$HOME/TheaterSoftware"
source .venv/bin/activate
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Das Terminal offen lassen. Beim Start werden zwei zusätzliche Zahlungstabellen angelegt; vorhandene Kundendaten werden nicht gelöscht.
Das Update ersetzt `backend/main.py` und `frontend/src/EmailOutbox.tsx` auf Basis des hier vorhandenen Projektstands.
Es enthält außerdem diese Anleitung und isolierte Regressionstests. Ein Code-Backup ersetzt kein Datenbank-Backup.

## Voraussetzungen für den lokalen Test

- Mitarbeiteroberfläche und Testticketshop laufen wie bisher.
- `TICKETSHOP_BASE_URL` verweist auf den laufenden Ticketshop, derzeit normalerweise `http://127.0.0.1:5174`.
- Der Ticketshop leitet `/api` an das Backend auf Port 8000 weiter.
- Die bestehenden SMTP-Einstellungen und `EMAIL_TEST_RECIPIENT` bleiben bestehen. Alle Mails gehen ausschließlich an diese Testadresse.
- Stripe-Testschlüssel und Webhook-Schlüssel sind eingerichtet.
- Der Stripe-Listener muss laufen. Falls noch keiner läuft, in einem weiteren Terminal:

```bash
stripe listen --forward-to http://127.0.0.1:8000/api/public/stripe/webhook
```

Der dort ausgegebene `whsec_...`-Wert muss zu `STRIPE_WEBHOOK_SECRET` in der lokalen Konfiguration passen.
Bei Änderung das Backend neu starten. Schlüssel und Passwörter nicht in den Chat kopieren.
Ein Link mit `127.0.0.1` funktioniert nur auf dem Mac, auf dem der Shop läuft, nicht auf dem Handy.

## Was geprüft wurde

- Python-Syntax und vollständiger Frontend-Build erfolgreich.
- 17 isolierte Regressionstests mit simuliertem Stripe, Datenbank und SMTP erfolgreich:
  Zahlung, SEPA-Wartezustand, verspätete Fehlermeldung, wiederholte Webhooks, erneuter Versand nur fehlgeschlagener Mails,
  Postversand, falscher Betrag, fremde Sitzung, Ablehnung von Live-Zahlungen, geänderte/stornierte Buchung,
  Wiederverwendung offener Checkouts, abgelaufene Checkouts und Netzwerkfehler mit gleichem Idempotenzschlüssel.
- Reservierungsmail auf Zahlungslink, Testempfänger, offene Formulierung und fehlende Ticketanhänge geprüft.

Nicht hier geprüft: eine vollständige Bestellung gegen deine laufende PostgreSQL-Datenbank, deinen Stripe-Account und dein SMTP-Postfach.
Bitte zunächst genau eine manuelle Testbuchung durch den gesamten Ablauf führen.

## Grenzen und Fehlerbehandlung

- Dieses Update ist auf den vorhandenen Stripe-Sandbox-/Testmailbetrieb beschränkt.
- Rechnungen ab 0,50 EUR können per Stripe bezahlt werden. Für kostenlose Buchungen wird kein Zahlungslink erstellt.
- Nach Versand eines Zahlungslinks den Rechnungsbetrag möglichst nicht ändern. Bei Änderungen wird die Zahlung blockiert bzw. zur manuellen Prüfung markiert.
  Eine bereits laufende Zahlung zu einer alten Rechnung muss zunächst in Stripe geklärt werden; das System erstellt dafür keinen parallelen zweiten Checkout.
- Bei Zahlung auf eine inzwischen stornierte oder geänderte Buchung erscheint ein Prüfhinweis im E-Mail-Ausgang. Es erfolgt kein automatischer Ticketversand.
- Normale Webhook-Wiederholungen versenden bereits protokollierte Mails nicht erneut. Versandfehler werden protokolliert und können erneut versucht werden.
  SMTP garantiert keinen exakt einmaligen Empfang: Ein Verbindungsabbruch nach Annahme der Mail, aber vor Speicherung des Erfolgs kann eine Doppelmail verursachen.
- „Versendet“ bedeutet Annahme durch den Mailserver, keine bestätigte Zustellung oder Lesebestätigung.
- Falls die Erstellung einer Stripe-Sitzung über 23 Stunden ungeklärt bleibt, wird ein weiterer automatischer Versuch blockiert und eine manuelle Prüfung verlangt.

Technische Referenzen:
- https://docs.stripe.com/checkout/fulfillment
- https://docs.stripe.com/api/idempotent_requests
