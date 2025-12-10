// const OTPModel = require('../models/OTPModel');
// const nodemailer = require('nodemailer');
// const dotenv = require('dotenv');

// dotenv.config();

// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS,
//     },
// });

// const generateOTP = () => {
//     return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
// };

// const sendOTPEmail = async (email, otp) => {
//     const mailOptions = {
//         from: process.env.EMAIL_USER,
//         to: email,
//         subject: 'Your OTP for Login',
//         html: `
//             <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
//                 <h2 style="color: #333; text-align: center;">One-Time Password (OTP)</h2>
//                 <p style="font-size: 16px; color: #555;">Dear User,</p>
//                 <p style="font-size: 16px; color: #555;">Your One-Time Password (OTP) for logging in is:</p>
//                 <p style="font-size: 24px; font-weight: bold; color: #007bff; text-align: center; background-color: #f0f8ff; padding: 10px; border-radius: 5px;">${otp}</p>
//                 <p style="font-size: 14px; color: #777;">This OTP is valid for 5 minutes. Please do not share it with anyone.</p>
//                 <p style="font-size: 14px; color: #777;">If you did not request this, please ignore this email.</p>
//                 <p style="font-size: 16px; color: #555;">Regards,</p>
//                 <p style="font-size: 16px; color: #555;">The Auth Service Team</p>
//             </div>
//         `,
//     };

//     await transporter.sendMail(mailOptions);
// };

// const createAndSendOTP = async (email) => {
//     const otp = generateOTP();
//     const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

//     // Delete any existing OTPs for this email
//     await OTPModel.deleteOTP(email, null); // Pass null for otp to delete all for email

//     await OTPModel.createOTP(email, otp, expiresAt);
//     await sendOTPEmail(email, otp);
//     return otp;
// };

// const verifyOTP = async (email, otp) => {
//     const storedOTP = await OTPModel.findOTP(email, otp);
//     if (storedOTP) {
//         await OTPModel.deleteOTP(email, otp);
//         return true;
//     }
//     return false;
// };

// module.exports = {
//     generateOTP,
//     sendOTPEmail,
//     createAndSendOTP,
//     verifyOTP,
// };



const OTPModel = require('../models/OTPModel');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
};

const getEmailTemplate = (otp) => {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
    <title>OTP Verification</title>
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <style>
      @keyframes float {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-8px); }
      }
     
      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(33, 193, 182, 0.4); }
        50% { box-shadow: 0 0 0 10px rgba(33, 193, 182, 0); }
      }
     
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
     
      @keyframes rotate3d {
        0% { transform: perspective(1000px) rotateY(0deg); }
        100% { transform: perspective(1000px) rotateY(360deg); }
      }
     
      .icon-3d {
        animation: float 3s ease-in-out infinite;
      }
     
      .otp-card {
        animation: slideIn 0.6s ease-out;
      }
     
      .social-icon {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
     
      .social-icon:hover {
        transform: translateY(-4px) scale(1.1);
      }
      
      @keyframes gradient-shift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: #f5f7fa;">
    <div style="padding: 25px 15px;">
      <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 15px 50px rgba(33, 193, 182, 0.12), 0 5px 15px rgba(0, 0, 0, 0.08);">
       
        <!-- Top Gradient Bar with Animation -->
        <div style="background: linear-gradient(90deg, #21C1B6 0%, #1AA49B 50%, #21C1B6 100%); background-size: 200% 100%; height: 6px; animation: gradient-shift 3s ease infinite;"></div>

        <!-- Header -->
        <div style="padding: 30px 35px 20px; text-align: center; background: linear-gradient(180deg, #fafbfc 0%, #ffffff 100%);">
          <div class="icon-3d" style="display: inline-block; background: linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%); width: 50px; height: 50px; border-radius: 14px; margin-bottom: 15px; box-shadow: 0 8px 20px rgba(33, 193, 182, 0.35), inset 0 -3px 8px rgba(0, 0, 0, 0.15); position: relative;">
            <svg width="50" height="50" viewBox="0 0 50 50" fill="none" style="position: relative; z-index: 1;">
              <path d="M25 12L35 19V32L25 39L15 32V19L25 12Z" fill="white" opacity="0.95"/>
              <circle cx="25" cy="25.5" r="3.5" fill="white"/>
            </svg>
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(145deg, rgba(255,255,255,0.3) 0%, transparent 100%); border-radius: 14px;"></div>
          </div>
          <h1 style="margin: 0 0 6px; font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px;">OTP Verification</h1>
          <p style="margin: 0; font-size: 13px; color: #6b7280; font-weight: 500;">Legal AI Assistant</p>
        </div>

        <!-- Main Content -->
        <div style="padding: 15px 35px 25px;">
          <p style="margin: 0 0 18px; font-size: 14px; color: #4b5563; line-height: 1.5; text-align: center;">Enter the code below to complete your verification.</p>

          <!-- 3D OTP Card with Animation -->
          <div class="otp-card" style="background: linear-gradient(145deg, #ffffff 0%, #f9fafb 100%); border-radius: 14px; padding: 22px; margin: 0 auto 18px; text-align: center; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 3px rgba(0, 0, 0, 0.04); border: 1px solid rgba(33, 193, 182, 0.15); position: relative; transform: perspective(1000px) rotateX(1deg);">
            <div style="position: absolute; top: 0; left: 0; right: 0; height: 2.5px; background: linear-gradient(90deg, #21C1B6, #1AA49B, #21C1B6); border-radius: 14px 14px 0 0;"></div>
            <p style="margin: 0 0 10px; font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 1.3px;">Your OTP Code</p>
            <div style="font-size: 38px; font-weight: 700; letter-spacing: 14px; color: #21C1B6; margin: 0 0 8px; text-shadow: 0 2px 12px rgba(33, 193, 182, 0.25); padding-left: 14px;">${otp}</div>
            <p style="margin: 0; font-size: 12px; color: #9ca3af; font-weight: 500;">⏱️ Expires in 5 minutes</p>
          </div>

          <!-- Security Note -->
          <div style="background: #fef3c7; border-left: 3px solid #f59e0b; border-radius: 6px; padding: 10px 14px;">
            <p style="margin: 0; font-size: 12px; color: #92400e; line-height: 1.4;">🔒 Keep this code confidential</p>
          </div>
        </div>

        <!-- Footer with Social Media -->
        <div style="background: #f9fafb; padding: 20px 35px; text-align: center; border-top: 1px solid #e5e7eb;">
          <!-- Social Icons with 3D Animation -->
          <div style="margin-bottom: 14px;">
            <a href="#" class="social-icon" style="display: inline-block; width: 34px; height: 34px; line-height: 34px; margin: 0 5px; background: linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%); border-radius: 50%; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 700; box-shadow: 0 4px 12px rgba(33, 193, 182, 0.35), inset 0 -2px 4px rgba(0, 0, 0, 0.15);">f</a>
            <a href="#" class="social-icon" style="display: inline-block; width: 34px; height: 34px; line-height: 34px; margin: 0 5px; background: linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%); border-radius: 50%; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; box-shadow: 0 4px 12px rgba(33, 193, 182, 0.35), inset 0 -2px 4px rgba(0, 0, 0, 0.15);">in</a>
            <a href="#" class="social-icon" style="display: inline-block; width: 34px; height: 34px; line-height: 34px; margin: 0 5px; background: linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%); border-radius: 50%; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; box-shadow: 0 4px 12px rgba(33, 193, 182, 0.35), inset 0 -2px 4px rgba(0, 0, 0, 0.15);">X</a>
            <a href="#" class="social-icon" style="display: inline-block; width: 34px; height: 34px; line-height: 34px; margin: 0 5px; background: linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%); border-radius: 50%; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; box-shadow: 0 4px 12px rgba(33, 193, 182, 0.35), inset 0 -2px 4px rgba(0, 0, 0, 0.15);">▶</a>
          </div>
         
          <p style="margin: 0 0 8px; font-size: 12px; color: #6b7280;">
            Need help? <a href="mailto:support@legalai.com" style="color: #21C1B6; text-decoration: none; font-weight: 600;">support@legalai.com</a>
          </p>
          <p style="margin: 0; font-size: 11px; color: #9ca3af;">© 2025 Legal AI Assistant · All rights reserved</p>
        </div>
      </div>

      <!-- Bottom Text -->
      <p style="max-width: 520px; margin: 15px auto 0; text-align: center; font-size: 10px; color: #9ca3af; line-height: 1.4;">
        This is an automated message. If you didn't request this, please ignore it.
      </p>
    </div>
  </body>
</html>`;
};

const sendOTPEmail = async (email, otp) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your OTP for Login - Legal AI Assistant',
        html: getEmailTemplate(otp),
    };

    await transporter.sendMail(mailOptions);
};

const createAndSendOTP = async (email) => {
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

    // Delete any existing OTPs for this email
    await OTPModel.deleteOTP(email, null); // Pass null for otp to delete all for email

    await OTPModel.createOTP(email, otp, expiresAt);
    await sendOTPEmail(email, otp);
    return otp;
};

const verifyOTP = async (email, otp) => {
    const storedOTP = await OTPModel.findOTP(email, otp);
    if (storedOTP) {
        await OTPModel.deleteOTP(email, otp);
        return true;
    }
    return false;
};

module.exports = {
    generateOTP,
    sendOTPEmail,
    createAndSendOTP,
    verifyOTP,
};