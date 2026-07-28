import { sendEmail, getEmailTemplate } from './config/mail';

async function main() {
  const targetEmail = 'abbupasha61@gmail.com';
  console.log(`Sending demo email to: ${targetEmail}`);
  
  const demoContent = `
    <p>Hello!</p>
    <p>This is a live demo email from the <strong>DESIGNTHON 2026</strong> registration platform, sent via Gmail SMTP.</p>
    
    <div class="ticket-card">
      <div class="ticket-header">DEMO ENTRY PASS</div>
      <div class="ticket-row">
        <span class="ticket-label">Attendee Name</span>
        <span class="ticket-value">Demo User</span>
      </div>
      <div class="ticket-row">
        <span class="ticket-label">Registered Email</span>
        <span class="ticket-value">${targetEmail}</span>
      </div>
      <div class="ticket-row">
        <span class="ticket-label">College</span>
        <span class="ticket-value">SkyWeb University</span>
      </div>
      <div class="ticket-row ticket-total">
        <span>Amount Paid</span>
        <span>₹1000</span>
      </div>
      
      <div class="qr-container">
        <p style="margin-bottom: 10px; font-size: 11px; color: #71717a;">DEMO QR CODE</p>
        <img src="https://quickchart.io/qr?text=demo_user_id&size=120&margin=1" class="qr-img" alt="Demo QR" />
      </div>
    </div>
    
    <div class="cta-container">
      <a href="https://designthon.skywebdev.xyz" class="cta-button">Visit Platform</a>
    </div>
  `;
  
  const mailHtml = getEmailTemplate('Live Demo Email Notification', demoContent);
  const success = await sendEmail(targetEmail, 'DESIGNTHON 2026 - Live SMTP Demo Notification', mailHtml);
  if (success) {
    console.log('Demo email successfully dispatched!');
  } else {
    console.error('Failed to send demo email.');
  }
}

main().catch(console.error);
