import nodemailer, { Transporter } from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_SECURE = process.env.SMTP_SECURE;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@numenorsystems.com';

let transporter: Transporter | null = null;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
  console.warn('[mailer] SMTP env vars are not fully set — invite/reset emails will fail until they are set.');
} else {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    secure: SMTP_SECURE !== 'false',
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
}

function wrapEmailHtml(heading: string, body: string, buttonLabel: string, buttonUrl: string, footer: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;font-family:Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">${heading}</h2>
            <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.5;">${body}</p>
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:8px;background:#6366f1;">
                  <a href="${buttonUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">${buttonLabel}</a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;color:#9ca3af;font-size:13px;line-height:1.4;">${footer}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) throw new Error('SMTP transporter is not configured');
  await transporter.sendMail({ from: SMTP_FROM, to, subject, html });
}

export async function sendInviteEmail(to: string, name: string, activationUrl: string): Promise<void> {
  const html = wrapEmailHtml(
    `Вітаємо, ${name}!`,
    'Для вас створено обліковий запис у системі Numenor Systems. Щоб активувати обліковий запис і встановити пароль, натисніть кнопку нижче.',
    'Активувати обліковий запис',
    activationUrl,
    'Посилання дійсне протягом 24 годин. Якщо ви не очікували цього листа, просто проігноруйте його.'
  );
  await send(to, 'Запрошення до Numenor Systems', html);
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
  const html = wrapEmailHtml(
    `Вітаємо, ${name}!`,
    'Ми отримали запит на відновлення пароля для вашого облікового запису. Натисніть кнопку нижче, щоб встановити новий пароль.',
    'Скинути пароль',
    resetUrl,
    'Посилання дійсне протягом 1 години. Якщо ви не надсилали цей запит, просто проігноруйте цей лист — ваш пароль залишиться без змін.'
  );
  await send(to, 'Відновлення пароля Numenor Systems', html);
}
