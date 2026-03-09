const { createCanvas, loadImage } = require('canvas');
const { generateQRCodeBuffer } = require('./qrGenerator');
const path = require('path');
const fs = require('fs');

/**
 * Generate visitor pass/badge based on template
 * Template dimensions from image:
 * - Label: Custom size (adjustable)
 * - Photo: Circular, specific dimensions
 * - QR Code: Specific dimensions
 * - Logo: Top right
 */
async function generateVisitorPass(visitor, companyLogoPath = null) {
  // Label dimensions (adjust based on printer requirements)
  const LABEL_WIDTH = 400; // pixels
  const LABEL_HEIGHT = 250; // pixels
  
  // Photo dimensions (circular)
  const PHOTO_SIZE = 80;
  const PHOTO_X = 20;
  const PHOTO_Y = 20;
  
  // QR Code dimensions
  const QR_SIZE = 80;
  const QR_X = LABEL_WIDTH - QR_SIZE - 20;
  const QR_Y = LABEL_HEIGHT - QR_SIZE - 20;
  
  // Logo dimensions
  const LOGO_SIZE = 60;
  const LOGO_X = LABEL_WIDTH - LOGO_SIZE - 20;
  const LOGO_Y = 20;
  
  // Create canvas
  const canvas = createCanvas(LABEL_WIDTH, LABEL_HEIGHT);
  const ctx = canvas.getContext('2d');
  
  // Get category colors
  const categoryInfo = require('../models/Visitor').VISITOR_CATEGORIES[visitor.visitorCategory] || {
    color: '#E0E0E0',
    borderColor: '#9E9E9E'
  };
  
  // Background with pastel color
  ctx.fillStyle = categoryInfo.color;
  ctx.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
  
  // Border with category border color
  ctx.strokeStyle = categoryInfo.borderColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, LABEL_WIDTH - 4, LABEL_HEIGHT - 4);
  
  // Rounded corners effect (simplified)
  const radius = 8;
  ctx.beginPath();
  ctx.moveTo(radius, 2);
  ctx.lineTo(LABEL_WIDTH - radius, 2);
  ctx.quadraticCurveTo(LABEL_WIDTH - 2, 2, LABEL_WIDTH - 2, radius);
  ctx.lineTo(LABEL_WIDTH - 2, LABEL_HEIGHT - radius);
  ctx.quadraticCurveTo(LABEL_WIDTH - 2, LABEL_HEIGHT - 2, LABEL_WIDTH - radius, LABEL_HEIGHT - 2);
  ctx.lineTo(radius, LABEL_HEIGHT - 2);
  ctx.quadraticCurveTo(2, LABEL_HEIGHT - 2, 2, LABEL_HEIGHT - radius);
  ctx.lineTo(2, radius);
  ctx.quadraticCurveTo(2, 2, radius, 2);
  ctx.clip();
  
  // Load and draw visitor photo (circular)
  try {
    const photoPath = path.join(__dirname, '../../uploads/visitors', path.basename(visitor.photograph));
    if (fs.existsSync(photoPath)) {
      const photo = await loadImage(photoPath);
      
      // Create circular mask for photo
      ctx.save();
      ctx.beginPath();
      ctx.arc(PHOTO_X + PHOTO_SIZE/2, PHOTO_Y + PHOTO_SIZE/2, PHOTO_SIZE/2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(photo, PHOTO_X, PHOTO_Y, PHOTO_SIZE, PHOTO_SIZE);
      ctx.restore();
      
      // Photo border
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(PHOTO_X + PHOTO_SIZE/2, PHOTO_Y + PHOTO_SIZE/2, PHOTO_SIZE/2, 0, Math.PI * 2);
      ctx.stroke();
    }
  } catch (error) {
    console.error('Error loading visitor photo:', error);
  }
  
  // Load and draw company logo (top right)
  if (companyLogoPath && fs.existsSync(companyLogoPath)) {
    try {
      const logo = await loadImage(companyLogoPath);
      const logoAspect = logo.width / logo.height;
      let logoWidth = LOGO_SIZE;
      let logoHeight = LOGO_SIZE / logoAspect;
      
      if (logoHeight > LOGO_SIZE) {
        logoHeight = LOGO_SIZE;
        logoWidth = LOGO_SIZE * logoAspect;
      }
      
      ctx.drawImage(logo, LOGO_X, LOGO_Y, logoWidth, logoHeight);
    } catch (error) {
      console.error('Error loading company logo:', error);
    }
  }
  
  // Visitor information (left side, below photo)
  const textX = PHOTO_X;
  const textY = PHOTO_Y + PHOTO_SIZE + 15;
  
  ctx.fillStyle = '#2C3E50';
  ctx.font = 'bold 18px Arial';
  ctx.fillText(visitor.name, textX, textY);
  
  let currentY = textY + 20;
  
  if (visitor.company) {
    ctx.font = '14px Arial';
    ctx.fillText(visitor.company, textX, currentY);
    currentY += 18;
  }
  
  ctx.font = '12px Arial';
  ctx.fillText(`Visiting ${visitor.employeeToMeet}`, textX, currentY);
  currentY += 16;
  
  // Format date and time
  const checkInDate = new Date(visitor.checkInTime);
  const dateStr = checkInDate.toLocaleDateString('en-GB', { 
    day: '2-digit', 
    month: 'long', 
    year: 'numeric' 
  });
  const timeStr = checkInDate.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true 
  });
  ctx.fillText(`${dateStr}, ${timeStr}`, textX, currentY);
  currentY += 16;
  
  // Visitor ID label
  ctx.font = 'bold 12px Arial';
  ctx.fillText(`Visitor ID ${visitor.visitorId}`, textX, currentY);
  
  // Generate and draw QR code
  try {
    const qrBuffer = await generateQRCodeBuffer(visitor.qrToken);
    const qrImage = await loadImage(qrBuffer);
    ctx.drawImage(qrImage, QR_X, QR_Y, QR_SIZE, QR_SIZE);

    // Instruction text below QR
    ctx.fillStyle = '#2C3E50';
    ctx.font = '10px Arial';
    const instruction = 'Use this QR code or Exit Code at checkout';
    const instrX = QR_X;
    const instrY = QR_Y - 8;
    ctx.fillText(instruction, instrX - 40, instrY);
  } catch (error) {
    console.error('Error generating QR code:', error);
  }
  
  // Return as buffer
  return canvas.toBuffer('image/png');
}

module.exports = { generateVisitorPass };
