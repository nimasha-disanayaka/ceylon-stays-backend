import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { uploadSingleImage, uploadMultipleImages } from '../controllers/upload.controller';

const router = Router();

// Configure Multer storage
const uploadDir = path.join(__dirname, '../../uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const cleanBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${cleanBase}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, WEBP, etc.) are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Single image upload route: POST /api/upload
router.post('/', upload.single('image'), uploadSingleImage);

// Also support field name 'file'
router.post('/file', upload.single('file'), uploadSingleImage);

// Multiple image upload route: POST /api/upload/multiple
router.post('/multiple', upload.array('images', 8), uploadMultipleImages);

export default router;
