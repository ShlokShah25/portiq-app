const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * Generate a unique QR token (4 characters - alphanumeric)
 */
function generateQRToken() {
  // Generate 4-character alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0, O, I, 1)
  let token = '';
  for (let i = 0; i < 4; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Generate QR code image as data URL
 */
async function generateQRCode(token) {
  try {
    const qrDataURL = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      width: 300,
      margin: 1
    });
    return qrDataURL;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
}

/**
 * Generate QR code as buffer (for file saving)
 */
async function generateQRCodeBuffer(token) {
  try {
    const qrBuffer = await QRCode.toBuffer(token, {
      errorCorrectionLevel: 'H',
      width: 300,
      margin: 1
    });
    return qrBuffer;
  } catch (error) {
    console.error('Error generating QR code buffer:', error);
    throw error;
  }
}

module.exports = {
  generateQRToken,
  generateQRCode,
  generateQRCodeBuffer
};
