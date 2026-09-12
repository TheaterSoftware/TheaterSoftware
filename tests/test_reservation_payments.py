"""Isolierte Regressionstests mit simuliertem Stripe/DB/SMTP, ohne echte Zahlungen."""
import ast
from pathlib import Path
import unittest
from types import SimpleNamespace
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from uuid import uuid4
from unittest.mock import Mock, MagicMock
import html
from email.message import EmailMessage
from email.utils import formatdate

SOURCE = Path(__file__).resolve().parents[1] / 'backend/main.py'
NAMES = {'handle_reservation_payment_event', 'start_reservation_payment',
         'reservation_is_paid', 'prepare_and_send_paid_booking_confirmation',
         'reserve_message_delivery', 'booking_confirmation_html', 'send_reservation_email',
         'reservation_render_settings','reservation_template_defaults','reservation_reminder_eligible','send_due_reservation_reminder'}

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)

class Database:
    def __init__(self):
        self.payment = [7, 9, 5340, 'open']
        self.attempt = ['attempt', 'cs_test_1', 'open', datetime.now(timezone.utc)]
        self.invoice = dict(booking_id=7, invoice_id=9, amount_cents=5340,
                            booking_status='reserviert', payment_status='offen',
                            booking_number='BTD-0065', invoice_number='R-1')
        self.deliveries = {}
        self.statements = []
    def connect(self, *_): return self
    def __enter__(self): return self
    def __exit__(self, *_): pass
    def cursor(self): return Cursor(self)
    def commit(self): pass

class Cursor:
    def __init__(self, db): self.db, self.row = db, None
    def __enter__(self): return self
    def __exit__(self, *_): pass
    def fetchone(self): return self.row
    def execute(self, sql, params=()):
        q = ' '.join(sql.split())
        self.db.statements.append(q)
        d = self.db
        self.row = None
        if q.startswith('SELECT booking_id,invoice_id,amount_cents,status'):
            self.row = tuple(d.payment)
        elif q.startswith('SELECT id,session_id,status,created_at'):
            self.row = tuple(d.attempt) if d.attempt else None
        elif q.startswith('SELECT id,session_id,status'):
            self.row = tuple(d.attempt[:3]) if params[0] == d.attempt[0] else None
        elif q.startswith('SELECT session_id'):
            self.row = (d.attempt[1],)
        elif q.startswith('SELECT a.id'): pass
        elif q.startswith('INSERT INTO reservation_payment_attempts'):
            d.attempt = [params[0], None, 'creating', datetime.now(timezone.utc)]
        elif q.startswith('UPDATE reservation_payment_attempts'):
            if 'session_id=%s' in q:
                d.attempt[1:3] = [params[0], 'open']
            else:
                d.attempt[2] = params[0] if 'status=%s' in q else q.split("status='")[1].split("'")[0]
        elif q.startswith('UPDATE reservation_payments'):
            d.payment[3] = q.split("status='")[1].split("'")[0]
        elif q.startswith('UPDATE bookings'):
            d.invoice['booking_status'] = 'bezahlt'
        elif q.startswith('UPDATE invoices'):
            d.invoice['payment_status'] = 'bezahlt'
        elif q.startswith('INSERT INTO invoice_email_deliveries'):
            d.deliveries.setdefault(params[2], [len(d.deliveries) + 1, 'pending', datetime.now()])
        elif q.startswith('SELECT id, status, updated_at'):
            self.row = tuple(d.deliveries[params[1]])
        elif q.startswith('UPDATE invoice_email_deliveries'):
            for row in d.deliveries.values():
                if row[0] == params[-1]: row[1] = 'sending'
        else: raise AssertionError('Unexpected query: ' + q)

class PaymentTests(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.sent = []
        self.create = Mock(return_value={'id':'cs_test_new','url':'https://checkout.stripe.com/test'})
        self.retrieve = Mock(return_value={'status':'open','url':'https://checkout.stripe.com/test'})
        self.ns = dict(
            HTTPException=HTTPException, Request=object, psycopg=self.db, DB_CONFIG='test',
            STRIPE_SECRET_KEY='sk_test_fake',
            datetime=datetime, timezone=timezone, timedelta=timedelta, Decimal=Decimal, uuid4=uuid4,
            stripe=SimpleNamespace(checkout=SimpleNamespace(Session=SimpleNamespace(create=self.create, retrieve=self.retrieve))),
            stripe_payload_to_dict=lambda x:x, require_stripe_test_configuration=lambda:None,
            reservation_invoice=self.invoice, reservation_payment_page=lambda message,*_:message,
            RedirectResponse=lambda url,status_code: url, TICKETSHOP_BASE_URL='http://localhost:5174',
            EMAIL_TEST_RECIPIENT='test@example.invalid',
            MESSAGE_TYPE_BOOKING_CONFIRMATION='confirmation', MESSAGE_TYPE_TICKETS='tickets', MESSAGE_TYPE_INVOICE='invoice',
            ensure_paid_stripe_invoice=lambda _: {'invoice_id':9}, load_invoice_email_context=self.context,
            load_ticket_context=lambda x:x, ticket_pdf_bytes=lambda _:b'pdf', invoice_pdf_bytes=lambda _:b'pdf',
            send_offline_booking_confirmation_email=lambda _:self.send('confirmation'),
            send_offline_ticket_email=lambda *_:self.send('tickets'),
            send_offline_invoice_email=lambda *_:self.send('invoice'),
            mark_message_delivery_sent=self.mark_sent,
            record_message_delivery_failure=self.mark_failed,
        )
        tree = ast.parse(SOURCE.read_text())
        selected=[]
        for node in tree.body:
            if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in NAMES:
                node.decorator_list=[]
                selected.append(node)
        exec(compile(ast.Module(body=selected,type_ignores=[]),str(SOURCE),'exec'),self.ns)
        self.session = dict(id='cs_test_1',livemode=False,currency='eur',amount_total=5340,
                            payment_status='paid',metadata={'reservation_payment':'token','reservation_attempt':'attempt'})
    def invoice(self,*_):
        if self.db.invoice['booking_status']=='storniert': raise HTTPException(409,'storniert')
        return self.db.invoice.copy()
    def context(self,*_):
        return dict(self.db.invoice,customer_email='customer@example.invalid',delivery_method=getattr(self,'delivery_method','email'))
    def send(self,kind):
        if getattr(self,'fail',None)==kind: raise RuntimeError('SMTP unavailable')
        self.sent.append(kind)
    def mark_sent(self,id):
        for row in self.db.deliveries.values():
            if row[0]==id: row[1]='sent'
    def mark_failed(self,ctx,kind,exc): self.db.deliveries[kind][1]='failed'
    def event(self,type='checkout.session.completed'):
        return self.ns['handle_reservation_payment_event'](self.session,type,None)
    def checkout(self): return self.ns['start_reservation_payment']('token')
    def test_paid_updates_existing_and_sends_three_once(self):
        self.event(); self.event()
        self.assertEqual(self.sent,['confirmation','tickets','invoice'])
        self.assertEqual(self.db.invoice['booking_status'],'bezahlt')
        self.assertFalse(any('INSERT INTO bookings' in q for q in self.db.statements))
    def test_sepa_waits_for_actual_success(self):
        self.session['payment_status']='unpaid'
        self.event()
        self.assertEqual(self.sent,[])
        self.assertEqual(self.db.invoice['payment_status'],'offen')
        self.assertEqual(self.db.attempt[2],'processing')
        self.checkout(); self.create.assert_not_called()
        self.session['payment_status']='paid'
        self.event('checkout.session.async_payment_succeeded')
        self.assertEqual(len(self.sent),3)
    def test_failed_mail_retries_only_missing_message(self):
        self.fail='tickets'
        with self.assertRaises(RuntimeError): self.event()
        self.fail=None
        self.event()
        self.assertCountEqual(self.sent,['confirmation','tickets','invoice'])
    def test_wrong_amount_rejected(self):
        self.session['amount_total']=4990
        with self.assertRaises(HTTPException): self.event()
        self.assertEqual(self.sent,[])
    def test_live_rejected(self):
        self.session['livemode']=True
        with self.assertRaises(HTTPException): self.event()
    def test_wrong_session_rejected(self):
        self.session['id']='cs_other'
        with self.assertRaises(HTTPException): self.event()
    def test_cancelled_requires_review(self):
        self.db.invoice['booking_status']='storniert'
        self.event()
        self.assertEqual(self.db.payment[3],'review')
        self.assertEqual(self.sent,[])
    def test_changed_invoice_requires_review(self):
        self.db.invoice['amount_cents']=6000
        self.event()
        self.assertEqual(self.db.payment[3],'review')
    def test_postal_does_not_send_digital_ticket(self):
        self.delivery_method='postal'
        self.event()
        self.assertEqual(self.sent,['confirmation','invoice'])
    def test_late_failure_does_not_unpay(self):
        self.event()
        self.session['payment_status']='unpaid'
        self.event('checkout.session.async_payment_failed')
        self.assertEqual(self.db.payment[3],'paid')
    def test_open_session_reused(self):
        self.assertEqual(self.checkout(),'https://checkout.stripe.com/test')
        self.create.assert_not_called()
    def test_complete_session_never_recharged(self):
        self.retrieve.return_value={'status':'complete'}
        self.checkout()
        self.assertEqual(self.db.attempt[2],'processing')
        self.create.assert_not_called()
    def test_expired_session_gets_new_attempt(self):
        self.retrieve.return_value={'status':'expired'}
        self.checkout()
        self.assertEqual(self.create.call_count,1)
        self.assertNotEqual(self.db.attempt[0],'attempt')
    def test_network_retry_keeps_idempotency_key(self):
        self.db.attempt[1:3]=[None,'creating']
        self.create.side_effect=RuntimeError('network timeout')
        with self.assertRaises(RuntimeError): self.checkout()
        self.create.side_effect=None
        self.checkout()
        self.assertEqual([c.kwargs['idempotency_key'] for c in self.create.call_args_list],['reservation-attempt']*2)
    def test_unknown_old_attempt_does_not_create_charge(self):
        self.db.attempt[1:3]=[None,'creating']
        self.db.attempt[3]-=timedelta(days=2)
        with self.assertRaises(HTTPException): self.checkout()
        self.create.assert_not_called()
    def test_unpaid_cannot_send_paid_messages(self):
        with self.assertRaises(HTTPException): self.ns['prepare_and_send_paid_booking_confirmation'](7)
        self.assertEqual(self.sent,[])
    def test_reservation_mail_has_link_and_no_paid_claim_or_ticket(self):
        messages=[]
        self.ns.update(EmailMessage=EmailMessage, formatdate=formatdate, html_module=html,
            EMAIL_FROM_ADDRESS='sender@example.invalid',SMTP_USERNAME='',
            euro_text=lambda x:f'{x} EUR', EMAIL_FONT_FAMILIES={'system':'Arial'},
            normalize_email_template_settings=lambda x:x,
            load_email_event_template=lambda _:dict(sender_name='Theater',font_family='system',
                background_color='#ffffff',header_color='#222222',accent_color='#881133',
                card_color='#eeeeee',text_color='#111111',closing_text='Dein Theater'),
            smtp_send_message=messages.append)
        context=dict(self.context(),performance_id=1,event_date=None,event_time=None,
                     customer_first_name='Test',customer_last_name='Person',event_title='Test Event',
                     amount_due=Decimal('53.40'),ticket_count=1,payment_url='http://localhost/pay/token')
        self.ns['load_reservation_template'] = self.ns['reservation_template_defaults']
        self.ns['render_email_template_text'] = lambda value, ctx: value.replace('{booking_number}',ctx['booking_number'])
        self.ns['send_reservation_email'](context)
        mail=messages[0]
        body=mail.get_body(preferencelist=('html',)).get_content()
        self.assertIn('http://localhost/pay/token',body)
        self.assertIn('noch nicht bestätigt',body)
        self.assertNotIn('wurde erfolgreich bestätigt',body)
        self.assertEqual(list(mail.iter_attachments()),[])
        self.assertEqual(mail['To'],'test@example.invalid')

    def test_reminder_uses_same_design_and_link(self):
        self.test_reservation_mail_has_link_and_no_paid_claim_or_ticket()
        mails=[]
        self.ns['smtp_send_message']=mails.append
        context=dict(self.context(),performance_id=1,event_date=None,event_time=None,
                     customer_first_name='Test',customer_last_name='Person',event_title='Event',
                     amount_due=Decimal('53.40'),ticket_count=1,payment_url='http://localhost/pay/same')
        self.ns['send_reservation_email'](context,reminder=True)
        body=mails[0].get_body(preferencelist=('html',)).get_content()
        self.assertIn('Letzte Erinnerung',mails[0]['Subject'])
        self.assertIn('noch keine Zahlung eingegangen',body)
        self.assertIn('#881133',body)
        self.assertIn('http://localhost/pay/same',body)
        self.assertEqual(list(mails[0].iter_attachments()),[])

    def reminder(self,states=(),invoice=None,payment=None):
        return self.ns['reservation_reminder_eligible'](invoice or self.db.invoice,
            payment or ['token',9,5340,'open'],states)

    def test_open_unpaid_reservation_is_eligible(self):
        self.assertTrue(self.reminder(['open','expired','failed']))

    def test_paid_cancelled_or_review_never_reminded(self):
        for key,value in [('booking_status','bezahlt'),('booking_status','storniert'),('payment_status','bezahlt')]:
            with self.subTest(key=key,value=value):
                self.assertFalse(self.reminder(invoice={**self.db.invoice,key:value}))
        self.assertFalse(self.reminder(payment=['token',9,5340,'review']))

    def test_pending_payment_never_reminded(self):
        for state in ['processing','creating','paid','review']:
            with self.subTest(state=state): self.assertFalse(self.reminder([state]))

    def test_changed_invoice_never_reminded(self):
        self.assertFalse(self.reminder(payment=['token',10,5340,'open']))
        self.assertFalse(self.reminder(payment=['token',9,6000,'open']))

    def setup_reminder_worker(self,rows=None,attempts=None):
        connection=MagicMock()
        connection.__enter__.return_value=connection
        cursor=MagicMock()
        connection.cursor.return_value.__enter__.return_value=cursor
        cursor.fetchone.side_effect=rows if rows is not None else [(7,9),('token',9,5340,'open')]
        cursor.fetchall.return_value=attempts or []
        self.ns['psycopg']=SimpleNamespace(connect=lambda _:connection)
        self.ns['reserve_message_delivery']=Mock(return_value={'send':True,'delivery_id':1})
        self.ns['send_reservation_email']=Mock()
        self.ns['mark_message_delivery_sent']=Mock()
        self.ns['record_message_delivery_failure']=Mock()
        return cursor

    def test_not_due_or_locked_is_not_sent(self):
        self.setup_reminder_worker(rows=[None])
        self.ns['send_due_reservation_reminder'](1)
        self.ns['send_reservation_email'].assert_not_called()

    def test_due_reminder_uses_delivery_ledger(self):
        self.setup_reminder_worker()
        self.ns['send_due_reservation_reminder'](1)
        self.ns['send_reservation_email'].assert_called_once()
        self.assertTrue(self.ns['send_reservation_email'].call_args.kwargs['reminder'])
        self.ns['mark_message_delivery_sent'].assert_called_once_with(1)

    def test_already_sent_reminder_not_resent(self):
        self.setup_reminder_worker()
        self.ns['reserve_message_delivery'].return_value={'send':False,'status':'sent'}
        self.ns['send_due_reservation_reminder'](1)
        self.ns['send_reservation_email'].assert_not_called()

    def test_delayed_paid_webhook_blocks_reminder(self):
        self.setup_reminder_worker(attempts=[('open','cs_test')])
        self.retrieve.return_value={'status':'complete','payment_status':'paid'}
        self.ns['send_due_reservation_reminder'](1)
        self.ns['send_reservation_email'].assert_not_called()

    def test_reminder_mail_failure_is_recorded(self):
        self.setup_reminder_worker()
        self.ns['send_reservation_email'].side_effect=RuntimeError('SMTP timeout')
        with self.assertRaises(RuntimeError): self.ns['send_due_reservation_reminder'](1)
        self.ns['record_message_delivery_failure'].assert_called_once()
        self.ns['mark_message_delivery_sent'].assert_not_called()

if __name__=='__main__': unittest.main(verbosity=2)
