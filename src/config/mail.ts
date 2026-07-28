import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

if (!SMTP_USER || !SMTP_PASS) {
  console.warn('[Mail Warning] SMTP_USER or SMTP_PASS is missing in environment variables. Email service will run in simulated mode.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: SMTP_USER || '',
    pass: SMTP_PASS || '',
  },
});

/**
 * Sends a raw or custom HTML email.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!SMTP_USER || !SMTP_PASS) {
    console.log(`[SIMULATED EMAIL] To: ${to} | Subject: ${subject}`);
    return true;
  }

  try {
    const info = await transporter.sendMail({
      from: `"DESIGNTHON 2026" <${SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[Email Sent] Message ID: ${info.messageId} (To: ${to})`);
    return true;
  } catch (error) {
    console.error('[Email Error] Failed to dispatch email:', error);
    return false;
  }
}

/**
 * Wraps dynamic content in a premium, responsive DESIGNTHON styled HTML template.
 */
export function getEmailTemplate(title: string, bodyContent: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
          body {
            background-color: #03030f;
            color: #d4d4d8;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 0;
            -webkit-text-size-adjust: none;
            -ms-text-size-adjust: none;
          }
          .wrapper {
            width: 100%;
            background-color: #03030f;
            padding: 40px 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #08081a;
            border: 1px solid #1f1f3a;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          }
          .header {
            background: linear-gradient(135deg, #18182c 0%, #0c0c1e 100%);
            padding: 30px;
            text-align: center;
            border-bottom: 1px solid #1f1f3a;
          }
          .logo {
            display: inline-block;
            background-color: #ffffff;
            color: #000000;
            font-weight: 900;
            font-size: 24px;
            width: 48px;
            height: 48px;
            line-height: 48px;
            text-align: center;
            border-radius: 12px;
            margin-bottom: 15px;
          }
          .title {
            color: #ffffff;
            font-size: 22px;
            font-weight: 800;
            margin: 0;
            letter-spacing: -0.5px;
          }
          .subtitle {
            color: #71717a;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-top: 5px;
          }
          .content {
            padding: 40px 30px;
            font-size: 14px;
            line-height: 1.6;
            color: #c8c8d0;
          }
          .cta-container {
            text-align: center;
            margin: 30px 0;
          }
          .cta-button {
            display: inline-block;
            background-color: #ffffff;
            color: #000000 !important;
            font-weight: bold;
            font-size: 13px;
            text-decoration: none;
            padding: 14px 28px;
            border-radius: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
            box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
          }
          .footer {
            background-color: #050514;
            padding: 25px 30px;
            text-align: center;
            border-top: 1px solid #15152a;
            font-size: 11px;
            color: #52525b;
            line-height: 1.5;
          }
          .ticket-card {
            border: 1px dashed #3f3f5f;
            background-color: #060618;
            border-radius: 16px;
            padding: 20px;
            margin: 25px 0;
            position: relative;
          }
          .ticket-header {
            font-weight: bold;
            color: #ffffff;
            border-bottom: 1px solid #1f1f3a;
            padding-bottom: 10px;
            margin-bottom: 15px;
            font-size: 15px;
            letter-spacing: 0.5px;
          }
          .ticket-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
          }
          .ticket-label {
            color: #71717a;
          }
          .ticket-value {
            font-weight: 600;
            color: #e4e4e7;
          }
          .ticket-total {
            font-size: 18px;
            font-weight: 800;
            color: #ffffff;
            border-top: 1px solid #1f1f3a;
            padding-top: 10px;
            margin-top: 15px;
          }
          .qr-container {
            text-align: center;
            margin-top: 20px;
          }
          .qr-img {
            background-color: #ffffff;
            padding: 8px;
            border-radius: 12px;
            display: inline-block;
            width: 120px;
            height: 120px;
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="header">
              <div class="logo">D</div>
              <h2 class="title">${title}</h2>
              <div class="subtitle">DESIGNTHON 2026</div>
            </div>
            <div class="content">
              ${bodyContent}
            </div>
            <div class="footer">
              DESIGNTHON 2026 &bull; Hyderabad's Premier UI/UX Hackathon<br>
              Organized by SkyWeb &bull; cohort venue check-in opens Sept 12, 09:00 AM<br>
              <span style="color: #3f3f46; display: block; margin-top: 10px;">If you have any questions, reply to this email.</span>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}
