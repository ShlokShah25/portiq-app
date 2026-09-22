const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

// Initialize Twilio client (if credentials are provided)
let twilioClient = null;
let twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER
};

if (twilioConfig.accountSid && twilioConfig.authToken) {
  try {
    twilioClient = twilio(
      twilioConfig.accountSid,
      twilioConfig.authToken
    );
    console.log('✅ Twilio client initialized');
    console.log(`   Account SID: ${twilioConfig.accountSid.substring(0, 8)}...`);
    console.log(`   WhatsApp Number: ${twilioConfig.whatsappNumber || 'NOT SET'}`);
    
    if (!twilioConfig.whatsappNumber) {
      console.warn('⚠️  WARNING: TWILIO_WHATSAPP_NUMBER not set in .env file!');
      console.warn('   WhatsApp messages will not be sent.');
    } else {
      // Validate WhatsApp number format
      if (!twilioConfig.whatsappNumber.startsWith('whatsapp:+')) {
        console.warn('⚠️  WARNING: TWILIO_WHATSAPP_NUMBER should start with "whatsapp:+"');
        console.warn(`   Current value: ${twilioConfig.whatsappNumber}`);
        console.warn('   Example: whatsapp:+14155238886');
      }
    }
    
    // Test Twilio connection
    twilioClient.api.accounts(twilioConfig.accountSid).fetch()
      .then(account => {
        console.log(`✅ Twilio account verified: ${account.friendlyName || 'Active'}`);
        console.log(`   Account status: ${account.status}`);
      })
      .catch(err => {
        console.error('❌ Twilio account verification failed:', err.message);
        console.error('   Check your Account SID and Auth Token');
      });
  } catch (error) {
    console.error('❌ Failed to initialize Twilio client:', error.message);
    console.error('   Check your .env file for TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
  }
} else {
  console.warn('⚠️  Twilio credentials not found in .env file');
  console.warn('   Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER');
  console.warn('   WhatsApp messages will not be sent until configured.');
}

/**
 * Normalize phone to E.164 (+91 default for India).
 */
function normalizeWhatsAppPhone(phoneNumber) {
  let normalizedPhone = String(phoneNumber || '').trim();
  normalizedPhone = normalizedPhone.replace(/^whatsapp:/, '');
  if (!normalizedPhone.startsWith('+')) {
    normalizedPhone = normalizedPhone.replace(/^(0|91)/, '');
    normalizedPhone = `+91${normalizedPhone}`;
  }
  return normalizedPhone.replace(/[\s\-()]/g, '');
}

/**
 * Send plain-text WhatsApp message (Cura booking, reminders).
 */
async function sendWhatsAppText(phoneNumber, body) {
  if (!twilioClient) {
    console.warn('[whatsapp] Twilio not configured — message not sent:', String(body).slice(0, 80));
    return { success: false, message: 'WhatsApp service not configured' };
  }
  if (!twilioConfig.whatsappNumber) {
    return { success: false, message: 'WhatsApp number not configured' };
  }

  try {
    const normalizedPhone = normalizeWhatsAppPhone(phoneNumber);
    let fromNumber = twilioConfig.whatsappNumber;
    if (!fromNumber.startsWith('whatsapp:')) {
      fromNumber = `whatsapp:${fromNumber}`;
    }

    const result = await twilioClient.messages.create({
      from: fromNumber,
      to: `whatsapp:${normalizedPhone}`,
      body: String(body || '').trim(),
    });
    return { success: true, messageSid: result.sid, status: result.status };
  } catch (error) {
    console.error('[whatsapp] sendWhatsAppText failed:', error.message);
    return { success: false, message: error.message, errorCode: error.code };
  }
}

/**
 * Send SMS notification
 */
async function sendSMS(phoneNumber, message) {
  if (!twilioClient) {
    console.log('⚠️  Twilio not configured. SMS not sent.');
    return { success: false, message: 'SMS service not configured' };
  }

  try {
    await twilioClient.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER,
      to: phoneNumber,
      body: message
    });

    return { success: true, message: 'SMS sent successfully' };
  } catch (error) {
    console.error('Error sending SMS:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Diagnostic function to check Twilio configuration
 */
async function checkTwilioConfig() {
  console.log('\n📋 Twilio Configuration Check:');
  console.log('─'.repeat(50));
  
  if (!twilioConfig.accountSid) {
    console.log('❌ TWILIO_ACCOUNT_SID: NOT SET');
  } else {
    console.log(`✅ TWILIO_ACCOUNT_SID: ${twilioConfig.accountSid.substring(0, 8)}...`);
  }
  
  if (!twilioConfig.authToken) {
    console.log('❌ TWILIO_AUTH_TOKEN: NOT SET');
  } else {
    console.log(`✅ TWILIO_AUTH_TOKEN: ${twilioConfig.authToken.substring(0, 8)}...`);
  }
  
  if (!twilioConfig.whatsappNumber) {
    console.log('❌ TWILIO_WHATSAPP_NUMBER: NOT SET');
    console.log('   Expected format: whatsapp:+14155238886');
  } else {
    console.log(`✅ TWILIO_WHATSAPP_NUMBER: ${twilioConfig.whatsappNumber}`);
    if (!twilioConfig.whatsappNumber.startsWith('whatsapp:+')) {
      console.log('⚠️  WARNING: Should start with "whatsapp:+"');
    }
  }
  
  if (twilioClient) {
    try {
      const account = await twilioClient.api.accounts(twilioConfig.accountSid).fetch();
      console.log(`✅ Twilio Account: ${account.friendlyName || 'Active'}`);
      console.log(`   Status: ${account.status}`);
      console.log(`   Type: ${account.type}`);
      
      // Check if WhatsApp sandbox is set up
      if (twilioConfig.whatsappNumber) {
        console.log('\n📱 WhatsApp Sandbox Status:');
        console.log('   To test WhatsApp, send "join [code]" to your Twilio WhatsApp number');
        console.log(`   Your number: ${twilioConfig.whatsappNumber}`);
        console.log('   Check Twilio Console → Messaging → Try it out → Send a WhatsApp message');
      }
    } catch (error) {
      console.log(`❌ Twilio Account Check Failed: ${error.message}`);
      if (error.code === 20003) {
        console.log('   → Invalid Account SID or Auth Token');
      }
    }
  } else {
    console.log('❌ Twilio Client: NOT INITIALIZED');
    console.log('   → Add credentials to .env file to enable WhatsApp');
  }
  
  console.log('─'.repeat(50));
  console.log('');
}

// Run diagnostics on module load (only in development or if explicitly enabled)
if (process.env.NODE_ENV !== 'production' || process.env.TWILIO_DIAGNOSTICS === 'true') {
  // Delay to ensure Twilio client is initialized
  setTimeout(() => {
    if (twilioClient) {
      checkTwilioConfig().catch(console.error);
    }
  }, 2000);
}

// Export twilioClient for diagnostics
module.exports = {
  sendSMS,
  sendWhatsAppText,
  normalizeWhatsAppPhone,
  checkTwilioConfig,
  get twilioClient() { return twilioClient; },
  get twilioConfig() { return twilioConfig; }
};
