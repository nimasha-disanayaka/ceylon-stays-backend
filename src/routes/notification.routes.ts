import { Router } from 'express';
import { sendTestSMS, getNotificationLogs } from '../controllers/notification.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Test SMS endpoint (allows host to test dispatch)
router.post('/test-sms', authenticate, sendTestSMS);

// Retrieve SMS delivery logs
router.get('/logs', authenticate, getNotificationLogs);

export default router;
