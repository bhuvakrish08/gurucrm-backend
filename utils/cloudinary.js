// ✅ NEW FILE

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME ? process.env.CLOUDINARY_NAME.trim() : "",
  api_key: process.env.CLOUDINARY_API_KEY ? process.env.CLOUDINARY_API_KEY.trim() : "",
  api_secret: process.env.CLOUDINARY_SECRET ? process.env.CLOUDINARY_SECRET.trim() : "",
  secure: true,
});

module.exports = cloudinary;