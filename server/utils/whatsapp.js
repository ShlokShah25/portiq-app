const twilio = require('twilio');
const { generateQRCodeBuffer } = require('./qrGenerator');
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
 * Send QR code via WhatsApp with image
 */
async function sendQRViaWhatsApp(phoneNumber, qrToken, visitorName, purpose = null) {
  console.log('\n📱 ===== TWILIO WHATSAPP SEND ATTEMPT =====');
  console.log(`   Visitor: ${visitorName}`);
  console.log(`   Phone: ${phoneNumber}`);
  console.log(`   QR Token: ${qrToken}`);
  
  if (!twilioClient) {
    console.error('❌ Twilio client is NULL - not initialized!');
    console.error('   Check your .env file for:');
    console.error('   - TWILIO_ACCOUNT_SID');
    console.error('   - TWILIO_AUTH_TOKEN');
    console.error('   - TWILIO_WHATSAPP_NUMBER');
    console.log(`   QR Token for ${visitorName}: ${qrToken}`);
    return { success: false, message: 'WhatsApp service not configured' };
  }

  if (!twilioConfig.whatsappNumber) {
    console.error('❌ TWILIO_WHATSAPP_NUMBER not set in .env file!');
    return { success: false, message: 'WhatsApp number not configured' };
  }

  try {
    // Normalize phone number - ensure it has country code
    let normalizedPhone = phoneNumber.trim();
    
    // Remove any existing whatsapp: prefix
    normalizedPhone = normalizedPhone.replace(/^whatsapp:/, '');
    
    // If it starts with +, use as is, otherwise add +91 for India
    if (!normalizedPhone.startsWith('+')) {
      // Remove any leading 0 or 91
      normalizedPhone = normalizedPhone.replace(/^(0|91)/, '');
      // Add +91 prefix
      normalizedPhone = `+91${normalizedPhone}`;
    }
    
    // Ensure it's in E.164 format (remove spaces, dashes, etc.)
    normalizedPhone = normalizedPhone.replace(/[\s\-\(\)]/g, '');
    
    console.log(`📱 Phone normalization:`);
    console.log(`   Original: ${phoneNumber}`);
    console.log(`   Normalized: ${normalizedPhone}`);
    
    // Generate QR code buffer
    console.log('📸 Generating QR code buffer...');
    const qrBuffer = await generateQRCodeBuffer(qrToken);
    console.log('✅ QR code buffer generated');
    
    let message = `🎫 VISITOR PASS\n\nWelcome to Jamnabai Narsee School!\n\nHello ${visitorName},\n\n`;
    
    if (purpose) {
      message += `Purpose of Visit: ${purpose}\n\n`;
    }
    
    message += `Please scan this QR code or use this unique 4-digit exit code at the time of checkout:\n\nExit Code: ${qrToken}\n\nThank you!`;
    console.log('💬 Message prepared:', message.substring(0, 50) + '...');
    
    // Get base URL (ngrok or production)
    const baseUrl = process.env.BASE_URL || process.env.PUBLIC_URL;
    let qrImageUrl = null;
    console.log(`🌐 Base URL: ${baseUrl || 'NOT SET (localhost)'}`);
    
    if (baseUrl && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')) {
      // Use ngrok or production URL
      qrImageUrl = `${baseUrl}/api/visitors/qr/${qrToken}`;
      console.log(`📸 Using QR code URL: ${qrImageUrl}`);
    } else {
      // Fallback: Try image hosting services
      try {
        const formData = new FormData();
        formData.append('file', qrBuffer, {
          filename: `qr-${qrToken}.png`,
          contentType: 'image/png'
        });
        
        const fileIoResponse = await axios.post('https://file.io', formData, {
          headers: formData.getHeaders(),
          params: { expires: '1d' },
          timeout: 15000
        });
        
        if (fileIoResponse.data && fileIoResponse.data.success && fileIoResponse.data.link) {
          qrImageUrl = fileIoResponse.data.link;
          console.log(`✅ QR code uploaded to file.io: ${qrImageUrl}`);
        }
      } catch (error) {
        console.log('⚠️  Image hosting failed, will send text only');
      }
    }

    // Validate WhatsApp number is set
    if (!twilioConfig.whatsappNumber) {
      console.error('❌ TWILIO_WHATSAPP_NUMBER not configured');
      return { success: false, message: 'WhatsApp number not configured in .env file' };
    }
    
    // Ensure WhatsApp number has correct format
    let fromNumber = twilioConfig.whatsappNumber;
    if (!fromNumber.startsWith('whatsapp:')) {
      fromNumber = `whatsapp:${fromNumber}`;
      console.log(`⚠️  Fixed WhatsApp number format: ${fromNumber}`);
    }
    
    // Validate from number format
    if (!fromNumber.match(/^whatsapp:\+\d{10,15}$/)) {
      console.error('❌ INVALID FROM NUMBER FORMAT');
      console.error(`   Current: ${fromNumber}`);
      console.error('   Expected: whatsapp:+14155238886');
      return { 
        success: false, 
        message: `Invalid WhatsApp number format. Expected: whatsapp:+14155238886, Got: ${fromNumber}`,
        errorCode: 'INVALID_FORMAT'
      };
    }
    
    // Send WhatsApp message with QR code image
    const messageData = {
      from: fromNumber,
      to: `whatsapp:${normalizedPhone}`,
      body: message
    };
    
    console.log(`📤 Attempting to send WhatsApp message:`);
    console.log(`   From: ${fromNumber}`);
    console.log(`   To: whatsapp:${normalizedPhone}`);
    console.log(`   Body length: ${message.length} characters`);
    console.log(`   Twilio Client: ${twilioClient ? '✅ Initialized' : '❌ NULL'}`);

    if (qrImageUrl) {
      try {
        console.log(`📷 Attempting to send with QR image: ${qrImageUrl}`);
        const result = await twilioClient.messages.create({
          ...messageData,
          mediaUrl: [qrImageUrl]
        });
        console.log(`✅ WhatsApp message with QR image sent to ${normalizedPhone}`);
        console.log(`   Message SID: ${result.sid}`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Price: ${result.price || 'N/A'}`);
        console.log('📱 ===== TWILIO SEND SUCCESS =====\n');
        return { success: true, message: 'QR code sent via WhatsApp with image', messageSid: result.sid };
      } catch (mediaError) {
        // Fallback to text only
        console.error('❌ Media send failed!');
        console.error('   Error message:', mediaError.message);
        console.error('   Error code:', mediaError.code);
        console.error('   Error status:', mediaError.status);
        console.error('   Error details:', mediaError.moreInfo);
        console.error('   Full error:', JSON.stringify(mediaError, null, 2));
        
        // Check for specific error codes
        if (mediaError.code === 21211 || mediaError.code === 21610) {
          console.error('❌ INVALID PHONE NUMBER FORMAT');
          console.error('   Make sure the number includes country code (e.g., +91 for India)');
          return { success: false, message: `Invalid phone number format. Please use country code (e.g., +91xxxxxxxxxx)` };
        }
        
        if (mediaError.code === 21608 || mediaError.code === 21614) {
          console.error('❌ WHATSAPP SANDBOX NOT JOINED');
          console.error('   The recipient must join the Twilio WhatsApp sandbox first!');
          console.error(`   Send "join ${process.env.TWILIO_SANDBOX_CODE || 'your-code'}" to ${process.env.TWILIO_WHATSAPP_NUMBER}`);
          return { success: false, message: 'Recipient must join WhatsApp sandbox. Check console for instructions.' };
        }
        
        // Try text-only as fallback
        try {
          console.log('📝 Attempting text-only fallback...');
          const result = await twilioClient.messages.create(messageData);
          console.log(`✅ WhatsApp message sent to ${normalizedPhone} (text only - image failed)`);
          console.log(`   Message SID: ${result.sid}`);
          console.log(`   Status: ${result.status}`);
          console.log('📱 ===== TWILIO SEND SUCCESS (TEXT ONLY) =====\n');
          return { success: true, message: 'QR code sent via WhatsApp (text only)', messageSid: result.sid };
        } catch (textError) {
          console.error('❌ Text-only send also failed!');
          console.error('   Error message:', textError.message);
          console.error('   Error code:', textError.code);
          console.error('   Error status:', textError.status);
          console.error('   Full error:', JSON.stringify(textError, null, 2));
          throw textError; // Re-throw to be caught by outer catch
        }
      }
    } else {
      // Fallback: Send text only
      try {
        console.log('📝 Sending text-only message (no image URL available)...');
        const result = await twilioClient.messages.create(messageData);
        console.log(`✅ WhatsApp message sent to ${normalizedPhone} (text only - no image URL available)`);
        console.log(`   Message SID: ${result.sid}`);
        console.log(`   Status: ${result.status}`);
        console.log('📱 ===== TWILIO SEND SUCCESS =====\n');
        return { success: true, message: 'QR code sent via WhatsApp (text only)', messageSid: result.sid };
      } catch (textError) {
        console.error('❌ Text-only send failed!');
        console.error('   Error message:', textError.message);
        console.error('   Error code:', textError.code);
        console.error('   Error status:', textError.status);
        console.error('   Full error:', JSON.stringify(textError, null, 2));
        throw textError; // Re-throw to be caught by outer catch
      }
    }
  } catch (error) {
    console.error('\n❌ ===== TWILIO SEND FAILED =====');
    console.error('   Error message:', error.message);
    console.error('   Error code:', error.code);
    console.error('   Error status:', error.status);
    console.error('   More info:', error.moreInfo);
    console.error('   Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    
    // Provide specific error messages
    let errorMessage = error.message;
    
    if (error.code === 20003) {
      errorMessage = 'Twilio authentication failed. Check your Account SID and Auth Token in .env file.';
      console.error('❌ AUTHENTICATION ERROR: Invalid Account SID or Auth Token');
      console.error('   → Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env');
    } else if (error.code === 21211) {
      errorMessage = 'Invalid phone number format. Must include country code (e.g., +91xxxxxxxxxx for India).';
      console.error('❌ PHONE NUMBER ERROR: Invalid format');
      console.error(`   → Received: ${normalizedPhone}`);
      console.error('   → Expected: +91xxxxxxxxxx (with country code)');
    } else if (error.code === 21608 || error.code === 21614) {
      errorMessage = 'WhatsApp sandbox not joined. Recipient must send join code to Twilio WhatsApp number.';
      console.error('❌ SANDBOX ERROR: Recipient must join WhatsApp sandbox');
      console.error(`   → Instructions: Send "join [code]" to ${twilioConfig.whatsappNumber}`);
      console.error('   → Check Twilio Console → Messaging → Try it out → Send a WhatsApp message');
    } else if (error.code === 21219) {
      errorMessage = 'Invalid WhatsApp number format. Check TWILIO_WHATSAPP_NUMBER in .env file.';
      console.error('❌ WHATSAPP NUMBER ERROR: Invalid format in .env');
      console.error(`   → Current: ${twilioConfig.whatsappNumber}`);
      console.error('   → Expected: whatsapp:+14155238886');
    } else if (error.code === 20001) {
      errorMessage = 'Twilio account issue. Check your account status and balance.';
      console.error('❌ ACCOUNT ERROR: Check Twilio console for account status');
      console.error('   → Go to: https://console.twilio.com/');
      console.error('   → Check account balance and status');
    } else if (error.code === 20429) {
      errorMessage = 'Too many requests. Please wait a moment and try again.';
      console.error('❌ RATE LIMIT: Too many requests');
    } else {
      console.error('❌ UNKNOWN ERROR CODE:', error.code);
      console.error('   → Check Twilio documentation for this error code');
      console.error('   → Twilio Console: https://console.twilio.com/us1/monitor/logs/messaging');
    }
    
    console.error('📱 ===== TWILIO SEND FAILED =====\n');
    return { success: false, message: errorMessage, errorCode: error.code };
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
  sendQRViaWhatsApp,
  sendSMS,
  checkTwilioConfig,
  get twilioClient() { return twilioClient; },
  get twilioConfig() { return twilioConfig; }
};
