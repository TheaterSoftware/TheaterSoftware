# Reservierungsbestätigung mit Zahlungslink und letzter Erinnerung

## Neu

Auf dem Dashboard gibt es „Reservierungsbestätigung mit Zahlungslink“.

- Veranstaltung auswählen: Die Vorlage wird getrennt je Event gespeichert.
- Administratoren können Texte, Betreff, Schrift und Farben bearbeiten.
- Die Live-Vorschau zeigt Reservierung oder letzte Erinnerung; Änderungen werden nach kurzer Eingabepause übernommen.
- Buchung auswählen und die gespeicherte Reservierungsmail manuell senden. Dafür vorher eine offene Rechnung zur Buchung speichern.
- Mitarbeiter dürfen gespeicherte Vorlagen verwenden und senden; Änderungen an der Vorlage sind Administratoren vorbehalten.
- Die letzte Erinnerung verwendet dieselbe Gestaltung und denselben Zahlungslink. Betreff, Überschrift und Hinweistext sind separat bearbeitbar.
- Der erste erfolgreiche Versand startet die Fünf-Tage-Frist. Erneuter manueller Versand setzt sie nicht zurück.
- Die letzte Erinnerung wird einmalig automatisch gesendet, solange Buchung und Rechnung offen sind.
- Bei bezahlten/stornierten Buchungen, geändertem Rechnungsbetrag, einer laufenden Zahlung oder manueller Zahlungsprüfung wird keine Erinnerung verschickt.
- Versandzeitpunkte und Fehler erscheinen im neuen Bereich und im E-Mail-Ausgang.

Die Automatik prüft etwa jede Minute. Sie läuft nur bei eingeschaltetem Backend. Nach einer Pause werden fällige Nachrichten erneut geprüft und gegebenenfalls nachgeholt. Ein zusätzlicher Timer oder Terminalbefehl ist nicht nötig.

## Installation auf dem lokalen Mac

ZIP als `Reservierung-Vorlagen-5Tage-Update.zip` in Downloads speichern.
In einem freien Terminal ausführen:

```bash
(
  set -e
  cd "$HOME/TheaterSoftware"
  test -f "$HOME/Downloads/Reservierung-Vorlagen-5Tage-Update.zip"
  backup_dir="$HOME/TheaterSoftware-Backup-Reservierung-$(date +%Y-%m-%d_%H-%M-%S)"
  mkdir -p "$backup_dir/backend" "$backup_dir/frontend"
  cp backend/main.py "$backup_dir/backend/main.py"
  cp -R frontend/src "$backup_dir/frontend/src"
  unzip -o "$HOME/Downloads/Reservierung-Vorlagen-5Tage-Update.zip"
  .venv/bin/python -m py_compile backend/main.py
  cd frontend
  npm run build
  echo "UPDATE ERFOLGREICH INSTALLIERT"
)
```

Im bisherigen Backend-Terminal Ctrl+C drücken, danach:

```bash
cd "$HOME/TheaterSoftware"
source .venv/bin/activate
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Backend, Mitarbeiteroberfläche, Testticketshop und den bestehenden Stripe-Listener geöffnet lassen. Mitarbeiterseite neu laden.
Das Update fügt beim Backend-Start eine Vorlagentabelle sowie eine Spalte für den ersten Versandzeitpunkt hinzu. Bestehende Kundendaten werden nicht gelöscht.
Bei älteren Versandprotokollen wird der bisher gespeicherte Versandzeitpunkt als Ausgangspunkt übernommen, da frühere Wiederholungszeitpunkte nicht vollständig rekonstruierbar sind.

## Erster Test

1. Als Administrator den neuen Dashboard-Bereich öffnen und das Event auswählen.
2. Vorlage bearbeiten, beide Vorschauen ansehen und speichern.
3. Eine reservierte Testbuchung mit offener Rechnung auswählen.
4. „Reservierungsmail mit Zahlungslink senden“ anklicken.
5. Testpostfach prüfen und den Zahlungslink auf demselben Mac öffnen.
6. Nach einer bestätigten Stripe-Testzahlung den Versandstatus aktualisieren: Buchung bezahlt, Bestätigung/Rechnung und digitale Tickets versendet; keine spätere Erinnerung.
7. Eine andere unbezahlte Testbuchung bleibt für die einmalige Erinnerung nach fünf Tagen vorgemerkt. Die Erinnerungsmail kann sofort in der Vorschau betrachtet werden.

Alle Nachrichten gehen weiterhin ausschließlich an EMAIL_TEST_RECIPIENT. Die bestehenden SMTP- und Stripe-Sandbox-Einstellungen bleiben erforderlich. Ein Link mit 127.0.0.1 funktioniert nur auf dem Mac, auf dem der Shop läuft.

## Validierung und Grenzen

Python-Syntaxprüfung und Frontend-Build erfolgreich. 27 isolierte Regressionstests mit simulierten Datenbank-, Stripe- und SMTP-Schnittstellen bestanden. Sie prüfen unter anderem Zahlung, ausstehende SEPA-Zahlung, doppelte Webhooks, Versandfehler, Erinnerungsberechtigung, abweichende Rechnungen und die wiederholte Zustellung einer Erinnerung.

Ein vollständiger Test mit deiner laufenden PostgreSQL-Datenbank, Stripe und one.com wurde hier nicht durchgeführt. Die Browserprüfung konnte in dieser Umgebung mangels installiertem Chromium nicht ausgeführt werden. Bitte daher zuerst lokal mit einer Testbuchung prüfen.

SMTP-Versandfehler werden protokolliert; die Erinnerungsautomatik versucht es frühestens nach einer Stunde erneut. Bereits als versendet protokollierte Erinnerungen werden nicht erneut gesendet. Ein Prozessabbruch nach Annahme einer Mail durch SMTP, aber vor Speicherung des Erfolgs, kann technisch eine Doppelmail verursachen.

„Versendet“ bestätigt die Annahme durch den Mailserver, keine Lesebestätigung. Bei einer unmittelbar gleichzeitig extern abgeschlossenen Zahlung ist trotz Statusprüfung kurz vor Versand eine Überschneidung mit einer Erinnerung möglich.

Dieses Paket basiert auf dem hier zuletzt bearbeiteten Projektstand und enthält auch den vorherigen Reservierungs-/Stripe-Ablauf. Es ersetzt backend/main.py sowie die angegebenen Frontend-Dateien. Eigene neuere Änderungen an diesen Dateien vor Installation vergleichen.
