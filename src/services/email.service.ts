import nodemailer, { Transporter } from 'nodemailer';
import jwt from 'jsonwebtoken';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const EMAIL_ACTION_SECRET = process.env.EMAIL_ACTION_SECRET || 'email-action-jwt-secret-2026';

let transporter: Transporter | null = null;

// Initialize Nodemailer Transporter
async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpUser && smtpPass) {
    // Production / Custom SMTP (e.g. AWS SES SMTP or Gmail)
    transporter = nodemailer.createTransport({
      host: smtpHost || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  } else {
    // Development / Ethereal Fallback (Auto-generates test inbox)
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      console.log(`[EmailService] Dev Ethereal Account created: ${testAccount.user}`);
    } catch (err) {
      console.warn('[EmailService] Could not create Ethereal test account. Using JSON transport fallback.');
      transporter = nodemailer.createTransport({
        jsonTransport: true,
      });
    }
  }

  return transporter;
}

export interface BookingNotificationPayload {
  bookingId: string;
  ownerEmail: string;
  ownerName: string;
  guestName: string;
  guestEmail: string;
  listingTitle: string;
  businessName: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
}

/**
 * Generate a signed JWT token for 1-click email action (Accept/Decline)
 */
export function generateActionToken(bookingId: string, action: 'CONFIRMED' | 'CANCELLED'): string {
  return jwt.sign({ bookingId, action }, EMAIL_ACTION_SECRET, { expiresIn: '7d' });
}

/**
 * Verify a 1-click email action JWT token
 */
export function verifyActionToken(token: string): { bookingId: string; action: 'CONFIRMED' | 'CANCELLED' } {
  return jwt.verify(token, EMAIL_ACTION_SECRET) as { bookingId: string; action: 'CONFIRMED' | 'CANCELLED' };
}

/**
 * Send 1-Click Action Email Notification to Property Owner
 */
export async function sendOwnerBookingNotification(data: BookingNotificationPayload): Promise<void> {
  const acceptToken = generateActionToken(data.bookingId, 'CONFIRMED');
  const declineToken = generateActionToken(data.bookingId, 'CANCELLED');

  const acceptUrl = `${BACKEND_URL}/api/bookings/action?token=${acceptToken}`;
  const declineUrl = `${BACKEND_URL}/api/bookings/action?token=${declineToken}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Booking Request</title>
      <style>
        body {
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
          background-color: #0f172a;
          color: #f8fafc;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background: #1e293b;
          border-radius: 16px;
          border: 1px solid #334155;
          padding: 32px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        }
        .header {
          border-bottom: 1px solid #334155;
          padding-bottom: 20px;
          margin-bottom: 24px;
        }
        .header h1 {
          margin: 0;
          font-size: 22px;
          color: #38bdf8;
        }
        .header p {
          margin: 4px 0 0 0;
          color: #94a3b8;
          font-size: 14px;
        }
        .details-card {
          background: #0f172a;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 28px;
          border: 1px solid #334155;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px dashed #1e293b;
          font-size: 15px;
        }
        .detail-row:last-child {
          border-bottom: none;
        }
        .label {
          color: #94a3b8;
        }
        .value {
          color: #f1f5f9;
          font-weight: 600;
        }
        .price {
          color: #4ade80;
          font-size: 18px;
          font-weight: 700;
        }
        .actions {
          display: flex;
          gap: 16px;
          margin-top: 28px;
        }
        .btn {
          flex: 1;
          display: block;
          text-align: center;
          padding: 14px 20px;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 700;
          font-size: 15px;
          transition: all 0.2s ease;
        }
        .btn-accept {
          background-color: #16a34a;
          color: #ffffff !important;
          box-shadow: 0 4px 14px 0 rgba(22, 163, 74, 0.39);
        }
        .btn-decline {
          background-color: #dc2626;
          color: #ffffff !important;
          box-shadow: 0 4px 14px 0 rgba(220, 38, 38, 0.39);
        }
        .footer {
          margin-top: 32px;
          text-align: center;
          font-size: 12px;
          color: #64748b;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🛎️ New Booking Request!</h1>
          <p>Hello ${data.ownerName}, you have received a new reservation for <strong>${data.businessName}</strong>.</p>
        </div>

        <div class="details-card">
          <div class="detail-row">
            <span class="label">Property / Listing</span>
            <span class="value">${data.listingTitle}</span>
          </div>
          <div class="detail-row">
            <span class="label">Guest Name</span>
            <span class="value">${data.guestName}</span>
          </div>
          <div class="detail-row">
            <span class="label">Guest Email</span>
            <span class="value">${data.guestEmail}</span>
          </div>
          <div class="detail-row">
            <span class="label">Check-in Date</span>
            <span class="value">${new Date(data.checkIn).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <div class="detail-row">
            <span class="label">Check-out Date</span>
            <span class="value">${new Date(data.checkOut).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <div class="detail-row">
            <span class="label">Total Amount</span>
            <span class="price">$${data.totalPrice.toFixed(2)}</span>
          </div>
        </div>

        <p style="text-align: center; color: #cbd5e1; font-weight: 500;">Take immediate action with 1-click below:</p>

        <div class="actions">
          <a href="${acceptUrl}" class="btn btn-accept" target="_blank">✓ Accept Reservation</a>
          <a href="${declineUrl}" class="btn btn-decline" target="_blank">✕ Decline Reservation</a>
        </div>

        <div class="footer">
          <p>You can also log in to your owner dashboard at any time to manage all bookings.</p>
          <p>&copy; 2026 Booking Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const transport = await getTransporter();
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Booking Platform" <noreply@bookingplatform.com>',
      to: data.ownerEmail,
      subject: `🚨 New Reservation Request for ${data.listingTitle} ($${data.totalPrice.toFixed(2)})`,
      html: htmlContent,
    };

    const info = await transport.sendMail(mailOptions);
    console.log(`[EmailService] Notification sent to ${data.ownerEmail} (MessageId: ${info.messageId})`);

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[EmailService] ✉️ Dev Email Preview URL: ${previewUrl}`);
    }
  } catch (error) {
    console.error('[EmailService] Failed to send owner email notification:', error);
  }
}
