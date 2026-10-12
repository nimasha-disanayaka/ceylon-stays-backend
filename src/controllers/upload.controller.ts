import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export const uploadSingleImage = (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const host = req.get('host') || 'localhost:5000';
    const protocol = req.protocol || 'http';
    const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

    return res.status(200).json({
      message: 'Image uploaded successfully',
      url: fileUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    console.error('Upload Error:', error);
    return res.status(500).json({ error: 'Failed to upload image' });
  }
};

export const uploadMultipleImages = (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No image files uploaded' });
    }

    const host = req.get('host') || 'localhost:5000';
    const protocol = req.protocol || 'http';

    const urls = files.map((file) => `${protocol}://${host}/uploads/${file.filename}`);

    return res.status(200).json({
      message: 'Images uploaded successfully',
      urls,
      count: urls.length,
    });
  } catch (error) {
    console.error('Multiple Upload Error:', error);
    return res.status(500).json({ error: 'Failed to upload images' });
  }
};
